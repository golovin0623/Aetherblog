from __future__ import annotations

import json
import logging
import os
import re
import traceback
from datetime import datetime, timezone


# 安全 (VULN-165): 基于正则的 API-key / Bearer token 清洗器,在每条日志记录
# 序列化到 stdout 或滚动文件**之前**应用。防止 LiteLLM 的异常 trace / debug dump
# 把 provider key 泄露到 logs volume (该卷与 Go 后端共享 —— VULN-146)。
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
    """在日志输出前抹掉 provider secret,无论调用方是否做了清洗。"""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            # 改写 message payload; getMessage() 会基于 record.args 对 record.msg
            # 重新格式化,所以这里规整为一个已格式化好的字符串。
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
        # 从 extra 里取 TraceId
        trace_id = getattr(record, "traceId", None)
        if trace_id:
            entry["traceId"] = trace_id
        # 异常信息
        if record.exc_info and record.exc_info[0]:
            entry["data"] = {"exception": traceback.format_exception(*record.exc_info)}
        # 任意附加数据
        extra_data = getattr(record, "data", None)
        if extra_data:
            entry.setdefault("data", {}).update(extra_data) if isinstance(extra_data, dict) else None
        return json.dumps(entry, ensure_ascii=False)


def _try_open_log_file(directory: str) -> logging.FileHandler | None:
    """尝试在 ``directory`` 下打开 ``ai-service.log``。

    成功时返回 handler,如果目录无法创建或写入则返回 ``None``。
    用于走一条 fallback chain (named volume → tmpfs),
    避免某台老宿主上 ``aetherblog_logs`` 卷归属错乱时,
    服务彻底失去文件日志能力。
    """
    try:
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, "ai-service.log")
        return logging.FileHandler(path, encoding="utf-8")
    except (PermissionError, OSError):
        return None


def setup_logging(log_path: str = "./logs", level: str = "INFO"):
    """以 JSON 格式配置日志,同时输出到 stdout 和文件。

    日志文件采用尽力而为策略: 若 ``log_path`` 不可写 (典型情况:
    共享的 ``aetherblog_logs`` Docker 卷被旧版镜像以另一个 UID 创建),
    则回退到 ``/tmp/ai-service.log`` (生产里就是 tmpfs),最终回退到仅 stdout。
    旧实现每次容器启动都会打一行 ``warning``,在 ``docker compose logs`` 里成了噪声;
    现在仅在真正发生 fallback 时记录一次 ``info``。
    """
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    # 清空已有的 handler
    root.handlers.clear()

    formatter = JSONFormatter()
    redactor = SecretRedactor()

    # Stdout handler —— 主要 sink,始终存在。
    stdout_handler = logging.StreamHandler()
    stdout_handler.setFormatter(formatter)
    stdout_handler.addFilter(redactor)
    root.addHandler(stdout_handler)

    # 带 fallback chain 的文件 handler。
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
    # else: 仅 stdout 是最终回退;通过 docker logs / SystemMonitor,
    # 容器日志依然能采集到全部信息。

    # 抑制噪声库的日志
    for name in ("httpx", "httpcore", "uvicorn.access", "watchfiles"):
        logging.getLogger(name).setLevel(logging.WARNING)
