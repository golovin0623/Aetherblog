#!/usr/bin/env python3
import http.server
import logging
import os
import subprocess


WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "change-me")
PORT = int(os.environ.get("WEBHOOK_PORT", "7868"))
DEPLOY_SCRIPT = os.environ.get("DEPLOY_SCRIPT", "/root/Aetherblog/webhook/deploy.sh")
DEPLOY_TIMEOUT = int(os.environ.get("DEPLOY_TIMEOUT", "900"))


def _tail(text: str, lines: int = 20) -> str:
    if not text:
        return ""
    return "\n".join(text.strip().splitlines()[-lines:])


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
        if self.path != f"/deploy/{WEBHOOK_SECRET}":
            self._send(403, "Forbidden")
            return

        logging.info("Webhook accepted, starting deployment")

        try:
            result = subprocess.run(
                [DEPLOY_SCRIPT],
                check=True,
                timeout=DEPLOY_TIMEOUT,
                capture_output=True,
                text=True,
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
        except Exception as exc:
            message = f"Internal error: {exc}"
            logging.exception("Webhook server internal error")
            self._send(500, message)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    server = http.server.HTTPServer(("0.0.0.0", PORT), WebhookHandler)
    logging.info("Webhook server running on port %s", PORT)
    server.serve_forever()


if __name__ == "__main__":
    main()
