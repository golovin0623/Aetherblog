#!/usr/bin/env python3
"""AetherBlog 部署 webhook 服务。

SECURITY (VULN-132 / VULN-140):
  - 使用 ``WEBHOOK_SECRET`` 对请求体做 HMAC-SHA256 进行鉴权
    （头部 ``X-Hub-Signature-256: sha256=<hex>``）。已移除"以路径作为密钥"
    的旧鉴权方式。
  - 默认监听地址为 ``127.0.0.1``，唯一合法调用方是前置反向代理 (Nginx)
    并由它强制 IP 白名单。非默认拓扑可通过 ``WEBHOOK_BIND`` 覆盖。
  - ``services`` 字段拒绝未知服务名，而不是静默回退到全量部署
    （VULN-140 的历史行为）。

SECURITY (VULN-134): 该服务需要配合加固过的 systemd unit
``deploy-webhook.service`` (User=webhook + NoNewPrivileges + ProtectSystem) 一起使用。
"""
from __future__ import annotations

import hashlib
import hmac
import http.server
import json
import logging
import os
import subprocess
import sys
from typing import Optional, Tuple


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
DEPLOY_SCRIPT = os.environ.get("DEPLOY_SCRIPT", "/var/lib/aetherblog/webhook/deploy.sh")
DEPLOY_TIMEOUT = int(os.environ.get("DEPLOY_TIMEOUT", "900"))

# 允许的服务名白名单
ALLOWED_SERVICES = {"backend", "ai-service", "blog", "admin", "gateway"}


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
