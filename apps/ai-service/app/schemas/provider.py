# ref: §5.1 - Provider API Schemas
"""
Pydantic schemas for provider API endpoints.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ProviderResponse(BaseModel):
    """Provider information response."""
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
    """Model information response."""
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
    capabilities: dict[str, Any]
    is_enabled: bool


class CredentialCreate(BaseModel):
    """Request to create a credential."""
    provider_code: str
    api_key: str
    name: str | None = None
    base_url_override: str | None = None
    is_default: bool = False
    extra_config: dict[str, Any] | None = None


class ProviderCreate(BaseModel):
    """Request to create a provider."""
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=100)
    display_name: str | None = None
    api_type: str = Field(default="openai_compat")
    base_url: str | None = None
    doc_url: str | None = None
    icon: str | None = None
    is_enabled: bool = True
    priority: int = 0
    capabilities: dict[str, Any] = Field(default_factory=dict)
    config_schema: dict[str, Any] | None = None


class ProviderUpdate(BaseModel):
    """Request to update a provider."""
    name: str | None = None
    display_name: str | None = None
    api_type: str | None = None
    base_url: str | None = None
    doc_url: str | None = None
    icon: str | None = None
    is_enabled: bool | None = None
    priority: int | None = None
    capabilities: dict[str, Any] | None = None
    config_schema: dict[str, Any] | None = None


class ModelCreate(BaseModel):
    """Request to create a model."""
    model_id: str = Field(min_length=1, max_length=100)
    display_name: str | None = None
    model_type: str = Field(default="chat")
    context_window: int | None = None
    max_output_tokens: int | None = None
    input_cost_per_1k: float | None = None
    output_cost_per_1k: float | None = None
    capabilities: dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool = True


class ModelUpdate(BaseModel):
    """Request to update a model."""
    display_name: str | None = None
    model_type: str | None = None
    context_window: int | None = None
    max_output_tokens: int | None = None
    input_cost_per_1k: float | None = None
    output_cost_per_1k: float | None = None
    capabilities: dict[str, Any] | None = None
    is_enabled: bool | None = None


class CredentialResponse(BaseModel):
    """Credential information response (without API key)."""
    id: int
    name: str | None
    api_key_hint: str | None
    provider_code: str
    provider_name: str | None
    base_url_override: str | None
    is_default: bool
    is_enabled: bool
    last_used_at: datetime | None
    last_error: str | None
    created_at: datetime


class CredentialTestRequest(BaseModel):
    """Request to test a credential."""
    model_id: str = Field(default="gpt-4o-mini", description="Model to test")


class CredentialTestResponse(BaseModel):
    """Response from credential test."""
    success: bool
    message: str
    latency_ms: float | None = None


class TaskTypeResponse(BaseModel):
    """Task type information."""
    code: str
    name: str
    description: str | None
    model_type: str | None
    temperature: float | None
    max_tokens: int | None


class RoutingResponse(BaseModel):
    """Routing configuration response."""
    task_type: str
    primary_model: ModelResponse | None
    fallback_model: ModelResponse | None
    config: dict[str, Any]


class RoutingUpdateRequest(BaseModel):
    """Request to update routing configuration."""
    primary_model_id: int | None = None
    fallback_model_id: int | None = None
    credential_id: int | None = None
    config_override: dict[str, Any] | None = None
