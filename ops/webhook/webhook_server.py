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
from __future__ import annotations

import contextlib
import fcntl
import hashlib
import hmac
import http.server
import json
import logging
import os
import subprocess
import sys
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
DEPLOY_SCRIPT = os.environ.get("DEPLOY_SCRIPT", "/root/Aetherblog/webhook/deploy.sh")
DEPLOY_TIMEOUT = int(os.environ.get("DEPLOY_TIMEOUT", "900"))

# Repo sync 配置 —— 由 webhook 在 invoke deploy.sh **之前**完成 fetch + reset.
# 这样无论 deploy.sh 怎么改, 下一次部署立刻用新版本; 避免历史"首部署用旧
# in-memory bash 文本, 改动要等下次部署才生效"的死结. 详见 ops/webhook/README.md.
PROJECT_DIR = os.environ.get("PROJECT_DIR", "/root/Aetherblog")
DEPLOY_GIT_REF = os.environ.get("DEPLOY_GIT_REF", "origin/main")
SKIP_GIT_SYNC = os.environ.get("SKIP_GIT_SYNC", "false").lower() == "true"
GIT_FETCH_TIMEOUT = int(os.environ.get("GIT_FETCH_TIMEOUT", "120"))
GIT_RESET_TIMEOUT = int(os.environ.get("GIT_RESET_TIMEOUT", "60"))
# 与 deploy.sh 共享同一把 flock —— sync 与手动 `bash deploy.sh` 之间互斥,
# 避免两个 git fetch+reset 并发踩 .git/index.lock.
LOCK_FILE = os.environ.get("LOCK_FILE", "/var/lock/aetherblog-deploy.lock")

# 允许的服务名白名单
ALLOWED_SERVICES = {"backend", "ai-service", "blog", "admin", "gateway"}


def _sync_repo() -> Tuple[bool, str]:
    """在 invoke deploy.sh 之前把仓库 hard-reset 到 ``DEPLOY_GIT_REF``。

    返回 ``(ok, message)``。失败时调用方应当返回 5xx; 成功时把消息写到 info 日志.

    *为什么不放到 deploy.sh 里* —— deploy.sh 顶部 ``exec > >(tee ...)`` 与
    后续 ``exec 200>$LOCK_FILE`` 共同导致 deploy.sh 不能在 sync 之后安全地
    re-exec 自己 (会出现双 tee / fd200 锁混乱 / 死锁). 历史上为了规避死锁,
    deploy.sh 内部 sync 写入磁盘但仍用 in-memory 旧文本跑完本次部署 —— 任何
    deploy.sh 自身的修改都要"牺牲"一次部署才能生效, 是反复出现 bug 的源头
    (PR #521 v38 dirty heal 上线后第一次 incremental 部署就吞掉了新 heal).
    把 sync 提前到 webhook 这层, deploy.sh 在被 spawn 时就已经是新版.
    """
    if SKIP_GIT_SYNC:
        return True, "SKIP_GIT_SYNC=true, skipping repo sync"
    if not os.path.isdir(os.path.join(PROJECT_DIR, ".git")):
        return True, f"PROJECT_DIR={PROJECT_DIR} is not a git repo, skipping sync"
    # str.removeprefix 是 Python 3.9+, 这里用 slice 表达式兼容到 3.6 (Ubuntu 20.04 默认 3.8).
    fetch_ref = (DEPLOY_GIT_REF[7:] if DEPLOY_GIT_REF.startswith("origin/") else DEPLOY_GIT_REF) or "main"
    try:
        subprocess.run(
            ["git", "fetch", "--quiet", "--tags", "origin", fetch_ref],
            cwd=PROJECT_DIR, check=True, timeout=GIT_FETCH_TIMEOUT,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        # FETCH_HEAD 比 origin/$ref 更可靠: 调用方可能传 DEPLOY_GIT_REF=main
        # (无 origin/ 前缀), 这种情况下 reset 到本地 main 落不到刚 fetch 的提交.
        subprocess.run(
            ["git", "reset", "--hard", "FETCH_HEAD"],
            cwd=PROJECT_DIR, check=True, timeout=GIT_RESET_TIMEOUT,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        return True, f"Repo synced to FETCH_HEAD of {fetch_ref}"
    except subprocess.TimeoutExpired as exc:
        return False, f"git sync timed out: {exc.cmd}"
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        return False, f"git sync failed (exit {exc.returncode}): {stderr or exc.cmd}"


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


def _verify_signature(body: bytes, signature_header: Optional[str]) -> bool:
    """常时间 HMAC-SHA256 验签（GitHub 风格）。"""
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    sent_sig = signature_header.split("=", 1)[1].strip()
    if not sent_sig:
        return False
    expected = hmac.new(WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sent_sig)


def _parse_services(body: bytes) -> Tuple[str, bool]:
    """返回 (服务名字符串, 是否合法)。拒绝白名单之外的服务名。"""
    if not body:
        return "", True
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        return "", False
    raw = data.get("services", "") if isinstance(data, dict) else ""
    if not raw:
        return "", True
    requested = [s.strip() for s in str(raw).split() if s.strip()]
    invalid = [s for s in requested if s not in ALLOWED_SERVICES]
    if invalid:
        return "", False  # VULN-140：显式拒绝优于静默回退到全量部署
    return " ".join(requested), True


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

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""

        if not _verify_signature(body, self.headers.get("X-Hub-Signature-256")):
            logging.warning("Webhook rejected: invalid signature")
            self._send(401, "Invalid signature")
            return

        services, ok = _parse_services(body)
        if not ok:
            logging.warning("Webhook rejected: malformed body or non-allowlisted services")
            self._send(400, "Invalid services field")  # VULN-140
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
                sync_ok, sync_msg = _sync_repo()
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

        try:
            result = subprocess.run(
                [DEPLOY_SCRIPT],
                check=True,
                timeout=DEPLOY_TIMEOUT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
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


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    server = http.server.HTTPServer((BIND_HOST, PORT), WebhookHandler)
    logging.info("Webhook server running on %s:%s", BIND_HOST, PORT)
    server.serve_forever()


if __name__ == "__main__":
    main()
