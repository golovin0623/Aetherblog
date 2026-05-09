# 02 · LiteLLM 接入层 / Provider 矩阵 / 模型路由

## 范围

`LlmRouter` 是 ai-service 的唯一 LLM 调用面 — 所有 `chat / stream_chat / embed` 都从这里出去。本文覆盖:

- LiteLLM 抽象边界:`acompletion / aembedding` 是怎么被复用的
- provider 抽象的折衷:为什么 ai-service 没有「provider 类」
- 模型路由四层优先级
- temperature / max_tokens / api_base 的折衷
- fallback 与 override 的互斥
- 已支持的 provider 矩阵 + 用户级凭证选择

---

## 1. LiteLLM 调用面(`app/services/llm_router.py:22`)

`from litellm import acompletion, aembedding` — **整个项目只在这一处 import 实际的 LLM SDK**。

```python
response = await acompletion(
    model=resolved.model,         # "openai/gpt-5-mini" / "claude-3-5-sonnet-..." / "azure/..."
    messages=messages,            # OpenAI 格式 [{role, content}, ...]
    api_key=resolved.api_key,     # 来自 ai_credentials 解密
    api_base=resolved.api_base,   # 已经过 SSRF 守卫
    **_completion_kwargs(model=resolved.model, temperature=..., max_tokens=...),
)
```

LiteLLM 在内部按模型名前缀派发到对应 provider 客户端:

| 前缀 | 实际 SDK | 我们的 api_type |
|---|---|---|
| `openai/<model>` | OpenAI Python SDK | `openai_compat`(任意 OpenAI 兼容中转)/`custom` |
| `azure/<model>` | OpenAI SDK + Azure 模式 | `azure` |
| `claude-3-*` 等(无前缀) | Anthropic SDK | `anthropic` |
| `gemini-*` 等(无前缀) | google-cloud / 直连 SDK | `google` |

> **`_prefix_model_for_litellm`**(`llm_router.py:192-225`)是这个映射表的实现。它的核心是「让 LiteLLM 看到正确前缀」:openai_compat / custom 必须强制 `openai/` 前缀,否则 LiteLLM 看 `gpt-5-mini` 自作主张走 OpenAI 官方路由,而不是用户配的 oneapi 中转。

### 1.1 为什么不写 provider 类

`LiteLLM` 替代了所有 provider 适配层,我们故意没造 `OpenAIProvider` / `AnthropicProvider` 这种壳。已有的对应表:

| 折衷 | 现状 |
|---|---|
| 「我想细粒度控制 Anthropic 的 `top_k`」 | LiteLLM 透传 kwargs,但需要在 `_completion_kwargs` 加 model-specific 过滤(参考 `_TEMPERATURE_LOCKED_MODEL_PREFIXES`) |
| 「我想批量调用」 | LiteLLM 有 `batch_completion`,目前未接 — 加新方法到 `LlmRouter` 即可 |
| 「我想 mock 单个 provider」 | 测试改 `LlmRouter` 实例的 method 即可,不需要 provider 类 |

**唯一例外**是 `RemoteModelFetcher`(`app/services/remote_model_fetcher.py`)— 它要直接打 `/v1/models` 端点拉模型清单,LiteLLM 没原生 API,所以写了 OpenAI / Anthropic 两个分支(详见 §6.3)。

---

## 2. 模型路由的四层优先级

`LlmRouter._resolve_route`(`llm_router.py:349-405`)按以下顺序尝试:

```
1. override (model_id + provider_code 显式传入,且 allow_override=True)
   ↓ 失败/不传
2. ai_task_routing 行(按 user_id 优先,系统级兜底)
   ↓ 表里没有 enabled 行
3. 环境变量(MODEL_<TASK>_*) + OPENAI_API_KEY 默认凭证
```

每层返回 `_ResolvedRoute` dataclass(`llm_router.py:227-241`):

```python
@dataclass
class _ResolvedRoute:
    model: str                 # LiteLLM 接受的最终形态(已加前缀)
    provider_code: str | None  # 用于落 ai_usage_logs.provider_code
    model_id: str | None
    input_cost_per_1m: float | None
    output_cost_per_1m: float | None
    cached_input_cost_per_1m: float | None
    api_key: str | None
    api_base: str | None
    temperature: float
    max_tokens: int | None
    prompt_template: str | None
    override: bool             # True 时不走 fallback
```

### 2.1 override 路径(`_resolve_override`, llm_router.py:290-347`)

触发条件:

- 调用方传入 `model_id`(可选 `provider_code`);
- `allow_override=True`(`chat()` 默认 True,搜索路径默认 True,`agent_chat` 走另一条 — 详见 §2.4)

校验链:

1. `provider_registry.get_model(model_id, provider_code)` → 返回 `ModelInfo`,缓存命中也行
2. 防 stale-cache 闸:`is_enabled` 必须 True;`model_type` 不在 `NON_CHAT_MODEL_TYPES = {embedding, audio, image, tts, stt, text2video, video}`;`capabilities.chat` 不为 False
3. `credential_resolver.get_credential(provider_code, user_id)` → 必须返回 `CredentialInfo`,否则抛 `Requested model is not available`
4. 加 LiteLLM 前缀
5. **关键**:从 `ai_task_types.prompt_template` 取出该任务的兜底 system prompt(`_load_task_type_prompt`,`llm_router.py:251-288`)。这是 SUMMARY-LONGER-THAN-SOURCE bugfix:override 路径不再裸发文章给模型,而是继承任务自带 system prompt。

### 2.2 routing 路径(`_resolve_route` 默认分支)

调 `model_router.resolve_routing(task_type, user_id)`(`app/services/model_router.py:77-166`):

```sql
SELECT r.id, r.config_override, r.credential_id,
       COALESCE(r.prompt_template, r.config_override->>'prompt_template') as custom_prompt,
       tt.code, tt.default_temperature, tt.default_max_tokens,
       tt.prompt_template as default_prompt,
       pm.id as primary_model_id, pm.model_id as primary_model,
       pp.code as primary_provider_code, pp.base_url as primary_base_url,
       fm.id as fallback_model_id, fm.model_id as fallback_model,
       fp.code as fallback_provider_code
FROM ai_task_routing r
JOIN ai_task_types tt ON r.task_type_id = tt.id
LEFT JOIN ai_models pm ON r.primary_model_id = pm.id
LEFT JOIN ai_providers pp ON pm.provider_id = pp.id
LEFT JOIN ai_models fm ON r.fallback_model_id = fm.id
LEFT JOIN ai_providers fp ON fm.provider_id = fp.id
WHERE tt.code = $1
  AND (r.user_id = $2 OR r.user_id IS NULL)
  AND r.is_enabled = TRUE
ORDER BY r.user_id NULLS LAST  -- 用户级在前
LIMIT 1
```

返回 `RoutingConfig`:含 `model: ModelInfo`、`credential: CredentialInfo`、`config: dict[str, Any]` (`temperature` / `max_tokens` 来自 default + override)、`prompt_template: str | None`、`fallback_model: ModelInfo | None`。

> 对 admin 单管理员博客来说,所有路由都是 `user_id IS NULL` 的系统级行。**特意如此**(`providers.py:941-955`)— 后台 worker(reindex 等)调 `embed()` 不带 user_id,只能命中系统级行;管理员级行会让"UI 改了路由 / 后台仍走旧 routing"漂移。

### 2.3 env_fallback 路径(最低兜底)

`_resolve_route:387-405`:

```python
provider_code, model_id = _normalize_model_parts(self.resolve_model(model_alias))
fallback_prompt_template = await self._load_task_type_prompt(model_alias)
return LlmRouter._ResolvedRoute(
    model=self.resolve_model(model_alias),
    api_key=self.settings.openai_api_key,
    api_base=self.settings.openai_base_url,
    temperature=0.7,
    max_tokens=_TASK_DEFAULT_MAX_TOKENS.get(model_alias),  # summary=600 / tags=200 / ...
    prompt_template=fallback_prompt_template,
    override=False,
)
```

`resolve_model("summary")` 返回 `MODEL_SUMMARY` 环境变量(默认 `gpt-5-mini`)。生产里这条路径基本不该走 — 出现就是"`ai_task_routing` 表里没该 task" 的信号。`embed()` 走这条会落一条 `embed.start_env_fallback` WARNING(`llm_router.py:1054`)。

### 2.4 agent 走另一条解析

`apps/ai-service/app/api/routes/agent.py:257-354`:`_resolve_for_agent` **不**复用 `_resolve_route`,因为后者在 routing 缺失时会落到 env_fallback 把 `"agent"` 字面当模型名传给 LiteLLM,直接 BadRequestError。

agent 自己的解析顺序:

1. 任务别名 fallback `("agent", "qa", "summary")` 顺序找第一个有 routing 的;
2. 全部缺失 → 拿任意启用的 chat 模型 + 该 provider 的凭证(provider_registry 里第一项)。

且 agent 路径**完全禁用 override**(VULN PR #614 加固):Go agent_handler 给所有用户注入内部 token,ai-service 单侧无法区分 admin / 普通用户,所以 `payload.modelId` / `providerCode` 标 DEPRECATED 静默忽略。

---

## 3. Provider 矩阵

### 3.1 已支持的 api_type

`app/models/provider.py:31-37`:

```python
class ApiType(str, Enum):
    OPENAI_COMPAT = "openai_compat"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"
    AZURE = "azure"
    CUSTOM = "custom"
```

### 3.2 真实使用矩阵

| api_type | 是否走 LiteLLM 原生 | 模型前缀 | base_url 处理 | 备注 |
|---|---|---|---|---|
| `openai_compat` | 是,但要前缀 `openai/` | `openai/<model>` | `normalize_api_base` 自动 `/v1` | **绝大多数中转都用这个** — oneapi、new-api、智谱 / DeepSeek / 通义 / 月之暗面 / 火山方舟 / 硅基流动 / SiliconFlow / KIMI 等的 OpenAI 接口形态全部归这 |
| `anthropic` | 是,LiteLLM 原生 `claude-3-*` | 无前缀 | `normalize_api_base` 自动剥 `/v1` | api_key + api_base 直接传给 LiteLLM Anthropic 客户端 |
| `google` | 是,LiteLLM 原生 `gemini-*` | 无前缀 | 直传 | 走 API key 模式;Vertex AI 需要单独凭证(目前不支持) |
| `azure` | 是,LiteLLM 原生 | `azure/<model>` | 直传 | api_base 是 Azure resource endpoint |
| `custom` | 同 `openai_compat` | `openai/` 前缀 | 同上 | 给"我自己写的 LLM 网关"留口子,行为完全等同 openai_compat |

### 3.3 凭证选择优先级(`app/services/credential_resolver.py:197-292`)

```
1. credential_id 显式传入 → 按 id 取(若有 user_id 还要校验归属)
2. user_id 是 None(内部服务 / 后台 worker)→ 该 provider 下任意启用凭证(is_default DESC, id ASC)
3. 普通用户 → 该 provider 下 (user_id 自己 OR NULL) 中 user_id 自己优先 + is_default 优先
4. 全部失败 → 环境变量 `OPENAI_API_KEY` / `OPENAI_COMPAT_API_KEY`(`_get_env_credential`)
```

**关键修复**(`credential_resolver.py:238-258`):内部服务调用(`user_id=None`)走单独 SQL 路径,不走「`c.user_id = $2` 永远 FALSE」的退化分支 — 否则后台索引器只能看到 system 凭证,看不到管理员保存的凭证,前台 SearchConfig UI 报"未配置凭证",后台又用了"虚空捏造的官方 OpenAI 地址"做索引。

---

## 4. temperature / max_tokens / api_base 折衷

### 4.1 temperature 锁(reasoning 模型家族)

`_TEMPERATURE_LOCKED_MODEL_PREFIXES = ("gpt-5", "o1", "o3", "o4-mini")`(`llm_router.py:127-145`)。

事故起因:`gpt-5-codex` 配 summary 任务,`ai_task_routing.config` 缺省的 0.7 让每次调用都炸 `UnsupportedParamsError: Only temperature=1 is supported.`。

修复策略:`_completion_kwargs` 命中前缀就**整个剔掉** `temperature` kwarg,不是写 1.0 — 因为 gpt-5.1 在 `reasoning_effort='none'` 下能接受任意 temperature,提前写死会废掉这条特例。

### 4.2 max_tokens 兜底

任务级默认值(`_TASK_DEFAULT_MAX_TOKENS`,`llm_router.py:50-58`):

```
summary=600 · tags=200 · titles=300 · polish=4000 · outline=2000 · translate=2000 · qa=2000
```

来源对齐 `migrations/000019_seed_ai_task_types.up.sql` 的种子默认值。覆盖了"DB 路由配置 + ai_task_types.default_max_tokens 都缺失"的回退路径。没有这一层兜底,LiteLLM 会把 `None` 直接转发给上游,模型一直生成直至填满上下文窗口 — 用户实际看到的"summary 返回千字问答"就是这个根因。

`override` 路径也继承这个兜底(`llm_router.py:341-346`)— 管理员从 ModelPicker 选了 Claude Opus 测 summary,也不会让它无上限烧 8K tokens。

### 4.3 api_base 的 SSRF 守卫(VULN-057)

每次 `acompletion / aembedding` 调用前都跑 `_guard_api_base`(`llm_router.py:677-694`):

```python
async def _guard_api_base(self, api_base: str | None) -> None:
    if not api_base:
        return  # 没配 = 用 LiteLLM 内置默认(公网),允许
    if not await validate_external_url_async(api_base):
        raise HTTPException(502, "Provider base_url resolves to an internal or private network")
```

`validate_external_url_async`(`app/utils/url_validator.py:154-183`):用 `loop.getaddrinfo` 异步解析,把所有 IP 喂给 `is_ip_blocked`(`url_validator.py:102-127`)。

**永远禁止**(`_HARD_BLOCKED_NETWORKS`):

- `0.0.0.0/8`(this-network)
- `100.64.0.0/10`(CGNAT)
- `169.254.0.0/16`(IMDS — AWS / GCP / Azure 元数据)
- `255.255.255.255/32`(broadcast)
- `fe80::/10`(IPv6 link-local)

**条件禁止**(默认禁,`AETHERBLOG_AI_ALLOW_INTERNAL_LLM=1` 放行):

- `10.0.0.0/8` / `127.0.0.0/8` / `172.16.0.0/12` / `192.168.0.0/16` / `::1/128` / `fd00::/8`

放行场景:自托管 Ollama / vLLM / 公司内网 LiteLLM proxy。**永远不能在生产开启** — 一旦 admin 账号被攻陷,这道闸就是阻止内网横移的最后一道墙。

`AETHERBLOG_SSRF_ALLOW_RESERVED=1` 是**第二个**逃生开关,给 Clash/Mihomo fake-ip 模式下本地开发用 — 接受 RFC2544 / class-E / 其它 reserved 段(它们会被标准库归为 `is_private`,误伤公网域名)。**生产同样必须关闭**。

VULN-058 加固:`is_ip_blocked` 在 IPv6-mapped IPv4(`::ffff:127.0.0.1`)情况下递归降级到底层 IPv4 重新检查,防止前缀绕过。

### 4.4 fallback 准备同样要过守卫

`_prepare_fallback_routing`(`llm_router.py:817-847`):resolve fallback routing 时 `await self._guard_api_base(fallback_routing.credential.base_url)` — fallback provider 的 api_base 也要 SSRF 校验。任何"primary 是公网 OpenAI、fallback 是内网某 endpoint" 的捷径都被堵死。

---

## 5. fallback 与 override 的互斥

`chat()`(`llm_router.py:773-815`):

```python
except Exception as primary_exc:
    routing = None
    if self.model_router and not resolved.override:  # override 不走 fallback
        routing = await self._get_routing(model_alias, user_id)
    if routing and routing.fallback_model:
        ...
```

设计意图:管理员从 admin UI 用 ModelPicker 选了 Claude Opus 测 summary 是「显式压测此模型」,失败必须看到失败,不能默默切到 ai_task_routing 配的 GPT-5。

`stream_chat`(`llm_router.py:870-997`)同样语义,但**只在「第一个 token 到达之前」**切;一旦已经 yield 过 chunk 就不能切了 — 中途换会让前端拼出半截破损 SSE。

---

## 6. embedding 与 RemoteModelFetcher

### 6.1 embed()(`llm_router.py:1014-1109`)

- 解析 routing(只看 `task_type='embedding'` 系统级行)
- mock 模式:`hashlib.sha256(text)` + 重复填充到 `vector_dim` — 让索引流水线在没有真实凭证时也能完整跑通,纯本地 dev 友好
- timeout:默认 180s(对齐 Go backend `search.index_post_timeout_sec`),`num_retries=0`(避免 LiteLLM 多次重试导致总耗时翻倍)
- env_fallback 必落 WARNING — 实际生产中"语义搜索结果不对劲"的首号嫌疑

### 6.2 resolve_embedding_model_id()(`llm_router.py:999-1012`)

被需要**持久化**或**记录**真实 embedding 模型名的调用方使用 — `vector_store.upsert_post_embedding` 写 `post_embeddings.model_id` 列、`reindex()` 判断"模型变更 → 弃用旧行"。这些位置过去硬编码 `settings.model_embedding`(env 默认),管理员改了 SearchConfig 后会与真实模型悄悄背离。

### 6.3 RemoteModelFetcher(`app/services/remote_model_fetcher.py`)

只支持两种 api_type:

- `openai_compat`:GET `<base>/v1/models`,Authorization Bearer + X-API-Key 双发(中转兼容性),解析 `data` / `models` / `model_list` / `items` / `result` 多种 wrapper
- `anthropic`:GET `<base>/models`,header `anthropic-version=2023-06-01`(可在 `extra_config.anthropic_version` 覆盖)

**所有抓回来的模型默认 `is_enabled=False`** — admin 必须人工选启用,避免一拉就把上百个 stable-diffusion-xxxx 全推进 ModelPicker。

`_infer_model_type` 用模型名子串猜:

```python
"embedding" → embedding
"tts" → tts
"stt" / "whisper" → stt
"realtime" → realtime
"image" / "dall-e" / "dalle" → image
其它 → chat
```

足够覆盖 OpenAI 命名约定;国内中转模型名不规范时仍归 `chat`,管理员手动改 model_type 即可。

---

## 7. think / reasoning 标签处理

`_THINK_OPEN_RE = r"<\s*(think|thinking|reasoning)\s*>"` / `_THINK_CLOSE_RE = "</...>"`(`llm_router.py:1120-1126`)。

`stream_chat_with_think_detection`(`llm_router.py:1127-1197`):

- 在 `stream_chat` 之上增量扫描 chunk,检测到 `<think>` 标签后标 `isThink=True` 转发,直到对应闭合标签
- 维护 `guard = len("</reasoning >") + 4` 个尾部字符,避免标签横跨 chunk 边界被误识别
- 最终冲刷阶段持续迭代解决"流末尾 buffer 里仍有完整标签"的边界(gemini-code-assist review #517)

前端 `useStreamResponse` 收到 `isThink=True` 的 delta 应该把它渲染到独立的"思考过程"折叠区,正文只显示 `isThink=False` 的部分。

**已知盲点**:不同 provider 用了 `<chain-of-thought>` / `<inner_monologue>` 等其它包裹符号 — 当前不识别,会被串到正文里。新 provider 上线时可扩 `_THINK_OPEN_RE` 的 alternation 集合。

---

## 8. provider_registry 的价格规整(`app/services/provider_registry.py:46-169`)

### 8.1 双轨存储:per-1k vs per-1m

ai_models 表保留两套列:`input_cost_per_1k / output_cost_per_1k`(legacy)和 `capabilities.pricing` JSONB(per-1m + units 数组)。

`_sync_model_pricing_capabilities`(`provider_registry.py:106-169`)在每次读写时双向同步:

- 读:从 `input_cost_per_1k` 推导 `_per_1m`(`*1000`),从 `capabilities.pricing.units[name=textInput, unit=millionTokens]` 推导兜底
- 写:把 `_per_1m` 反算回 `_per_1k`,同时刷 `capabilities.pricing.{input,output,cachedInput}` + `capabilities.pricing.units[]`

为什么不一刀切迁移到 per-1m:管理后台老 UI 字段显示的是 per-1k,迁移要同步前端。这里的兼容层让两边都能读到准确价格,直到下次 admin UI 重构。

### 8.2 cached_input_cost_per_1m

LiteLLM 会上报 cached input tokens(prompt cache hit),`usage_logger._estimate_cost` 用 cached 单价计算:

```python
effective_input_cost = cached_input_cost_per_1m if cached else input_cost_per_1m
```

但**当前 ai-service 没读 LiteLLM 返回的 `usage.cached_tokens` 字段** — `cached` 字段实际指"缓存命中(Redis)",不是 prompt cache。这是个语义 bleed,生产数据上 `cached_input_cost_per_1m` 列还没真实生效。后续接入需要在 `chat()` 拿 `response.usage.prompt_tokens_details.cached_tokens` 并落 `usage_logger.record(... cached=...)` 时区分两种 cached。

---

## 9. 端到端示例

一次 `POST /api/v1/ai/summary` 的完整链路(命中 routing,无 override,无 fallback):

```
1. ai_handler (Go) 解 JWT → 透传到 ai-service:8000
2. CORS / request_context 中间件
3. require_user → JWT decode (走 jwt_keys 缓存)
4. Depends(rate_limit) → Lua incr 用户级 + 全局两个 key
5. summary handler 进入:
   a. _enforce_content_limit(content)  # 默认 120000 字符
   b. _resolve_model_context(llm, "summary", ...) →
      LlmRouter.resolve_usage_context →
      _resolve_route → _resolve_override (None, 因 modelId 没传) →
      _get_routing("summary", user_id) →
      ModelRouter.resolve_routing 单条 SQL 拿到 RoutingConfig →
      _ResolvedRoute(model="openai/gpt-5-mini", api_key="...", api_base="https://api.example.com/v1", ...)
   c. cache_key 命中? 命中→直接返回 cache 数据
   d. prompt_variables = {"content", "max_length"}
   e. LlmRouter.chat() →
      _build_messages(prompt_template, vars)  # system + user 双消息
      _log_chat_request                        # 脱敏后落 INFO
      _guard_api_base                           # SSRF
      acompletion(model, messages, api_key, api_base, max_tokens=600)  # 不带 temperature(gpt-5 family)
6. 软上限截断:超 1.5x maxLength 截断 + WARNING
7. cache.set_json(SUMMARY_TTL=24h)
8. finally: usage_logger.record + metrics.record
```

整段串起来读 `apps/ai-service/app/api/routes/ai.py:613-753`。
