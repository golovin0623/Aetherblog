from __future__ import annotations

from app.services.model_capabilities import (
    CANONICAL_ABILITIES,
    infer_capabilities,
    infer_model_type,
    normalize_abilities,
)


# ------------------------------------------------------------------
# normalize_abilities
# ------------------------------------------------------------------
def test_normalize_abilities_maps_legacy_dict_keys():
    out = normalize_abilities({"tools": True, "file_upload": True, "web_search": True})
    assert out == {"functionCall": True, "search": True, "files": True}


def test_normalize_abilities_accepts_csv_and_abbreviations():
    assert normalize_abilities("fc, vision") == {"functionCall": True, "vision": True}
    assert normalize_abilities(["fc", "structured_output"]) == {
        "functionCall": True,
        "structuredOutput": True,
    }


def test_normalize_abilities_ignores_unknown_and_falsey():
    out = normalize_abilities({"vision": True, "telepathy": True, "tools": False})
    assert out == {"vision": True}


def test_normalize_abilities_merges_multiple_sources():
    out = normalize_abilities({"vision": True}, "fc", ["reasoning"])
    assert out == {"functionCall": True, "vision": True, "reasoning": True}


def test_normalize_abilities_output_is_canonically_ordered():
    out = normalize_abilities("structuredOutput, vision, fc")
    assert list(out.keys()) == [k for k in CANONICAL_ABILITIES if k in out]
    # functionCall 先于 vision 先于 structuredOutput
    assert list(out.keys()) == ["functionCall", "vision", "structuredOutput"]


def test_normalize_abilities_handles_none_and_empty():
    assert normalize_abilities(None) == {}
    assert normalize_abilities("") == {}
    assert normalize_abilities({}) == {}


def test_normalize_abilities_accepts_truthy_int_and_string_values():
    out = normalize_abilities({"vision": 1, "tools": "yes", "files": "off"})
    assert out == {"functionCall": True, "vision": True}


def test_normalize_abilities_ignores_unsupported_scalar_source():
    # 整数等无法解析为标志的输入应安全返回空
    assert normalize_abilities(123) == {}


# ------------------------------------------------------------------
# infer_model_type
# ------------------------------------------------------------------
def test_infer_model_type_variants():
    assert infer_model_type("text-embedding-3-large") == "embedding"
    assert infer_model_type("whisper-1") == "stt"
    assert infer_model_type("tts-1-hd") == "tts"
    assert infer_model_type("gpt-4o-realtime-preview") == "realtime"
    assert infer_model_type("dall-e-3") == "image"
    assert infer_model_type("flux-1.1-pro") == "image"
    assert infer_model_type("sora-2") == "text2video"
    assert infer_model_type("gpt-5") == "chat"
    assert infer_model_type("") == "chat"


# ------------------------------------------------------------------
# infer_capabilities
# ------------------------------------------------------------------
def test_infer_capabilities_modern_chat_has_tools_and_structured():
    caps = infer_capabilities("gpt-4o-mini")
    assert caps.get("functionCall") is True
    assert caps.get("structuredOutput") is True
    assert caps.get("vision") is True


def test_infer_capabilities_reasoning_models():
    assert infer_capabilities("o3-mini").get("reasoning") is True
    assert infer_capabilities("deepseek-r1").get("reasoning") is True
    assert infer_capabilities("qwq-32b").get("reasoning") is True


def test_infer_capabilities_search_models():
    assert infer_capabilities("sonar-pro").get("search") is True


def test_infer_capabilities_embedding_has_no_chat_flags():
    caps = infer_capabilities("text-embedding-3-small")
    assert caps == {}


def test_infer_capabilities_image_model():
    caps = infer_capabilities("dall-e-3")
    assert caps == {"imageOutput": True}


def test_infer_capabilities_text2video_model():
    assert infer_capabilities("sora-2") == {"video": True}


def test_infer_capabilities_chat_model_with_image_output():
    # 对话型多模态出图模型应在保留对话能力的同时带 imageOutput
    caps = infer_capabilities("gemini-2.5-flash-image-preview")
    assert caps.get("imageOutput") is True
    assert caps.get("functionCall") is True


def test_infer_capabilities_base_completion_model_has_no_tools():
    caps = infer_capabilities("davinci-002")
    assert "functionCall" not in caps


def test_infer_capabilities_respects_explicit_type():
    # 显式给定 embedding 类型时不应注入对话能力
    assert infer_capabilities("some-custom-model", model_type="embedding") == {}
