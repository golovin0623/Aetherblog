# 模型中心对齐升级报告

> 日期：2026-06-09 · 范围：`apps/admin/src/pages/ai-config`（模型中心前端）+ `apps/ai-service`（AI 后端）
> 目标：对标业界主流「模型/供应商配置中心」的能力与体验，补齐缺漏并自研融入，**不在代码中明面引入第三方对标项目的代码或标识**。

---

## 0. 执行摘要

本次以「先测绘、再对齐、后吸纳」的方式完成模型中心的一轮升级：

- **能力对齐**：统一了三层（前端 / Python / Go）长期不一致的能力词表，远程拉取的模型现在自动携带规范能力标志；新增 Google(Gemini) 供应商的远程模型抓取。
- **体验对齐**：模型配置弹窗的「扩展参数」从一排裸 `camelCase` 按钮升级为**分组 + 中文标签 + 说明 + 能力推荐**的可读控件，新增**采样参数屏蔽（disabledParams）**；模型列表新增**骨架屏**（修正「禁止 spinner」铁律违规）与**能力分面筛选**；模型卡片新增**NEW 徽章**；按钮/弹窗动效全部改用设计系统预设。
- **合规处理**：清除了源码中所有明面的对标项目文字标识与抄录的推广引流参数，把第三方品牌图标依赖收敛到唯一中性适配层。
- **质量保障**：后端 **354 测试全过**（修复了 4 个环境相关的历史失败用例）；前端**新建首套单元测试 22 个全过**；类型检查 / Lint / 生产构建 / 设计系统门槛（0 error）全绿。

---

## 第一步 · 对齐缺漏（差距清单）

对标主流模型中心的能力维度，逐项核对本项目现状：

| 维度 | 升级前现状 | 差距 | 处理 |
| --- | --- | --- | --- |
| 能力标志 `abilities`（8 项） | 前端已全（vision/reasoning/search/imageOutput/video/functionCall/files/structuredOutput） | **后端词表不一致**：远程抓取写 `tools`/`file_upload`/`web_search`，前端读 `functionCall`/`files`/`search` → 远程模型能力徽章全丢 | ✅ 新增规范化器统一词表，远程模型自动补能力 |
| 模型参数控制 `extendParams` | 仅一排裸 `camelCase` 按钮，不可读、无分组 | 缺可读标签/分组/能力推荐 | ✅ 自研分组控件目录 |
| 屏蔽采样参数 `disabledParams` | **无** | 推理模型需省略 temperature/top_p 等 | ✅ 新增类型 + UI |
| 远程模型抓取 | 仅 `openai_compat` / `anthropic`，且不推断能力/类型 | 缺 Google；能力/类型推断弱 | ✅ 新增 Google；接入启发式推断 |
| 加载态 | 文本「加载中…」（违反「禁止 spinner，须骨架屏」铁律 3.6） | 缺骨架屏 | ✅ 骨架屏 + pulse |
| 能力分面筛选 | 仅按模型类型 tab | 缺按能力筛选 | ✅ 能力 chips（与筛选） |
| 新模型标识 | 仅展示发布日期 | 缺「NEW」视觉提示 | ✅ 45 天内 NEW 徽章 |
| 定价颗粒度（类型） | input/output/cachedInput/audio* | 缺 cacheWrite / 图像·视频分项 | ✅ 扩展 `ModelPricing` 类型 |
| 动效规范 | 组件内散写裸 spring 数值（违反铁律 3.4） | 未用设计系统预设 | ✅ 迁移到 `spring/transition/variants` |
| 明面第三方标识 | 注释「LobeChat 风格/参考」、`lobeIcons.ts`、抄录的 `utm_source=…` 引流参数 | 合规风险 | ✅ 全部中性化/剥离 |

---

## 第二步 · 现有架构分析

模型中心是**三层协作**系统：

```
┌─────────────────────────┐   HTTP    ┌──────────────────────────┐   asyncpg   ┌──────────────┐
│ admin 前端 (Vite+React)  │ ───────▶ │ server-go (Echo)         │ ──────────▶ │ PostgreSQL    │
│ pages/ai-config         │  /v1/admin │ ai_handler「纯透传代理」  │             │ ai_providers  │
│ · 14 组件 / 3 hooks      │  /providers│ 不含任何模型业务逻辑       │             │ ai_models     │
│ · types.ts 数据契约      │           └──────────────────────────┘             │ ai_credentials│
└─────────────────────────┘                                                    │ ai_task_*     │
              │ 推理调用 /api/v1/ai/*                                            │ ai_global_…   │
              ▼                                                                 └──────────────┘
     ┌──────────────────────────────────────────┐   共享同一 PostgreSQL ▲
     │ ai-service (FastAPI + LiteLLM)            │ ─────────────────────┘
     │ provider_registry / credential_resolver  │
     │ model_router / llm_router                │  ← 真正拥有 Provider/Model/Credential 的 CRUD 与路由
     │ remote_model_fetcher / pricing_catalog   │
     └──────────────────────────────────────────┘
```

**关键设计结论：**

1. **Go 仅做透传代理**，所有 Provider/Model/Credential/Routing 的 CRUD 与推理路由都在 Python `ai-service`；三者共享同一 PostgreSQL。→ 能力对齐的改动应落在 **Python 后端 + 前端**，Go 无需改。
2. **能力/设置/定价存于 `capabilities` JSONB 列**（`ai_models.capabilities`）。→ 新增能力字段（如 `disabledParams`）**无需数据库迁移**，天然规避了「迁移不可变」红线。
3. **运行期路由**：`model_router` 按 task_type 从 DB 解析 (model, credential, config)，`llm_router` 渲染提示词、按模型特性调参（推理模型锁温度等）后经 LiteLLM 调用，并落 `ai_usage_logs`。
4. **能力字段在三层各写各的**，是本次最实在的「隐性缺陷」——远程抓取与前端读取的键名不一致，导致远程模型能力丢失。

---

## 第三步 · 吸纳优化与实现

### 3.1 后端：能力词表统一（新增 `model_capabilities.py`）

自研的**纯函数、零网络**能力基准模块，作为三层能力对齐的事实来源：

- `normalize_abilities(*sources)`：把 dict / list / 逗号分隔串、以及 `tools`/`function_call`/`file_upload`/`web_search`/`image_generation` 等别名，统一收敛为 8 个规范 `camelCase` 标志，输出按规范顺序稳定排序。
- `infer_model_type(id)`：按命名启发式判型（embedding/tts/stt/realtime/image/text2video/text2music/chat）。
- `infer_capabilities(id, type)`：按公开命名约定（保守判定）推断能力——现代对话模型默认具备工具调用/结构化输出，再叠加视觉/推理/搜索/出图。
- 覆盖率 **100%**（23 个单测）。

### 3.2 后端：远程抓取增强（`remote_model_fetcher.py`）

- 接入上述推断：远程拉取的模型**开箱即带规范能力标志与正确类型**（如 `gpt-4o`→视觉+工具，`o3-mini`→推理），管理员仍可在弹窗人工覆盖。
- **新增 Google(Gemini) 抓取**：`GET {base}/models`，密钥走 `x-goog-api-key` 请求头（不入 URL），解析 `inputTokenLimit`/`outputTokenLimit` 直接回填上下文窗口与最大输出，去除 `models/` 前缀。
- 顺手修复 `datetime.utcfromtimestamp` 弃用告警。
- 修复 4 个**历史失败用例**：根因是测试用 `api.example.com` 在受限环境 DNS 解析到保留网段、被 SSRF 防护拦截；以 autouse fixture 放行外链校验，使其只验证「响应解析」而不依赖真实 DNS（**不削弱生产 SSRF 防护**）。

### 3.3 前端：模型参数控件（新增 `utils/modelParams.ts`）

自研中性化的参数控件目录：

- `PARAM_GROUPS` × `PARAM_CONTROLS`：把扩展参数分为「推理控制 / 思考预算 / 上下文与检索 / 多模态与输出」四组，每项带**中文标签 + 一句说明**。
- `groupParamControls(selected, abilities)`：分组聚合 + 依据已选能力标注「推荐」；**目录外的自定义已选项归入 custom 分组，保证编辑回写不丢失**。
- `SAMPLING_PARAMS`：4 个标准采样参数的可读元数据，用于 `disabledParams`。
- 12 个单测。

### 3.4 前端：模型配置弹窗（`ModelConfigDialog.tsx`）

- 「扩展参数」整段重写为**分组可读控件**（带说明、推荐徽章、按压动效）。
- 新增「**屏蔽采样参数**」区：勾选 temperature/top_p/frequency_penalty/presence_penalty 即在调用时省略（推理模型常用），写入 `settings.disabledParams`。
- 弹窗出入场、按钮交互从裸数值迁移到设计系统 `variants.scaleIn`/`spring.soft`/`transition.quick`/`spring.precise`。

### 3.5 前端：模型列表与卡片

- `ModelList`：用**骨架屏 + pulse** 替换「加载中…」文本（修正铁律 3.6）；新增**能力分面筛选 chips**（工具/视觉/推理/搜索，多选取交集）与「清除」；空态区分「暂无模型 / 无匹配」。
- `ModelCard`：新增**NEW 徽章**（发布 45 天内，弹簧入场动效）。
- `ModelList` 的远程抓取开关同步放开 `google`，与后端 Google 支持端到端一致。

### 3.6 合规：去明面化第三方标识

- 剥离 `types.ts` 预设 URL 中抄录的引流追踪参数：`utm_source=lobehub`、`utm_source=github_lobechat`、`invited_by=RQIMOC`（既是明面抄录标识，也会把引荐流量导向对方）。
- 清除源码中全部「LobeChat 风格 / 参考 LobeChat / 仿 LobeHub / 对齐 LobeHub」等注释（8 处文件）。
- `lobeIcons.ts` → 重命名为中性的 `brandIcons.ts`，并把第三方品牌图标依赖**收敛进唯一适配层**、别名化其导出；上层组件只见中性 API（`resolveBrandIconId` 等），后续可一处替换资产源。
- 说明：品牌图标资产（各厂商 Logo）为纯静态资源，隔离于单一适配文件而非散落明面；其余 50 余处图标具名导入位于 `ProviderIcon.tsx`，已加中性注释。

---

## 测试结果

| 项目 | 结果 |
| --- | --- |
| 后端 `pytest`（全量） | **354 passed, 0 failed**（修复 4 个历史失败用例） |
| └ `model_capabilities.py` 覆盖率 | **100%**（23 用例） |
| └ `remote_model_fetcher.py` 覆盖率 | **87%** |
| 前端 `vitest`（新建首套） | **22 passed**（modelParams 12 + modelCapabilities 10） |
| 前端 `tsc --noEmit` | ✅ 通过 |
| 前端 `eslint`（改动文件） | ✅ 0 问题 |
| 前端 `vite build` 生产构建 | ✅ 成功（含测试文件不影响产物） |
| 设计系统 `codemod-tokens check` | ✅ **0 error**（红线保持） |

> 注：项目级 `--cov-fail-under=80` 是**全仓 8024 语句的历史指标（约 69%，预先存在、与本次无关）**，并非按 `pytest` 默认命令把关；本次新增模块覆盖率（100% / 87%）显著高于均值，对总覆盖只增不减。

---

## 代码评审结论（自审要点）

- **去重 / 防死代码**：发现并删除了与 `provider_registry._merge_pricing_units` 重复且未接线的 `normalize_pricing_units`（连同其专用测试），避免「重复实现 + 死代码」评审问题。
- **诚实接口**：撤回了存疑的 `azure→openai /models` 抓取路径（Azure 需 `api-version` 与 `/openai/models`，泛化 `/models` 大概率失败），仅保留确定可用的 Google。
- **无断引用**：删除私有 `_infer_model_type` 后核对全仓无外部引用。
- **规范遵循**：动效统一走 `@aetherblog/ui` 预设；新增代码与同模块既有 token 风格一致；未引入新的设计系统 error / glass / blur 违规。
- **安全不回退**：SSRF 校验仅在测试层打桩，生产路径不变；Google 密钥走请求头不入 URL。

---

## 合规性说明（不明面引入对标项目）

1. **代码层面零抄录**：能力规范化器、参数控件目录、UI 控件均为自研实现，命名/结构与本项目既有约定一致。
2. **文字标识清零**：源码中已无「LobeChat/LobeHub 风格/参考/对齐」等明面表述。
3. **引流参数剥离**：预设供应商 URL 中抄录的第三方推广/引荐追踪参数全部移除。
4. **依赖隔离**：第三方品牌**图标资产**（开源、纯静态）被收敛到唯一中性适配层 `brandIcons.ts`，可一处替换；非应用逻辑代码。

---

## 后续建议（未尽事项）

- **凭证多字段表单**：AWS（accessKey/secret/region）、Azure（apiVersion/deploymentName）、Cloudflare（accountId）等结构化凭证目前经 `extra_config` JSON 承载，可后续做成类型化 UI。
- ~~**定价同步入抓取**~~（已实现）：聚合站 `pricing.{prompt,completion}`（USD/Token）已在抓取阶段解析并换算为每百万 Token，连同 `context_length` 一并回填。
- **能力推断词典外置**：`infer_capabilities` 的命名正则可逐步沉淀为可配置词典，降低新模型上架的维护成本。
- **设计系统 token 迁移**：`ai-config` 模块整体仍用 legacy token（`--text-*`/`--bg-primary`，info 级、sunset 2026-07-17），属独立的迁移工作项，宜单独成 PR 推进。
- **文档同步**：按 `CLAUDE.md §6.1`，新增供应商抓取与能力推断建议补记 `docs/AI_MODULE_PLAN_V2.md` 与 `CHANGELOG.md`。

---

## 提交后 · PR #768 评审与硬化

PR 提交后经两个自动评审机器人（Gemini Code Assist + ChatGPT Codex）三轮复审，**8 项反馈全部采纳**：

### Gemini Code Assist（5 条）
- **Google 抓取空值守卫**：`(credential.api_key or "").strip()`，防 `None` 触发 `AttributeError`。
- **`video` 能力补全**：`infer_capabilities` 对 `video` 类型也赋 `video` 能力（与 `text2video` 对齐）。
- **`disabledParams` 可选性守卫 ×3**：`ModelConfigDialog` 三处访问加 `?.` / `|| []`，防 `undefined` 运行时崩溃。

### Codex（3 个 P2）
- **Gemini 端点版本**：内置 Google 预设 baseUrl 无版本段，抓取会打到 `/models` 而非 list-models 端点 `/v1beta/models`。新增 `_ensure_gemini_version()` 自动补 `/v1beta`（已带版本则保留）。
- **`disabledParams` 服务端强制**（最实质）：此前 `disabledParams` 仅持久化在模型 capabilities 并回传前端，**请求路径未读取**，导致「调用时省略 temperature」对可配置模型失效（仅靠硬编码 GPT/o 前缀）。新增 `resolve_disabled_sampling_params()`，在 `_completion_kwargs` / `_agent_completion_kwargs` 及 AI 任务 chat/stream 主+fallback 路径按模型配置真正剔除被屏蔽的采样参数。
- **`text2music` / `realtime` 路由 denylist**：推断会把 suno/lyria/musicgen 判为 `text2music`、realtime 模型判为 `realtime`，但 `llm_router.NON_CHAT_MODEL_TYPES` 缺这两类，会被当成可选对话模型误送 `acompletion`。补齐使其与 `model_capabilities.NON_CHAT_TYPES` 一致，并加**一致性测试**守护未来漂移。

### CI 根因诊断与修复
新提交一度「静默不触发 CI」。逐层排查（非账户配额、非工作流禁用）定位真根因：**PR base 落后 `main` 15 个提交、`CHANGELOG.md` 与 main 冲突 → GitHub 无法计算 `refs/pull/768/merge` → `pull_request` CI 不触发，且 `mergeable: CONFLICTING`**。合并 `origin/main`（代码零冲突，仅 CHANGELOG 保留双方条目）后恢复可合并并重新触发 CI。

### 最终状态（已核验）
- PR #768：`mergeable: MERGEABLE` · `mergeState: CLEAN` · head `2ca57ce7`。
- CI：`success`（`ai-test` / `frontend-quality` / `gitleaks` / `config-validate` / `detect-changes` / `forbidden-defaults-guard` 全过）。
- 测试：后端 pytest **366** 全过（新增 disabledParams 强制 8 例 + 非对话类型一致性 1 例）；前端 vitest 22 全过；typecheck / eslint / build / `design-system:check`(0 error) 全绿。

### 工程纪律记录
全程在隔离 git worktree 操作，规避了「多并发会话共享同一检出、分支被随时切换」的危险（期间共享检出被其它会话多次切走）；一次误提交到他人分支后，用隔离 worktree cherry-pick 回正 + `--force-with-lease` 还原他人分支，**全程未扰动他人未提交 WIP**。
