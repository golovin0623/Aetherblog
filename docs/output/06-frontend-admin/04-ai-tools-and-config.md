# 04 · AI 工具箱 / AI 测试 / AI 配置中心

> **范围**:`apps/admin/src/pages/AIToolsPage.tsx`、`pages/AiTestPage.tsx`、`pages/ai-config/*`、`components/ai/*`、`services/{aiService,aiProviderService,aiPredictionService}.ts`、`hooks/{useStreamResponse,useAiToolTarget}.ts`、`lib/{aiToolDiff,aiMetrics,ghost-text-extension}.ts`。

---

## 1. 范围

后台对 AI 能力的三种使用面:

| 面 | 路径 | 关注点 |
| --- | --- | --- |
| AI 工具箱 | `/ai-tools` | 文章级生成(摘要 / 标签 / 标题 / 大纲 / 润色 / 翻译 / 自定义)+ 应用到目标文章 |
| AI 测试 | `/ai-test` | 开发期手测,直接 textarea + 6 个按钮 |
| AI 配置中心 | `/ai-config` | LobeChat 风格的 provider / model / credential / task / routing 配置 |

`AetherHubWorkspacePage`(`/aetherhub`)是另一个独立 AI 工作台,放 07 文档介绍。AI 协同写作(`/posts/ai-writing/:id`)的编辑器内集成放 02 文档。

---

## 2. AI 工具箱(`AIToolsPage.tsx`,728 行)

### 2.1 入口与路由

- 路径:`/ai-tools`(普通)、`/ai-tools?tool=summary&postId=123`(深链)
- `App.tsx:21`,懒加载 `AIToolsPage`

### 2.2 工具源:系统 + 自定义

**系统工具(硬编码)**(`AIToolsPage.tsx:28-35`):

```ts
const SYSTEM_TOOLS = [
  { code: 'summary',   name: '生成摘要',   icon: BrainCircuit },
  { code: 'tags',      name: '智能标签',   icon: Wand2 },
  { code: 'titles',    name: '标题建议',   icon: FileEdit },
  { code: 'outline',   name: '生成大纲',   icon: ListTree },
  { code: 'polish',    name: '全文润色',   icon: PenLine },
  { code: 'translate', name: '全文翻译',   icon: Languages },
];
```

**自定义工具**:从 `aiProviderService.listTasks()` → `R<AiTaskType[]>` 拉取(对应后端 `/v1/admin/ai/tasks`)。会过滤掉:

- 跟系统工具同 `code` 的(去重)
- `model_type` 不在 `chat / reasoning / completion / code` 之内的(`embedding / tts / stt` 不适合"生成 → 应用到文章")

排序:**系统组 + 自定义组各自维护一份 localStorage 顺序**(`SYSTEM_ORDER_KEY = 'ai-tools-system-order'`、`CUSTOM_ORDER_KEY = 'ai-tools-custom-order'`)。`syncOrder` 算法:保留已存在的 ID,在尾部追加新出现的;移除被删除的(`AIToolsPage.tsx:61-66`)。DnD 用 `@dnd-kit/sortable` 实现拖拽排序,落地写回 localStorage。

### 2.3 URL 深链

`AIToolsPage.tsx:93-116` 在 mount 一次性消费:

```
?tool=<code>      → 预选工具
?postId=<id>      → 通过 useAiToolTarget.setTargetPostId(id) 切换目标文章
```

消费后用 `setSearchParams(next, { replace: true })` 把参数从 URL 删掉,防 refresh 重复触发。

### 2.4 状态拓扑

```
selectedToolId / customTools / promptConfigs  // 工具列表 + 各 task 的 prompt 配置
target = useAiToolTarget()                    // 目标文章相关 API + state
systemOrder / customOrder                     // localStorage 顺序
showToolModal / editingTool / isSaving        // CustomToolModal 状态
isMobileSidebarOpen                           // 移动端工具栏
canScrollLeft / canScrollRight                // 移动端工具 tab 横向滚动指示器
```

`AIToolsWorkspace` 是右侧主工作区,接收 `selectedTool / allConfigs / target` props。

### 2.5 数据流

```
mount
  ├─ Promise.all([
  │     aiProviderService.listPromptConfigs(),  // GET /v1/admin/ai/prompts
  │     aiProviderService.listTasks(),          // GET /v1/admin/ai/tasks
  │   ])
  └─ useAiToolTarget()
       ├─ effect → postService.getById(targetPostId) → setTargetPost
       └─ effect → postService.getList({ pageNum:1, pageSize:20 }) → setRecentPosts

用户选工具:
  ├─ 设置 selectedToolId
  └─ 工具栏切换可见

用户按"生成":
  ├─ AIToolsWorkspace 收集 input + selectedModelId / providerCode + 任务参数
  ├─ useStreamResponse.stream(`${AI_SERVICE_URL}/${tool}/stream`, body)
  │    其中 AI_SERVICE_URL = '/api/v1/ai',被 nginx/Vite 反代到 ai-service
  │    body 形状随 tool 不同(content / topic / targetLanguage / tone / maxTags / maxTitles / depth / promptTemplate / model / modelId / providerCode / bypassCache)
  ├─ 流式接收 SSE delta / result / done / error 事件
  ├─ result.data 是结构化终稿(各工具形状不同,见 useStreamResponse.ts:12-23)
  └─ 失败时 toast.error,UI 仍可重试 / 取消

用户"应用到文章":
  ├─ target.applySummary(text)  → postService.updateProperties({ summary })
  ├─ target.applyTitle(text)    → postService.updateProperties({ title })
  ├─ target.applyTags(items, mode='append'|'replace')
  │    ├─ 字符串项 → tagService.getList → 找 / 不存在则 tagService.create
  │    ├─ {tagId} 项 → 跳过 list,直接复用
  │    └─ postService.updateProperties({ tagIds: nextIds })
  ├─ target.applyContent(text, 'replace'|'append')
  │    └─ postService.update(id, rebuildFullUpdatePayload(targetPost, { content }))
  │       (必须重建完整负载,Go PostService.Update 会清未传字段)
  └─ target.copyToClipboard(text)  无目标文章时的 fallback
```

### 2.6 调用的 server-go / ai-service 接口

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/v1/admin/ai/prompts` | 各 task 的 prompt 配置(default + custom) |
| GET | `/v1/admin/ai/prompts/{taskType}` | 单 task |
| PUT | `/v1/admin/ai/prompts/{taskType}` | 更新 custom prompt |
| GET | `/v1/admin/ai/tasks` | 自定义任务列表 |
| POST `/v1/admin/ai/tasks` / PUT `/{code}` / DELETE `/{code}` | CRUD 自定义任务 |
| 流式 | `/api/v1/ai/{tool}/stream` POST | AI 生成接口(打到 ai-service,backend 透传) |

非流式接口(`AiTestPage` 用)走 `aiService.*`,详见 §3。

### 2.7 重要子组件

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| `AIToolsWorkspace` | `components/ai/AIToolsWorkspace.tsx` | 右侧主工作区:输入区 + 模型选择 + 流式输出 + 应用按钮 |
| `CustomToolModal` | `components/ai/CustomToolModal.tsx` | 创建 / 编辑自定义 task |
| `ModelSelector` | `components/ai/ModelSelector.tsx` | 选 provider + model;后台多处复用 |
| `CodexModelPicker` | `components/ai/CodexModelPicker.tsx` | Codex 风格模型选择(用于搜索配置 / 摘要生成) |
| `PromptEditor` | `components/ai/PromptEditor.tsx` | 编辑 task 的 default / custom prompt(支持模板变量提示) |
| `ToolParamsPanel` | `components/ai/ToolParamsPanel.tsx` | 参数面板(temperature / maxTokens / promptVersion / 各工具特化字段) |
| `ToolResultRenderer` | `components/ai/results/ToolResultRenderer.tsx`(目录) | 按工具类型渲染结构化结果 + 提供应用按钮 |
| `ThinkingBlock` | `components/ai/ThinkingBlock.tsx` | 渲染 `delta.isThink=true` 的"思考"区块,可折叠 |
| `ApplyPreviewModal` | `components/ai/ApplyPreviewModal.tsx` | 应用前的 diff 预览 |
| `BatchOptimizationPanel` | `components/ai/BatchOptimizationPanel.tsx` | 批量优化(暂未在 AIToolsPage 暴露入口) |
| `FloatingAiToolbar` | `components/ai/FloatingAiToolbar.tsx` | AI 协同写作页用 |
| `AnnotationCard` | `components/ai/AnnotationCard.tsx` | AI 协同写作的批注卡片 |

### 2.8 设计系统应用点

- 工具列表:左侧 sidebar `surface-leaf`;选中态 active 行用 `bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]`
- 流式输出区:`markdownPreviewStyles`(`@aetherblog/editor` 导出)→ Codex 字体 + 代码高亮
- ThinkingBlock:`--ink-muted` 文字、`--bg-leaf` 背景、左侧 `--aurora-2` 竖条
- 移动端工具 tab:横向胶囊滚动 + 左右指示箭头

### 2.9 已知限制 / 待改进

1. ⚠ **`AIToolsPage` 用 `confirm()` 删除自定义工具**(`AIToolsPage.tsx:226`)。**违反 §3.5 "禁止用浏览器原生 confirm/alert,用共享 Modal"**。该改成 `ConfirmModal`。
2. ⚠ **`useAiToolTarget` 的 `targetPostId` 持久化在 localStorage**(`hooks/useAiToolTarget.ts:67-92`),没考虑多用户共享同一浏览器的场景(切账号,目标还是上一个人的)。可以加 user-scoped key。
3. ⚠ **Stream URL 不走 axios baseURL**(`AIToolsWorkspace.tsx:42` `AI_SERVICE_URL = '/api/v1/ai'`,硬编码)。`VITE_API_URL` 自定义时不会被尊重。统一应该用 `import.meta.env.VITE_API_URL || '/api'` 拼。
4. ⚠ **`autosave` 关掉部分场景**:applySummary 之后 PostsPage 不会自动 invalidate,因为 PostsPage 没用 React Query。手动需要 `fetchPosts(...)`。

---

## 3. AI 测试页(`pages/AiTestPage.tsx`,446 行)

### 3.1 定位

开发期手测页面,**生产意义有限**。直接 textarea + 6 个按钮调用非流式 `aiService`。

```
inputs: content, topic
buttons: 生成摘要 / 智能标签 / 标题建议 / 内容润色 / 大纲 / 翻译
results: { summary, tags, titles, polished, outline }
```

### 3.2 调用接口(`services/aiService.ts`)

| Method | Path | 类型 |
| --- | --- | --- |
| POST | `/v1/admin/ai/summary` | `R<SummaryResponse>` |
| POST | `/v1/admin/ai/tags` | `R<TagsResponse>` |
| POST | `/v1/admin/ai/titles` | `R<TitlesResponse>` |
| POST | `/v1/admin/ai/polish` | `R<PolishResponse>` |
| POST | `/v1/admin/ai/outline` | `R<OutlineResponse>` |
| POST | `/v1/admin/ai/translate` | `R<TranslateResponse>` |
| GET | `/v1/admin/ai/health` | `R<string>` |

注意 `aiService` 内部对 legacy 字段做了兼容(`AiTestPage` 用的是新 API):

- `normalizeTitlesRequest`:`count` → `maxTitles`,移除 `style`
- `normalizePolishRequest`:`polishType / style` → 中文 `tone`("专业" / "轻松自然" / "技术严谨" / ...)

### 3.3 已知限制

- 没有保存到 store / localStorage,刷新后状态全丢
- 没有针对错误的细分(只有 toast.error message)
- 没有暴露 `bypassCache` / `model` / `providerCode` 等参数,做不了"对比测试"
- 实际生产应直接走 AIToolsPage,这页可以改成"接口探针"或者删除

---

## 4. AI 配置中心(`pages/ai-config/*`,模块化)

### 4.1 入口与路由

- 路径:`/ai-config`、深链 `/ai-config?provider=openai&model=gpt-5-mini`
- 入口:`pages/ai-config/AiConfigPage.tsx`(LobeChat 风格)
- 模块结构:

```
pages/ai-config/
  AiConfigPage.tsx        主页面 + 视图切换
  index.ts                统一导出
  types.ts                共享类型定义(123 行)
  components/             14 个子组件
  hooks/                  3 个 hooks(provider/model/credential)
  utils/                  错误消息 / 品牌色 / 模型能力推断
```

### 4.2 视图模式

```
ViewMode = 'grid' | 'detail'
- grid:    左侧 ProviderSidebar + 右侧 ProviderGrid(已启用 + 未启用)
- detail:  左侧 ProviderSidebar + 右侧 ProviderDetail(配置 / 模型 双 tab)
```

`AiConfigPage.tsx:69-84` 的 deep-link effect 在 providers 加载完成后**只跑一次**(`deepLinkAppliedRef`),避免每次 query refetch 都重置。

### 4.3 数据流

```
mount
  ├─ useProviders()           useQuery ['ai-providers', { enabledOnly:false }]
  │    └─ aiProviderService.listProviders → GET /v1/admin/providers
  ├─ groupProvidersByStatus(providers) → { enabled, disabled }
  └─ deep-link 处理(?provider=&model=) → setSelectedProviderCode + setActiveDetailTab='models'

切换到 detail 视图后:
  ├─ ProviderDetail 拉模型列表
  │   useProviderModels(code) → GET /v1/admin/providers/{code}/models
  ├─ ProviderDetail 拉凭证
  │   useCredentials() → GET /v1/admin/providers/credentials
  └─ ProviderDetail 拉 routing 配置
      aiProviderService.getRouting(taskType) → GET /v1/admin/providers/routing/{taskType}

mutations:
  ├─ useToggleProvider                     PUT /v1/admin/providers/{id}
  ├─ useBatchToggleProviders               PUT /v1/admin/providers/batch-toggle
  ├─ useCreateProvider / useUpdateProvider POST/PUT /v1/admin/providers
  ├─ useDeleteProvider                     DELETE /v1/admin/providers/{id}
  ├─ useUpdateProviderPriorities           遍历 PUT(单个 update)
  ├─ useCreateModel/Update/Delete/Toggle   POST/PUT/DELETE /v1/admin/providers/.../models
  ├─ useSyncRemoteModels                   POST /v1/admin/providers/{code}/models/remote
  ├─ useClearProviderModels                DELETE /v1/admin/providers/{code}/models
  ├─ useBatchToggleModels                  PUT /v1/admin/providers/{code}/models/batch-toggle
  ├─ useUpdateModelSort                    PUT /v1/admin/providers/{code}/models/sort
  └─ useCredentials hook                   listCredentials/createCredential/deleteCredential/reveal/test/test-embedding
```

### 4.4 调用的 server-go 接口(全集)

参考 `services/aiProviderService.ts`(263 行)。按资源分组:

#### Providers
- GET / POST `/v1/admin/providers`
- PUT / DELETE `/v1/admin/providers/{id}`
- PUT `/v1/admin/providers/batch-toggle`

#### Models
- GET `/v1/admin/providers/{code}/models`(指定 provider)
- GET `/v1/admin/providers/models?model_type=&enabled_only=`(全部)
- POST `/v1/admin/providers/{code}/models`
- PUT `/v1/admin/providers/models/{id}`
- DELETE `/v1/admin/providers/models/{id}`
- POST `/v1/admin/providers/{code}/models/remote`(从 provider API 拉模型清单)
- DELETE `/v1/admin/providers/{code}/models?source=`(批量清空)
- PUT `/v1/admin/providers/{code}/models/batch-toggle`
- PUT `/v1/admin/providers/{code}/models/sort`

#### Credentials
- GET / POST `/v1/admin/providers/credentials`
- DELETE `/v1/admin/providers/credentials/{id}`
- GET `/v1/admin/providers/credentials/{id}/reveal`(明文 API key,二次确认)
- POST `/v1/admin/providers/credentials/{id}/test`(用 chat 模型测连通)
- POST `/v1/admin/providers/credentials/{id}/test-embedding`(用 embedding 模型测连通)

#### Tasks(系统 + 自定义)
- GET / POST `/v1/admin/ai/tasks`
- PUT / DELETE `/v1/admin/ai/tasks/{code}`

#### Prompts
- GET `/v1/admin/ai/prompts` / `{taskType}`
- PUT `/v1/admin/ai/prompts/{taskType}`

#### Routing(任务 → 模型路由)
- GET / PUT `/v1/admin/providers/routing/{taskType}`

### 4.5 关键子组件

| 组件 | 用途 |
| --- | --- |
| `ProviderSidebar` | 左侧 provider 列表(按已启用 / 未启用分组,启用项排前) |
| `ProviderCard` | grid 视图卡片;品牌图标(`@lobehub/icons`)+ 启用 toggle |
| `ProviderGrid` | 卡片网格容器(`已启用服务商` / `未启用服务商`) |
| `EmptyProviderState` | 0 个 provider 时的引导 CTA |
| `ProviderDetail` | detail 视图主区:tab `config` / `models` |
| `ProviderDialog` | 创建 / 编辑 provider 表单(含 capabilities / config_schema 编辑) |
| `ProviderIcon` / `ProviderIconPickerDialog` | LobeChat 图标库选择 |
| `ModelCard` / `ModelList` / `ModelConfigDialog` / `ModelSortDialog` | 模型 CRUD |
| `CredentialForm` | 创建凭证(api_key / base_url_override / extra_config) |
| `ConnectionTest` | 跑 test / test-embedding 连通性 |
| `SortDialog` | provider 全局排序(批量 priority 更新) |

### 4.6 错误消息归一(`utils/errorMessage.ts`)

`resolveAiServiceErrorMessage(error, fallback)` 处理两种响应形状:
- backend 标准 `R<T>`(`error.response?.data?.message`)
- ai-service `AiServiceResponse<T>`(`success: false, errorMessage / errorCode`)

返回最具体的消息,兜底用 `fallback`。

### 4.7 设计系统应用点

- detail 视图根容器:`rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]`(legacy 主色背景 + Codex border)
- 添加按钮:`bg-black dark:bg-white text-white dark:text-black`(**违反 §3.4 #5**:不应该写 `dark:` variant,token 翻转就够了)
- 状态徽章:大量 `text-status-danger / bg-status-danger-light` 等 legacy
- LobeChat 图标:`@lobehub/icons` 提供品牌图形,色彩自带,与 Codex tokens 不能完全协调

### 4.8 已知限制 / 待改进

1. ⚠ **`bg-black dark:bg-white` 反例**:违反 §3.4 #5。
2. ⚠ **`useUpdateProviderPriorities` 是 Promise.all 单条 PUT**(`useProviders.ts:113-119`),理论应该有专门的 `/sort` 端点(模型已有 `/{code}/models/sort`,provider 缺)。
3. ⚠ **`ConnectionTest` 用 `confirm()` 之类的浏览器原生** ⇒ 待具体走查;但 `ProviderDetail` 切换 tab 已经写了"保留用户当前 tab" 的 caveat,说明状态边界比较细致。
4. ⚠ **凭证 reveal 的二次确认** 对应 VULN-098(明文密钥泄露窗口),前端如果只是 `confirm()` 再 fetch 显示,需要后端有强 audit log 才能算 acceptable。

---

## 5. AI 在编辑器内的集成(交叉引用)

`pages/posts/CreatePostPage.tsx` 与 `AiWritingWorkspacePage.tsx` 的 AI 集成详见 02 文档,这里只列接入点:

- `SelectionAiToolbar`:选中文本浮起(`enableSelectionAi` 开关)
- `SlashCommandMenu`:`/` 命令菜单(`enableSlashAi` 开关)
- `AiSidePanel`:右侧助手面板,handle ref 暴露给外部
- `useAiPrediction`(`hooks/useAiPrediction.ts`)+ `lib/ghost-text-extension.ts`:CodeMirror 6 ghost text 装饰
- `aiPredictionService`:**当前是 mock**(模板回复),后端没有对应端点

⚠ AiWritingWorkspacePage 的 AI capability 列表(`AI_CAPABILITIES`,`AiWritingWorkspacePage.tsx:62-84`)只剩 `polish / summarize`,因为 `expand` 之前是前端 mock,被显式删除。

---

## 6. AI 流式协议

### 6.1 通用流式事件(`hooks/useStreamResponse.ts:6-13`)

```ts
event: 'delta' | 'done' | 'error' | 'result';
delta:  { content: string, isThink?: boolean }
result: { data: <tool-specific> }
error:  { code, message }
done:   {}
```

各工具的 `result.data` 形状(同文件 12-23 行):
```
summary:    { summary, characterCount, model? }
tags:       { tags: string[], model? }
titles:     { titles: string[], model? }
polish:     { polishedContent, model? }
outline:    { outline, characterCount, model? }
translate:  { translatedContent, targetLanguage, sourceLanguage?, model? }
```

### 6.2 SSE 解析

`useStreamResponse.stream` 内部:
1. fetch + ReadableStream
2. TextDecoder 增量解码 → `\n\n` 分隔帧
3. 每帧 `data: <json>` 解析事件
4. **节流 50ms** 一次 setState,防止千 token 输出导致几百次 React 渲染
5. `delta` 累积到 `contentBuffer / thinkBuffer`
6. `result` 提前 flush 流式内容,把 `data` 写入 `result` state
7. `done` 触发最后一次 flush 和 `setIsDone(true)`
8. `error` 写 `error` state

### 6.3 鉴权

`useStreamResponse.ts:96-127` 决定是否带 Bearer:
- 同源(URL.origin === window.location.origin)→ 带 Bearer + cookie
- 跨域 → 不带 Bearer / cookie(VULN-085 缓解)
- 401/403 → 调一次 `/v1/auth/refresh` cookie 续期 → 重建 RequestInit(重读 store.token)再发一次

### 6.4 reindex 流(`useReindexStream.ts`)

事件类型不一致(start / progress / result / done / error,详见 06 文档)。**没有抽公共 SSE 解析层**,两份独立实现。

---

## 7. AI 调用记录与计费

`DashboardPage` / `AnalyticsPage` 显示 AI 调用统计(详见 05 文档):
- 总调用 / 成功率 / Tokens / 费用 / 平均延迟 / 缓存命中率 / 响应成功率
- 模型分布 / 任务分布
- AiUsageRecordsTable 分页明细
- AiPricingGap 缺失计费(`/v1/admin/stats/ai-pricing-gaps`)
- AiCostArchive 触发归档(`/v1/admin/stats/ai-cost-archive`)

`lib/aiMetrics.ts`:`getAiResponseRateSummary(total, success, error)` 派生显示值(成功率 + 数量行 + 比例行)。

### 7.1 Global Pricing 页面

`/ai-config/pricing` 已从 AI Config 中拆成独立配置面,由 `GlobalPricingPage` + `pages/global-pricing/hooks.ts` + `aiProviderService` 方法组支撑:

- `all / configured / missing / out-of-sync` 四类过滤,用于检查哪些 `ai_models` 没有全局价格或与全局基准不同步。
- `coverage` 指标显示全局价格覆盖率。
- `upsert/delete` 维护 `ai_global_pricing` 的 per-1M input/output/cache 价格与扩展 `pricing JSONB`。
- `applyGlobalPricingToModels` 批量把全局价格写回所有同名 `ai_models`。
- `syncModelPricingToGlobal` / `syncModelPricingFromGlobal` 在单个模型行与全局基准之间双向同步。

边界:Global Pricing 只是价格基准。Go 侧统计仍从 `ai_models.capabilities.pricing` 或 legacy per-1K 字段计算;只有 apply/sync 写回模型行后,后续用量成本才会变化,历史归档不会自动重算。

---

## 8. 已知问题汇总

1. ⚠ 浏览器原生 `confirm()`(`AIToolsPage.tsx:226`),违反共享 Modal 红线
2. ⚠ `aiPredictionService` 是 mock,后端无端点
3. ⚠ `bg-black dark:bg-white` Codex 违反
4. ⚠ AI 配置中心的 provider priority 应该有专用 sort 端点
5. ⚠ Stream URL 硬编码 `/api/v1/ai`,不尊重 `VITE_API_URL`
6. ⚠ Provider 凭证 reveal 应有 audit log + 失效时间(VULN-098)
7. ⚠ `useStreamResponse` 与 `useReindexStream` 协议相近但无公共层
