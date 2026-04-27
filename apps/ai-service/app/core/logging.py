from __future__ import annotations

import json
import logging
import os
import re
import traceback
from datetime import datetime, timezone


# SECURITY (VULN-165): pattern-based API-key / Bearer token scrubber applied to
# every log record BEFORE it's serialized to stdout or the rolling file. Prevents
# LiteLLM exception traces / debug dumps from leaking provider keys into the
# logs volume (which is shared with the Go backend — VULN-146).
_SECRET_RE = (
    re.compile(r"sk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"Bearer\s+[A-Za-z0-9._\-~+/=]{20,}"),
)


def _scrub(value):
    if isinstance(value, str):
        out = value
        for pat in _SECRET_RE:
            out = pat.sub("***", out)
        return out
    if isinstance(value, dict):
        return {k: _scrub(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return type(value)(_scrub(v) for v in value)
    return value


class SecretRedactor(logging.Filter):
    """Redact provider secrets on the way out, regardless of caller hygiene."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            # Rewrite the message payload; getMessage() re-formats record.args
            # against record.msg, so normalize to an already-formatted string.
            record.msg = _scrub(record.getMessage())
            record.args = ()
            data = getattr(record, "data", None)
            if data is not None:
                record.data = _scrub(data)
        except Exception:  # pragma: no cover — logging must never raise
            pass
        return True


class JSONFormatter(logging.Formatter):
    def format(self, record):
        entry = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "service": "ai-service",
            "message": record.getMessage(),
        }
        # TraceId from extra
        trace_id = getattr(record, "traceId", None)
        if trace_id:
            entry["traceId"] = trace_id
        # Exception info
        if record.exc_info and record.exc_info[0]:
            entry["data"] = {"exception": traceback.format_exception(*record.exc_info)}
        # Any extra data
        extra_data = getattr(record, "data", None)
        if extra_data:
            entry.setdefault("data", {}).update(extra_data) if isinstance(extra_data, dict) else None
        return json.dumps(entry, ensure_ascii=False)


def _try_open_log_file(directory: str) -> logging.FileHandler | None:
    """Attempt to open ``ai-service.log`` under ``directory``.

    Returns the handler on success, or ``None`` if the directory cannot be
    created or written to. Used to walk a fallback chain (named volume → tmpfs)
    so a misowned ``aetherblog_logs`` volume on an existing host doesn't leave
    us with no file logging at all.
    """
    try:
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, "ai-service.log")
        return logging.FileHandler(path, encoding="utf-8")
    except (PermissionError, OSError):
        return None


def setup_logging(log_path: str = "./logs", level: str = "INFO"):
    """Configure logging with JSON format to stdout and file.

    The log file is best-effort: if ``log_path`` is not writable (typical when
    the shared ``aetherblog_logs`` Docker volume was created with a different
    UID by an older image), we fall back to ``/tmp/ai-service.log`` (tmpfs in
    prod) and finally to stdout-only. The previous implementation emitted a
    ``warning`` line on every container start which became noise in
    ``docker compose logs``; we now record a single ``info`` only when a
    fallback was actually taken.
    """
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    # Clear existing handlers
    root.handlers.clear()

    formatter = JSONFormatter()
    redactor = SecretRedactor()

    # Stdout handler — primary sink, always present.
    stdout_handler = logging.StreamHandler()
    stdout_handler.setFormatter(formatter)
    stdout_handler.addFilter(redactor)
    root.addHandler(stdout_handler)

    # File handler with fallback chain.
    file_handler = _try_open_log_file(log_path)
    chosen_path = log_path
    if file_handler is None and log_path != "/tmp":
        file_handler = _try_open_log_file("/tmp")
        chosen_path = "/tmp"
    if file_handler is not None:
        file_handler.setFormatter(formatter)
        file_handler.addFilter(redactor)
        root.addHandler(file_handler)
        if chosen_path != log_path:
            root.info(
                "log_file.fallback",
                extra={"data": {"requested": log_path, "actual": chosen_path}},
            )
    # else: stdout-only is the final fallback; container logs still capture
    # everything via docker logs / SystemMonitor.

    # Suppress noisy libraries
    for name in ("httpx", "httpcore", "uvicorn.access", "watchfiles"):
        logging.getLogger(name).setLevel(logging.WARNING)
