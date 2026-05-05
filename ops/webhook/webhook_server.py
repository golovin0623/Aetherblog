#!/usr/bin/env python3
"""AetherBlog 部署 webhook 服务。

SECURITY (VULN-132 / VULN-140):
  - 使用 ``WEBHOOK_SECRET`` 对请求体做 HMAC-SHA256 进行鉴权
    （头部 ``X-Hub-Signature-256: sha256=<hex>``）。已移除"以路径作为密钥"
    的旧鉴权方式。
  - 代码默认监听 ``127.0.0.1``。生产 systemd unit 显式覆盖为 ``0.0.0.0``
    （HMAC 兜底, 但仍属于较宽姿态）。想换成 nginx 前置 + 127.0.0.1, 在
    ``deploy-webhook.service`` 里改 ``Environment=WEBHOOK_BIND`` 即可.
  - ``services`` 字段拒绝未知服务名，而不是静默回退到全量部署
    （VULN-140 的历史行为）。

DEPLOYMENT NOTE (VULN-134 历史尾巴): 仓库历史里有一版 systemd 加固设计
(``User=webhook`` 无特权用户 + ``ProtectSystem=strict`` + ``ProtectHome=true``
+ 独立工作目录 ``/var/lib/aetherblog/webhook``), 来自 PR #459. 但跟
``PROJECT_DIR=/root/Aetherblog`` 默认值有冲突 (ProtectHome 禁止读 /root),
没有端到端落地. 当前生产仍是 ``User=root`` + 直跑仓库符号链接的姿态.
想做加固请单独提 PR 配合仓库迁出 /root/. 详见 ops/webhook/README.md.
"""
# 兼容 Python 3.6+ (CentOS 7 / RHEL 7 默认装的 /usr/bin/python3 是 3.6.8).
# 这意味着不能用:
#   - from __future__ import annotations  (3.7+)
#   - f"{x=}"  (3.8+)
#   - 海象运算符 :=  (3.8+)
#   - list[str] / dict[str, str] 内置泛型  (3.9+)  → 用 typing.List/Dict
#   - str.removeprefix / removesuffix  (3.9+)  → 用 slice 表达式
# 所有类型注解必须用 typing 模块, 不要直接用 lowercase generics.
import contextlib
import fcntl
import hashlib
import hmac
import http.server
import json
import logging
import os
import re
import socket
import socketserver
import subprocess
import sys
import time
from typing import Iterator, Optional, Tuple


def _resolve_secret() -> bytes:
    raw = os.environ.get("WEBHOOK_SECRET", "")
    if not raw or raw == "change-me" or len(raw) < 32:
        print(
            "FATAL: WEBHOOK_SECRET must be set and >= 32 chars (got %d)."
            " Generate with: openssl rand -hex 32" % len(raw),
            file=sys.stderr,
        )
        sys.exit(1)
    return raw.encode("utf-8")


WEBHOOK_SECRET = _resolve_secret()
PORT = int(os.environ.get("WEBHOOK_PORT", "7868"))
BIND_HOST = os.environ.get("WEBHOOK_BIND", "127.0.0.1")
DEPLOY_SCRIPT = os.environ.get(
    "DEPLOY_SCRIPT",
    # 默认走"跟 webhook_server.py 同目录的 deploy.sh", 让仓库布局和服务器
    # 软链接布局都自动匹配, 不再硬编码 /root/Aetherblog/... 的特定生产路径.
    # 生产 systemd unit 里仍可用 Environment=DEPLOY_SCRIPT=... 显式覆盖.
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "deploy.sh"),
)
DEPLOY_TIMEOUT = int(os.environ.get("DEPLOY_TIMEOUT", "900"))

# Repo sync 配置 —— 由 webhook 在 invoke deploy.sh **之前**完成 fetch + reset.
# 这样无论 deploy.sh 怎么改, 下一次部署立刻用新版本; 避免历史"首部署用旧
# in-memory bash 文本, 改动要等下次部署才生效"的死结. 详见 ops/webhook/README.md.
PROJECT_DIR = os.environ.get("PROJECT_DIR", "/root/Aetherblog")
DEPLOY_GIT_REF = os.environ.get("DEPLOY_GIT_REF", "origin/main")
SKIP_GIT_SYNC = os.environ.get("SKIP_GIT_SYNC", "false").lower() == "true"
GIT_FETCH_TIMEOUT = int(os.environ.get("GIT_FETCH_TIMEOUT", "120"))
GIT_RESET_TIMEOUT = int(os.environ.get("GIT_RESET_TIMEOUT", "60"))
# GFW 或瞬断会让单次 fetch 失败 (exit 128 / timeout); 重试最多 GIT_FETCH_RETRIES
# 次, 每次间隔指数退避 (2s, 4s, ...). 默认 2 次重试 = 最多 3 次 fetch 尝试.
GIT_FETCH_RETRIES = int(os.environ.get("GIT_FETCH_RETRIES", "2"))
# 与 deploy.sh 共享同一把 flock —— sync 与手动 `bash deploy.sh` 之间互斥,
# 避免两个 git fetch+reset 并发踩 .git/index.lock.
LOCK_FILE = os.environ.get("LOCK_FILE", "/var/lock/aetherblog-deploy.lock")
# 公网暴露的 webhook 会被扫描器打到。Python 标准库 HTTPServer 默认单线程且
# socket 无超时, 一个半开的 POST 就能卡住所有后续部署请求。
REQUEST_TIMEOUT = float(os.environ.get("WEBHOOK_REQUEST_TIMEOUT", "15"))
MAX_BODY_BYTES = int(os.environ.get("WEBHOOK_MAX_BODY_BYTES", "8192"))

# 允许的服务名白名单
ALLOWED_SERVICES = {"backend", "ai-service", "blog", "admin", "gateway"}

# 仅接受完整 hex SHA (40 sha1 / 64 sha256). 任何 ref name (HEAD / FETCH_HEAD /
# 分支名) 都被拒绝, 否则 git reset --hard 会跟着浮动 ref 走, pin 形同虚设.
_HEX_SHA_RE = re.compile(r"^[0-9a-f]{40,64}$")


def _sync_repo(commit_sha: str = "") -> Tuple[bool, str, str]:
    """在 invoke deploy.sh 之前把仓库 hard-reset 到一个 **immutable** 的 commit SHA。

    返回 ``(ok, message, resolved_sha)``。失败时调用方应当返回 5xx;
    成功时 ``resolved_sha`` 是真正 reset 到的不可变 SHA (40 hex), 调用方应当
    通过 ``DEPLOY_COMMIT_SHA`` env 透传给 deploy.sh 用作审计与二次校验.

    SECURITY (#601 review fix):
      - 调用方可在请求体里传 ``commit_sha`` 显式 pin 到 CI 已审过的提交;
        服务端用 ``cat-file -e`` 校验存在, 用 ``merge-base --is-ancestor`` 确认
        从刚 fetch 的 ``DEPLOY_GIT_REF`` 可达, 才会 reset 过去.
      - 未传 ``commit_sha`` 时 fallback 到 ``git rev-parse FETCH_HEAD`` 把
        浮动 ref 解析成快照 SHA, 然后 reset 到那个 SHA. 历史上这里直接
        ``reset --hard FETCH_HEAD`` —— 即便此刻 FETCH_HEAD 指向 SHA1, 紧随其后
        的另一个并发 fetch 仍可能把它换走 (例如 deploy.sh 内部 fallback 还在
        跑 sync 的旧版本路径). 先 rev-parse 拿快照避免这个 TOCTOU 窗口.

    *为什么不全部放到 deploy.sh 里* —— deploy.sh 顶部 ``exec > >(tee ...)`` 与
    后续 ``exec 200>$LOCK_FILE`` 共同导致 deploy.sh 不能在 sync 之后安全地
    re-exec 自己 (会出现双 tee / fd200 锁混乱 / 死锁). 历史上为了规避死锁,
    deploy.sh 内部 sync 写入磁盘但仍用 in-memory 旧文本跑完本次部署 —— 任何
    deploy.sh 自身的修改都要"牺牲"一次部署才能生效, 是反复出现 bug 的源头
    (PR #521 v38 dirty heal 上线后第一次 incremental 部署就吞掉了新 heal).
    把 sync 提前到 webhook 这层, deploy.sh 在被 spawn 时就已经是新版.
    """
    if SKIP_GIT_SYNC:
        return True, "SKIP_GIT_SYNC=true, skipping repo sync", ""
    if not os.path.isdir(os.path.join(PROJECT_DIR, ".git")):
        return True, "PROJECT_DIR=%s is not a git repo, skipping sync" % PROJECT_DIR, ""
    # str.removeprefix 是 Python 3.9+, 这里用 slice 表达式兼容到 3.6 (Ubuntu 20.04 默认 3.8).
    fetch_ref = (DEPLOY_GIT_REF[7:] if DEPLOY_GIT_REF.startswith("origin/") else DEPLOY_GIT_REF) or "main"

    # --- git fetch with exponential-backoff retry ---
    # GFW / 代理瞬断会导致 exit 128 "Encountered end of file" 或 TimeoutExpired.
    # 最多重试 GIT_FETCH_RETRIES 次, 退避 2s / 4s / 8s ...
    fetch_err = None  # type: Optional[str]
    for attempt in range(GIT_FETCH_RETRIES + 1):
        if attempt > 0:
            delay = 2 * (2 ** (attempt - 1))  # 2, 4, 8 ...
            logging.warning(
                "git fetch attempt %d/%d failed (%s), retrying in %ds",
                attempt, GIT_FETCH_RETRIES + 1, fetch_err, delay,
            )
            time.sleep(delay)
        try:
            subprocess.run(
                ["git", "fetch", "--quiet", "--tags", "origin", fetch_ref],
                cwd=PROJECT_DIR, check=True, timeout=GIT_FETCH_TIMEOUT,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
            )
            fetch_err = None
            break
        except subprocess.TimeoutExpired:
            fetch_err = "git sync timed out: ['git', 'fetch', 'origin', %r]" % fetch_ref
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or "").strip()
            fetch_err = "git sync failed (exit %s): %s" % (exc.returncode, stderr or str(exc.cmd))

    if fetch_err:
        return False, fetch_err, ""
    # ------------------------------------------------

    try:
        if commit_sha:
            # 形参已经在 _parse_request 里校验过 hex 格式, 这里再做对仓库的存在性
            # 与可达性校验, 避免调用方拿一个本仓库不认识的 hash 把 reset 打到任意
            # 历史提交.
            subprocess.run(
                ["git", "cat-file", "-e", commit_sha + "^{commit}"],
                cwd=PROJECT_DIR, check=True, timeout=GIT_RESET_TIMEOUT,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
            )
            subprocess.run(
                ["git", "merge-base", "--is-ancestor", commit_sha, "FETCH_HEAD"],
                cwd=PROJECT_DIR, check=True, timeout=GIT_RESET_TIMEOUT,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
            )
            target_sha = commit_sha
        else:
            # 没显式 pin 时: 把 FETCH_HEAD 即时解析成 immutable SHA, 再 reset 过去.
            # 这样即便 deploy.sh 跑到中途又有新 commit 落地, 当前 run 仍然只跑
            # 本次 webhook 触发时刻的快照, 不会半路被换码.
            resolved = subprocess.run(
                ["git", "rev-parse", "FETCH_HEAD"],
                cwd=PROJECT_DIR, check=True, timeout=GIT_RESET_TIMEOUT,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
            )
            target_sha = (resolved.stdout or "").strip()
            if not _HEX_SHA_RE.match(target_sha):
                return False, "git rev-parse FETCH_HEAD did not return a hex SHA: %r" % target_sha, ""

        subprocess.run(
            ["git", "reset", "--hard", target_sha],
            cwd=PROJECT_DIR, check=True, timeout=GIT_RESET_TIMEOUT,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
        )
        msg = "Repo synced to %s (from %s)" % (target_sha, fetch_ref)
        if commit_sha:
            msg += " [caller-pinned]"
        return True, msg, target_sha
    except subprocess.TimeoutExpired as exc:
        return False, "git sync timed out: %s" % (exc.cmd,), ""
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        return False, "git sync failed (exit %s): %s" % (exc.returncode, stderr or exc.cmd), ""


@contextlib.contextmanager
def _deploy_lock() -> Iterator[None]:
    """持有 deploy.sh 用的同一把 flock 完成 sync, 然后**立即释放**, 让随后
    spawn 出来的 deploy.sh 自己重新 acquire.

    *为什么不持有跨 subprocess 整段* —— deploy.sh 顶部 `exec 200>$LOCK_FILE`
    会在 bash 里另开一个 fd 然后 `flock 200` 申请同一把锁; flock 是按
    open-file-description 互斥, 父进程持有期间, 子 bash 拿不到锁会死锁.
    所以释放窗口是必要的. 中间那个微秒级窗口里就算插进来一次手动 deploy,
    它会先跑完, 我们再跑, flock 的串行语义不变, 没有正确性问题.
    """
    fd = os.open(LOCK_FILE, os.O_WRONLY | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def _tail(text: str, lines: int = 20) -> str:
    if not text:
        return ""
    return "\n".join(text.strip().splitlines()[-lines:])


def _read_request_body(handler) -> Tuple[bytes, Optional[Tuple[int, str]]]:
    raw_length = handler.headers.get("Content-Length", "0")
    try:
        content_length = int(raw_length)
    except (TypeError, ValueError):
        return b"", (400, "Invalid Content-Length")

    if content_length < 0:
        return b"", (400, "Invalid Content-Length")
    if content_length > MAX_BODY_BYTES:
        return b"", (413, "Request body too large")
    if content_length == 0:
        return b"", None

    try:
        body = handler.rfile.read(content_length)
    except socket.timeout:
        logging.warning("Webhook request body read timed out")
        return b"", (408, "Request body timed out")

    if len(body) != content_length:
        return b"", (400, "Incomplete request body")
    return body, None


def _verify_signature(body: bytes, signature_header: Optional[str]) -> bool:
    """常时间 HMAC-SHA256 验签（GitHub 风格）。"""
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    sent_sig = signature_header.split("=", 1)[1].strip()
    if not sent_sig:
        return False
    expected = hmac.new(WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sent_sig)


def _parse_request(body: bytes) -> Tuple[str, str, bool]:
    """返回 (服务名字符串, 已校验过格式的 commit_sha 或空, 是否合法)。

    - ``services``: 拒绝白名单之外的服务名 (VULN-140)。
    - ``commit_sha``: 可选; 提供时必须是完整 hex SHA (40-64 hex 字符);
      拒绝任何 ref name (HEAD / FETCH_HEAD / 分支名), 否则下游 git reset
      会跟着浮动 ref 走, pin 形同虚设 (#601 review fix)。
    """
    if not body:
        return "", "", True
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        return "", "", False
    if not isinstance(data, dict):
        return "", "", False

    raw = data.get("services", "")
    services = ""
    if raw:
        requested = [s.strip() for s in str(raw).split() if s.strip()]
        invalid = [s for s in requested if s not in ALLOWED_SERVICES]
        if invalid:
            return "", "", False  # VULN-140：显式拒绝优于静默回退到全量部署
        services = " ".join(requested)

    raw_sha = data.get("commit_sha", "")
    commit_sha = ""
    if raw_sha:
        # 统一小写, 避免 GitHub Actions / CI 偶尔传大写 hex 时校验失败.
        candidate = str(raw_sha).strip().lower()
        if not _HEX_SHA_RE.match(candidate):
            return "", "", False
        commit_sha = candidate

    return services, commit_sha, True


# 老别名: 单元测试与外部脚本可能直接 import _parse_services. 维持 (services, ok) 形状.
def _parse_services(body: bytes) -> Tuple[str, bool]:
    services, _sha, ok = _parse_request(body)
    return services, ok


class WebhookHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:
        logging.info("%s - %s", self.address_string(), format % args)

    def _send(self, status: int, message: str) -> None:
        body = f"{message}\n".encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        # SECURITY (VULN-132): 仅保留一条规范路径；鉴权依赖 HMAC，不依赖 URL。
        if self.path != "/deploy":
            self._send(404, "Not Found")
            return

        body, body_error = _read_request_body(self)
        if body_error is not None:
            status, message = body_error
            logging.warning("Webhook rejected: %s", message)
            self._send(status, message)
            return

        if not _verify_signature(body, self.headers.get("X-Hub-Signature-256")):
            logging.warning("Webhook rejected: invalid signature")
            self._send(401, "Invalid signature")
            return

        services, commit_sha, ok = _parse_request(body)
        if not ok:
            logging.warning("Webhook rejected: malformed body, non-allowlisted services, or invalid commit_sha")
            self._send(400, "Invalid services or commit_sha field")  # VULN-140 / #601
            return

        env = os.environ.copy()
        if services:
            env["DEPLOY_SERVICES"] = services
            env["DEPLOY_MODE"] = "incremental"
            logging.info("Webhook accepted, incremental deploy: %s", services)
        else:
            env["DEPLOY_MODE"] = "full"
            logging.info("Webhook accepted, full deploy (no services specified)")

        # 先 sync 后 invoke deploy.sh: 让 deploy.sh 自身的修改在当前部署内立即
        # 生效。如果 sync 失败，直接 abort —— 既不能拉到新 deploy.sh, 也不该
        # 用磁盘上可能已经损坏的旧版本继续。
        # _deploy_lock() 持有 deploy.sh 用的同一把 flock 防止与手动 `bash deploy.sh`
        # 并发踩 .git/index.lock; 出 with 块自动释放, 让随后 spawn 的 deploy.sh
        # 重新 acquire (见 _deploy_lock 文档字符串).
        try:
            with _deploy_lock():
                sync_ok, sync_msg, resolved_sha = _sync_repo(commit_sha)
        except OSError as exc:
            logging.error("Failed to acquire deploy lock for sync: %s", exc)
            self._send(500, f"Lock acquisition failed: {exc}")
            return
        if not sync_ok:
            logging.error("Repo sync failed before deploy: %s", sync_msg)
            self._send(500, f"Repo sync failed: {sync_msg}")
            return
        logging.info(sync_msg)
        # deploy.sh 仍保留它自己的 sync 逻辑作为直接调用 (非 webhook) 时的
        # fallback；这里通过 env 关闭它, 避免 webhook 路径下做两遍 fetch+reset.
        env["SKIP_GIT_SYNC"] = "true"
        # #601 review fix: 把 webhook 这一侧 reset 用的 immutable SHA 透传给
        # deploy.sh 用作审计 (出现在 deploy 日志里) 与潜在的二次校验。即便
        # SKIP_GIT_SYNC=true 让 deploy.sh 跳过自己的 fetch/reset, 把 SHA 暴露
        # 出来仍然有意义 —— 出问题时能立刻在 webhook 日志和 deploy 日志间
        # 对账, 确认两边盯的是同一个 commit.
        if resolved_sha:
            env["DEPLOY_COMMIT_SHA"] = resolved_sha

        try:
            result = subprocess.run(
                [DEPLOY_SCRIPT],
                check=True,
                timeout=DEPLOY_TIMEOUT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True,
                env=env,
            )
            logging.info("Deployment succeeded")
            stdout_tail = _tail(result.stdout)
            if stdout_tail:
                logging.info("deploy stdout:\n%s", stdout_tail)
            self._send(200, "Deployment completed")
        except subprocess.TimeoutExpired as exc:
            message = f"Deployment timed out after {DEPLOY_TIMEOUT}s"
            logging.error(message)
            logging.error("deploy stdout:\n%s", _tail(exc.stdout or ""))
            logging.error("deploy stderr:\n%s", _tail(exc.stderr or ""))
            self._send(500, message)
        except subprocess.CalledProcessError as exc:
            message = f"Deployment failed with exit code {exc.returncode}"
            logging.error(message)
            stdout_tail = _tail(exc.stdout or "")
            stderr_tail = _tail(exc.stderr or "")
            if stdout_tail:
                logging.error("deploy stdout:\n%s", stdout_tail)
            if stderr_tail:
                logging.error("deploy stderr:\n%s", stderr_tail)
            summary = stderr_tail or stdout_tail
            if summary:
                self._send(500, f"{message}\n{summary}")
                return
            self._send(500, message)
        except Exception:  # pragma: no cover - 兜底防御
            logging.exception("Webhook server internal error")
            self._send(500, "Internal error")


class DeployHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

    def get_request(self):
        request, client_address = super(DeployHTTPServer, self).get_request()
        request.settimeout(REQUEST_TIMEOUT)
        # 内核层兜底：settimeout 只有等到 worker 线程实际进入 recv 才生效，
        # 半开连接 / TCP 层故障在 Python 看不见。SO_KEEPALIVE + 短探测周期 +
        # TCP_USER_TIMEOUT 让内核在 ~25s 内主动 RST 失活连接，配合 ThreadingMixIn
        # 把 scanner 阻塞的爆炸半径锁在单个 worker 线程里。所有 setsockopt 都是
        # Linux 特化路径，包成 try/except 让非 Linux 与古内核回落到原 settimeout。
        try:
            request.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            # 9 秒空闲就开始探测、3 秒一次、3 次没回应即 RST → 总 18 秒。
            for opt_name, value in (
                ("TCP_KEEPIDLE", 9),
                ("TCP_KEEPINTVL", 3),
                ("TCP_KEEPCNT", 3),
            ):
                opt = getattr(socket, opt_name, None)
                if opt is not None:
                    request.setsockopt(socket.IPPROTO_TCP, opt, value)
            # TCP_USER_TIMEOUT (Linux 2.6.37+, RFC 5482): 任何已发数据未收到
            # ack 超过 N ms 就关连接。Python <3.6 没把它包进 socket 模块，用
            # IPPROTO_TCP 协议号 + 数字常量 18 兜底。
            tcp_user_timeout = getattr(socket, "TCP_USER_TIMEOUT", 18)
            request.setsockopt(socket.IPPROTO_TCP, tcp_user_timeout, 25_000)
        except (AttributeError, OSError) as exc:
            logging.debug("TCP keepalive tuning skipped: %s", exc)
        return request, client_address


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    server = DeployHTTPServer((BIND_HOST, PORT), WebhookHandler)
    logging.info("Webhook server running on %s:%s", BIND_HOST, PORT)
    server.serve_forever()


if __name__ == "__main__":
    main()
