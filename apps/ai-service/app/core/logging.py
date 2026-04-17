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


def setup_logging(log_path: str = "./logs", level: str = "INFO"):
    """Configure logging with JSON format to stdout and file."""
    os.makedirs(log_path, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Clear existing handlers
    root.handlers.clear()

    formatter = JSONFormatter()
    redactor = SecretRedactor()

    # Stdout handler
    stdout_handler = logging.StreamHandler()
    stdout_handler.setFormatter(formatter)
    stdout_handler.addFilter(redactor)
    root.addHandler(stdout_handler)

    # File handler (best-effort: skip if path is not writable, e.g. shared Docker volume)
    try:
        file_handler = logging.FileHandler(os.path.join(log_path, "ai-service.log"), encoding="utf-8")
        file_handler.setFormatter(formatter)
        file_handler.addFilter(redactor)
        root.addHandler(file_handler)
    except (PermissionError, OSError) as exc:
        root.warning("File logging disabled — %s. Falling back to stdout only.", exc)

    # Suppress noisy libraries
    for name in ("httpx", "httpcore", "uvicorn.access", "watchfiles"):
        logging.getLogger(name).setLevel(logging.WARNING)
