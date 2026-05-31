# ref: §5.1 - 全局模型价格 / LiteLLM 价格目录
"""
价格目录（pricing catalog）—— 自动价格同步的数据来源。

业界中转站（NewAPI / one-api 等）最终都参照 BerriAI/litellm 维护的
``model_prices_and_context_window.json`` 作为「绝对价基准」。本服务已把
``litellm`` 列为依赖，运行时即可通过 ``litellm.model_cost`` 拿到这张表
（~1000+ 模型，单位 USD/token），无需任何网络请求。

本模块只做两件事：
1. 把 ``litellm.model_cost`` 归一化成 ``model_id -> CatalogEntry``（USD / 1M tokens）。
2. 提供「数据库 model_id → 目录条目」的匹配级联：精确 → 去供应商前缀 →
   去日期/版本后缀 → 大小写不敏感，对齐 NewAPI 同步时的归一约定。

匹配纯函数（``candidate_forms`` / ``PricingCatalog.match``）不依赖 litellm，
便于单测。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

TOKENS_PER_MILLION = 1_000_000

# 去掉模型名尾部的日期 / 版本快照后缀：
# -2024-08-06 / -20240806 / -240806 / -1106 / -0125 / -0613 / @001 / -latest / -preview
# 3-4 位覆盖 OpenAI/Anthropic 常见的 MMDD / 年份快照（gpt-4-1106、gpt-3.5-turbo-0613），
# 仍不动单数字版本号（gpt-4 不会被截成 gpt）。
_DATE_SUFFIX_RE = re.compile(
    r"[-@](\d{4}-\d{2}-\d{2}|\d{8}|\d{6}|\d{3,4}|latest|preview)$",
    re.IGNORECASE,
)


class PricingCatalogUnavailable(RuntimeError):
    """数据源不可用（litellm 未安装 / model_cost 缺失）。"""


@dataclass(frozen=True)
class CatalogEntry:
    source_key: str
    input_per_1m: float | None
    output_per_1m: float | None
    cached_input_per_1m: float | None
    mode: str | None


def _per_1m(value: object) -> float | None:
    """USD/token → USD/1M tokens；``< 0`` 视为「无该项数据」返回 None。

    ``0`` 是合法价格（免费 / 本地开源模型），保留为 ``0.0`` 以便同步；
    litellm 对未知定价是省略该字段（→ None），不会填 0。
    """
    if value is None:
        return None
    try:
        v = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if v < 0:
        return None
    return round(v * TOKENS_PER_MILLION, 6)


def _normalize(name: str) -> str:
    return name.strip().lower()


def _strip_prefix(name: str) -> str:
    """去掉供应商前缀：``deepseek-ai/deepseek-v3`` → ``deepseek-v3``。"""
    return name.rsplit("/", 1)[-1]


def _strip_date(name: str) -> str:
    return _DATE_SUFFIX_RE.sub("", name)


def candidate_forms(name: str) -> list[str]:
    """按「从精确到宽松」的顺序，给出一个名字的归一化候选形式（去重、保序）。"""
    forms: list[str] = []

    def add(value: str) -> None:
        if value and value not in forms:
            forms.append(value)

    base = _normalize(name)
    no_prefix = _strip_prefix(base)
    add(base)
    add(no_prefix)
    add(_strip_date(base))
    add(_strip_date(no_prefix))
    return forms


class PricingCatalog:
    """一份只读价格目录 + 归一化匹配索引。"""

    def __init__(self, entries: dict[str, CatalogEntry], *, source: str) -> None:
        self.source = source
        self.model_count = len(entries)
        # 单索引：先填精确（全名小写）形式占位，宽松形式只 setdefault 不覆盖精确项。
        self._index: dict[str, CatalogEntry] = {}
        for key, entry in entries.items():
            self._index.setdefault(_normalize(key), entry)
        for key, entry in entries.items():
            base = _normalize(key)
            for form in (
                _strip_prefix(base),
                _strip_date(base),
                _strip_date(_strip_prefix(base)),
            ):
                if form and form != base:
                    self._index.setdefault(form, entry)

    def match(self, model_id: str) -> tuple[CatalogEntry | None, str | None]:
        """返回 (命中的目录条目, 命中所用的归一化形式)；未命中则 (None, None)。"""
        for form in candidate_forms(model_id):
            entry = self._index.get(form)
            if entry is not None:
                return entry, form
        return None, None


_CATALOG_CACHE: dict[str, PricingCatalog] = {}


def _load_litellm_entries() -> dict[str, CatalogEntry]:
    try:
        import litellm
    except ImportError as exc:  # pragma: no cover - 依赖缺失才会触发
        raise PricingCatalogUnavailable("litellm 未安装，无法加载内置价格表") from exc

    raw = getattr(litellm, "model_cost", None)
    if not isinstance(raw, dict) or not raw:
        raise PricingCatalogUnavailable("litellm.model_cost 不可用或为空")

    entries: dict[str, CatalogEntry] = {}
    for key, spec in raw.items():
        # "sample_spec" 是 litellm 自带的字段说明文档条目，并非真实模型。
        if not isinstance(key, str) or key == "sample_spec" or not isinstance(spec, dict):
            continue
        input_per_1m = _per_1m(spec.get("input_cost_per_token"))
        output_per_1m = _per_1m(spec.get("output_cost_per_token"))
        cached_per_1m = _per_1m(spec.get("cache_read_input_token_cost"))
        if input_per_1m is None and output_per_1m is None:
            continue
        mode = spec.get("mode")
        entries[key] = CatalogEntry(
            source_key=key,
            input_per_1m=input_per_1m,
            output_per_1m=output_per_1m,
            cached_input_per_1m=cached_per_1m,
            mode=mode if isinstance(mode, str) else None,
        )
    if not entries:
        raise PricingCatalogUnavailable("litellm 价格表里没有可用的定价条目")
    return entries


def get_catalog(source: str = "litellm", *, force_reload: bool = False) -> PricingCatalog:
    """加载（并缓存）指定数据源的价格目录。

    目前只支持 ``litellm`` 内置表；该表导入后是静态的，故进程内缓存。
    """
    if source != "litellm":
        raise PricingCatalogUnavailable(f"不支持的价格数据源: {source}")
    if not force_reload and source in _CATALOG_CACHE:
        return _CATALOG_CACHE[source]
    catalog = PricingCatalog(_load_litellm_entries(), source=source)
    _CATALOG_CACHE[source] = catalog
    return catalog
