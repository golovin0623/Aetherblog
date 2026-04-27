"""AI service 测试用的 Pytest fixture 与全局初始化。

为 ``app.core.config.Settings`` 在构造期所需的最小环境变量提供兜底。
没有这层兜底，测试收集期 import 任何 ``app.*`` 模块都会抛出
``ValidationError`` —— 因为 JWT_SECRET、AI_INTERNAL_SERVICE_TOKEN、
AI_CREDENTIAL_ENCRYPTION_KEYS、POSTGRES_DSN 这些 secret 在 Settings
中被标注为 ``Field(...)``（必填）。

本 fixture 会在测试收集 *之前* 运行（autouse + session scope）。
"""

from __future__ import annotations

import os

# 仅设置默认值 —— 永远不要覆盖 CI / 开发者 shell 已经提供的值。
_DEFAULTS = {
    # 既有测试（例如 tests/test_deps.py）使用字面量 ``"test-secret"`` 签名
    # token；保持一致以避免签名校验失败。
    "JWT_SECRET": "test-secret",
    "AI_INTERNAL_SERVICE_TOKEN": "pytest-internal-service-token-minimum-32-chars",
    # VULN-056：真实可用的 Fernet key（启动期会校验）；生成方式：
    # python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    "AI_CREDENTIAL_ENCRYPTION_KEYS": "j2V7X9f8TMZLMTipxOmI1oDV4MherQCh_MN2gXszJyg=",
    "POSTGRES_DSN": "postgresql://test:test@localhost:5432/test_db",
}

for _key, _value in _DEFAULTS.items():
    os.environ.setdefault(_key, _value)
