# 模型能力规范化与推断 —— 统一三层（前端 / Python / Go）的能力词表
# ref: §5.1 - AI Service 架构 · 模型中心能力对齐
#
# 设计动机
# --------
# 历史上能力标志散落在多处、命名不一致：远程抓取写 ``tools`` / ``file_upload`` /
# ``web_search``，前端读 ``functionCall`` / ``files`` / ``search``，结果是远程拉取的
# 模型在管理端能力徽章全部丢失。本模块提供唯一的「规范词表 + 别名映射 + 启发式推断」，
# 让任何入口（远程抓取、批量导入、管理端回写）都收敛到同一组 camelCase 标志。
#
# 该模块**纯函数、零网络、零 IO**，可独立单测，是能力对齐的事实基准（source of truth）。

from __future__ import annotations

import re
from typing import Any, Iterable

# 规范能力标志（与前端 ModelAbility 一一对应）
CANONICAL_ABILITIES: tuple[str, ...] = (
    "functionCall",
    "vision",
    "reasoning",
    "search",
    "imageOutput",
    "video",
    "files",
    "structuredOutput",
)

# 别名 → 规范键。键统一小写、去分隔符后匹配，覆盖 snake_case / 缩写 / 旧版命名。
_ABILITY_ALIASES: dict[str, str] = {
    # functionCall
    "functioncall": "functionCall",
    "function_call": "functionCall",
    "function_calling": "functionCall",
    "functioncalling": "functionCall",
    "tools": "functionCall",
    "tool": "functionCall",
    "tooluse": "functionCall",
    "tool_use": "functionCall",
    "fc": "functionCall",
    # vision
    "vision": "vision",
    "visual": "vision",
    "image_input": "vision",
    "imageinput": "vision",
    "multimodal": "vision",
    # reasoning
    "reasoning": "reasoning",
    "reason": "reasoning",
    "thinking": "reasoning",
    "chain_of_thought": "reasoning",
    # search
    "search": "search",
    "websearch": "search",
    "web_search": "search",
    "onlinesearch": "search",
    "grounding": "search",
    # imageOutput
    "imageoutput": "imageOutput",
    "image_output": "imageOutput",
    "image_generation": "imageOutput",
    "imagegeneration": "imageOutput",
    "text2image": "imageOutput",
    # video
    "video": "video",
    "videooutput": "video",
    "video_output": "video",
    "text2video": "video",
    # files
    "files": "files",
    "file": "files",
    "fileupload": "files",
    "file_upload": "files",
    "document": "files",
    # structuredOutput
    "structuredoutput": "structuredOutput",
    "structured_output": "structuredOutput",
    "json": "structuredOutput",
    "jsonmode": "structuredOutput",
    "json_mode": "structuredOutput",
    "json_schema": "structuredOutput",
}

# 非对话模型类型（不参与对话路由，能力推断逻辑也不同）
NON_CHAT_TYPES: frozenset[str] = frozenset(
    {"embedding", "tts", "stt", "image", "audio", "realtime", "text2video", "text2music", "video"}
)


def _norm_key(value: str) -> str:
    """归一化能力键：转小写并剔除空格 / 连字符 / 下划线，使别名匹配对书写宽容。"""
    return re.sub(r"[\s\-_]+", "", value.strip().lower())


def _iter_flag_tokens(value: Any) -> Iterable[str]:
    """从 list / 逗号空格分隔串 / dict 里提取「被置真」的能力 token。"""
    if value is None:
        return []
    if isinstance(value, dict):
        out: list[str] = []
        for key, val in value.items():
            if val is True or (isinstance(val, (int, float)) and val) or (
                isinstance(val, str) and val.strip().lower() in {"1", "true", "yes", "on"}
            ):
                out.append(str(key))
        return out
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value]
    if isinstance(value, str):
        return [tok for tok in re.split(r"[,\s|]+", value) if tok]
    return []


def normalize_abilities(*sources: Any) -> dict[str, bool]:
    """把任意来源（dict / list / csv 字符串，可多个叠加）规范化为「只含 True 标志」的字典。

    多个来源按顺序合并，任一来源命中即视为支持。未知 token 静默忽略，便于向前兼容。

    >>> normalize_abilities({"tools": True, "file_upload": True})
    {'functionCall': True, 'files': True}
    >>> normalize_abilities("fc, vision")
    {'functionCall': True, 'vision': True}
    """
    result: dict[str, bool] = {}
    for source in sources:
        for token in _iter_flag_tokens(source):
            canonical = _ABILITY_ALIASES.get(_norm_key(token))
            if canonical:
                result[canonical] = True
    # 按规范顺序输出，保证序列化稳定（便于缓存键与快照测试）
    return {key: True for key in CANONICAL_ABILITIES if result.get(key)}


# ------------------------------------------------------------------
# 模型类型推断
# ------------------------------------------------------------------
_TYPE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("embedding", re.compile(r"embed|bge-|gte-|text-embedding|m3e|jina-clip")),
    ("stt", re.compile(r"whisper|\bstt\b|speech-to-text|transcribe|asr")),
    ("tts", re.compile(r"\btts\b|text-to-speech|speech-0|sovits|cosyvoice")),
    ("realtime", re.compile(r"realtime|live-")),
    ("text2music", re.compile(r"music|suno|\bmusicgen\b|\blyria\b")),
    ("text2video", re.compile(r"video|sora|\bveo\b|kling|cogvideo|wan-|seedance|hunyuan-video")),
    ("image", re.compile(r"dall-?e|gpt-image|flux|stable-?diffusion|\bsd3\b|\bsdxl\b|imagen|seedream|kolors|midjourney|playground-v|ideogram|recraft")),
)


def infer_model_type(model_id: str) -> str:
    """从模型 ID 启发式推断类型；无法判定时回落到 ``chat``。"""
    lower = (model_id or "").lower()
    for model_type, pattern in _TYPE_PATTERNS:
        if pattern.search(lower):
            return model_type
    return "chat"


# ------------------------------------------------------------------
# 能力启发式推断（best-effort，管理端可人工覆盖）
# ------------------------------------------------------------------
# 这些正则基于「公开模型命名约定」整理，仅用于在远程抓取没有结构化能力字段时给出
# 合理默认值，降低管理员逐个勾选的负担；判定保守，宁缺毋滥。
_VISION_RE = re.compile(
    r"gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|o3|o4|"
    r"claude-3|claude-4|claude-opus|claude-sonnet|claude-haiku|"
    r"gemini|grok-(?:2-)?vision|grok-3|grok-4|"
    r"-vl\b|\bvl-|vision|llava|pixtral|qwen-?vl|qwen2\.?5?-?vl|internvl|"
    r"glm-4v|glm-4\.\dv|step-1v|step-1o|molmo|llama-?3\.2|llama-?4|phi-4-multimodal|mistral-small-3"
)
_REASONING_RE = re.compile(
    r"\bo1\b|\bo1-|\bo3\b|\bo3-|\bo4-|gpt-5|"
    r"-thinking|thinking-|reasoner|deepseek-r\d|\bqwq\b|qwen3?-?.*thinking|"
    r"grok-3-mini|grok-4|magistral|phi-4-reasoning|\br1\b|glm-z1|hunyuan-t1|step-3|skywork-o1|minimax-m1|kimi-k2-thinking|seed-thinking"
)
_SEARCH_RE = re.compile(r"sonar|-search|search-|perplexity|gemini.*-online|online")
_IMAGE_OUT_RE = re.compile(
    r"dall-?e|gpt-image|flux|stable-?diffusion|\bsd3\b|\bsdxl\b|imagen|seedream|kolors|"
    r"midjourney|ideogram|recraft|playground-v|nano-banana|gemini-.*-image|qwen-image"
)
# 明显不支持工具调用的「补全期 / 基座」模型
_NO_TOOL_RE = re.compile(r"davinci|babbage|curie|ada|-base\b|instruct-base|moderation")


def infer_capabilities(model_id: str, model_type: str | None = None) -> dict[str, bool]:
    """根据模型 ID（及可选类型）推断规范能力标志，返回「只含 True」的字典。

    - 非对话类型走类型专属逻辑（embedding 无能力、image 仅 imageOutput 等）；
    - 对话类型默认具备工具调用 / 结构化输出（现代对话模型的普遍能力），再叠加视觉 /
      推理 / 搜索等按命名判定的能力。
    """
    lower = (model_id or "").lower()
    mtype = model_type or infer_model_type(model_id)
    abilities: dict[str, bool] = {}

    if mtype in NON_CHAT_TYPES:
        if mtype == "image":
            abilities["imageOutput"] = True
        elif mtype in ("text2video", "video"):
            abilities["video"] = True
        # embedding / tts / stt / realtime / music 不暴露对话能力标志
        return {key: True for key in CANONICAL_ABILITIES if abilities.get(key)}

    # —— 对话模型 ——
    if not _NO_TOOL_RE.search(lower):
        abilities["functionCall"] = True
        abilities["structuredOutput"] = True
    if _VISION_RE.search(lower):
        abilities["vision"] = True
    if _REASONING_RE.search(lower):
        abilities["reasoning"] = True
    if _SEARCH_RE.search(lower):
        abilities["search"] = True
    if _IMAGE_OUT_RE.search(lower):
        abilities["imageOutput"] = True

    return {key: True for key in CANONICAL_ABILITIES if abilities.get(key)}

