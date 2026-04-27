# ref: §5.1 - Provider API schema
"""
Provider API 端点对应的 Pydantic schema。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ProviderResponse(BaseModel):
    """Provider 信息响应。"""
    id: int
    code: str
    name: str
    display_name: str | None
    api_type: str
    base_url: str | None
    doc_url: str | None
    icon: str | None
    is_enabled: bool
    priority: int
    capabilities: dict[str, Any]
    config_schema: dict[str, Any] | None


class ModelResponse(BaseModel):
    """Model 信息响应。"""
    id: int
    provider_id: int
    provider_code: str
    model_id: str
    display_name: str | None
    model_type: str
    context_window: int | None
    max_output_tokens: int | None
    input_cost_per_1k: float | None
    output_cost_per_1k: float | None
    input_cost_per_1m: float | None
    output_cost_per_1m: float | None
    cached_input_cost_per_1m: float | None
    capabilities: dict[str, Any]
    is_enabled: bool


class CredentialCreate(BaseModel):
    """创建凭证的请求。"""
    provider_code: str
    api_key: str
    name: str | None = None
    base_url_override: str | None = None
    is_default: bool = False
    extra_config: dict[str, Any] | None = None


class ProviderCreate(BaseModel):
    """创建 provider 的请求。

    安全 (VULN-173): 每个用户输入的字符串都强制最大长度,
    (在适用情况下) 还附加字符类约束。否则 admin 可以把数 MB 的 ``description``
    塞进数据库,把每个 ``/providers`` 列表响应吹到很大 ——
    既是廉价 DoS 角度,也会让日志膨胀。``code`` 进一步被限制为 kebab/下划线 slug,
    因为它会被直接拼进 URL path 和 SQL 查询,后续不会再做校验。
    """
    code: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9][a-z0-9_-]{0,49}$")
    name: str = Field(min_length=1, max_length=100)
    display_name: str | None = Field(default=None, max_length=200)
    api_type: str = Field(default="openai_compat", max_length=32)
    base_url: str | None = Field(default=None, max_length=2048)
    doc_url: str | None = Field(default=None, max_length=2048)
    icon: str | None = Field(default=None, max_length=2048)
    is_enabled: bool = True
    priority: int = 0
    capabilities: dict[str, Any] = Field(default_factory=dict)
    config_schema: dict[str, Any] | None = None


class ProviderUpdate(BaseModel):
    """更新 provider 的请求。"""
    name: str | None = Field(default=None, min_length=1, max_length=100)
    display_name: str | None = Field(default=None, max_length=200)
    api_type: str | None = Field(default=None, max_length=32)
    base_url: str | None = Field(default=None, max_length=2048)
    doc_url: str | None = Field(default=None, max_length=2048)
    icon: str | None = Field(default=None, max_length=2048)
    is_enabled: bool | None = None
    priority: int | None = None
    capabilities: dict[str, Any] | None = None
    config_schema: dict[str, Any] | None = None


class ProviderBatchToggleRequest(BaseModel):
    """批量切换 provider 启用状态。"""
    ids: list[int]
    enabled: bool


class ModelCreate(BaseModel):
    """创建 model 的请求。"""
    model_id: str = Field(min_length=1, max_length=100)
    display_name: str | None = None
    model_type: str = Field(default="chat")
    context_window: int | None = None
    max_output_tokens: int | None = None
    input_cost_per_1k: float | None = None
    output_cost_per_1k: float | None = None
    input_cost_per_1m: float | None = None
    output_cost_per_1m: float | None = None
    cached_input_cost_per_1m: float | None = None
    capabilities: dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool = True


class ModelUpdate(BaseModel):
    """更新 model 的请求。"""
    display_name: str | None = None
    model_type: str | None = None
    context_window: int | None = None
    max_output_tokens: int | None = None
    input_cost_per_1k: float | None = None
    output_cost_per_1k: float | None = None
    input_cost_per_1m: float | None = None
    output_cost_per_1m: float | None = None
    cached_input_cost_per_1m: float | None = None
    capabilities: dict[str, Any] | None = None
    is_enabled: bool | None = None


class ModelSyncRequest(BaseModel):
    """拉取远端 model 列表的请求。"""
    credential_id: int | None = None


class ModelSyncResponse(BaseModel):
    """远端 model 同步的响应。"""
    inserted: int
    total: int


class ModelBatchToggleRequest(BaseModel):
    """批量切换 model 启用状态。"""
    ids: list[int]
    enabled: bool


class ModelSortItem(BaseModel):
    id: int
    sort: int


class ModelSortRequest(BaseModel):
    items: list[ModelSortItem]


class CredentialResponse(BaseModel):
    """凭证信息响应 (不含 API key)。"""
    id: int
    name: str | None
    api_key_hint: str | None
    provider_code: str
    provider_name: str | None
    base_url_override: str | None
    extra_config: dict[str, Any] | None = None
    is_default: bool
    is_enabled: bool
    last_used_at: datetime | None
    last_error: str | None
    created_at: datetime


class CredentialTestRequest(BaseModel):
    """测试凭证的请求。"""
    model_id: str = Field(default="gpt-5-mini", description="Model to test")


class CredentialTestResponse(BaseModel):
    """凭证测试的响应。"""
    success: bool
    message: str
    latency_ms: float | None = None


class TaskTypeResponse(BaseModel):
    """任务类型信息。"""
    code: str
    name: str
    description: str | None
    model_type: str | None
    temperature: float | None
    max_tokens: int | None


class RoutingResponse(BaseModel):
    """路由配置响应。"""
    task_type: str
    primary_model: ModelResponse | None
    fallback_model: ModelResponse | None
    config: dict[str, Any]
    # credential_id: 管理端保存时写入的凭证 ID; None 代表未绑定凭证.
    # credential_configured: 是否确实能解析到凭证 (未绑定 ID 时会尝试在 provider
    # 下找默认/首个可用凭证). False 代表该路由虽然保存了 model, 但缺少可用凭证,
    # 运行时会降级到 env 默认, 前端应向用户提示.
    credential_id: int | None = None
    credential_configured: bool = False


class RoutingUpdateRequest(BaseModel):
    """更新路由配置的请求。"""
    primary_model_id: int | None = None
    fallback_model_id: int | None = None
    credential_id: int | None = None
    config_override: dict[str, Any] | None = None
