from __future__ import annotations

import json
import logging
import os
import traceback
from datetime import datetime, timezone


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

    # Stdout handler
    stdout_handler = logging.StreamHandler()
    stdout_handler.setFormatter(formatter)
    root.addHandler(stdout_handler)

    # File handler (best-effort: skip if path is not writable, e.g. shared Docker volume)
    try:
        file_handler = logging.FileHandler(os.path.join(log_path, "ai-service.log"), encoding="utf-8")
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)
    except (PermissionError, OSError) as exc:
        root.warning("File logging disabled — %s. Falling back to stdout only.", exc)

    # Suppress noisy libraries
    for name in ("httpx", "httpcore", "uvicorn.access", "watchfiles"):
        logging.getLogger(name).setLevel(logging.WARNING)
