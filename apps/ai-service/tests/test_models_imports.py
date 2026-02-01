from __future__ import annotations

from app.models.provider import AiProvider, AiModel, ApiType, ModelType
from app.models.credential import AiCredential
from app.models.routing import AiTaskType, AiTaskRouting


def test_model_classes_import_and_repr():
    provider = AiProvider(code="openai", name="OpenAI", api_type=ApiType.OPENAI_COMPAT.value)
    model = AiModel(provider_id=1, model_id="gpt-test", model_type=ModelType.CHAT.value)
    cred = AiCredential(provider_id=1, api_key_encrypted="enc", api_key_hint="sk-...123")
    task = AiTaskType(code="summary", name="Summary")
    routing = AiTaskRouting(task_type_id=1, primary_model_id=1)

    assert "AiProvider" in repr(provider)
    assert "AiModel" in repr(model)
    assert provider.api_type == ApiType.OPENAI_COMPAT.value
    assert model.model_type == ModelType.CHAT.value
    assert cred.api_key_hint == "sk-...123"
    assert task.code == "summary"
    assert routing.primary_model_id == 1
