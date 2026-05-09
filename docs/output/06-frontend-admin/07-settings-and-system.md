# 07 · 系统设置 / VanBlog 迁移 / 友链 / AetherHub

> **范围**:`pages/SettingsPage.tsx`、`pages/MigrationPage.tsx`、`pages/migration/*`、`pages/FriendsPage.tsx`、`pages/friends/*`、`pages/aetherhub/AetherHubWorkspacePage.tsx`、`services/{settingsService,friendService,migrationService}.ts`、`services/agent/*`、`components/settings/*`。

---

## 1. 范围

四个相对独立的"系统级"页面:

| 路径 | 入口 | 关注点 |
| --- | --- | --- |
| `/settings` | `pages/SettingsPage.tsx` | 全站点设置(8 类 + storage / migration 两个内嵌特殊 tab) |
| `/settings` 内 `migration` tab | `pages/MigrationPage.tsx` + `pages/migration/*` | VanBlog 数据迁移 5 步向导 |
| `/friends` | `pages/FriendsPage.tsx` | 友链管理 + 拖拽排序 |
| `/aetherhub` | `pages/aetherhub/AetherHubWorkspacePage.tsx` | AI 对话工作台(独立壳,无 AdminLayout) |

---

## 2. 系统设置(`SettingsPage.tsx`,582 行)

### 2.1 入口

- 路径:`/settings`
- 入口:`pages/SettingsPage.tsx`
- 状态:`useState<string>('general')` 当前 tab + `formData` 收集所有字段(全 key/value)

### 2.2 设置分组

`SettingsPage.tsx:30-122` 的 `SETTING_GROUPS` 是配置元数据,8 类 + 2 特殊:

| 组 | Icon | 字段 | 类型 |
| --- | --- | --- | --- |
| `general` | Globe | site_name / site_logo / site_description / site_url / site_keywords / footer_text / footer_signature / icp_number | text/textarea/url/image-upload |
| `author` | User | author_name / author_bio / author_avatar / author_email / social_links | text/textarea/url/social-links |
| `welcome` | Sparkles | welcome_enabled / welcome_title / welcome_subtitle / welcome_description / 主副按钮 文案 + 链接 | text/boolean |
| `appearance` | Palette | theme_primary_color_light / theme_primary_color_dark / enable_dark_mode / font_family / show_banner / post_page_size / custom_css | color/boolean/font-picker/number/textarea |
| `seo` | Search | seo_robots / enable_sitemap / baidu_analytics_id / google_analytics_id | textarea/boolean/text |
| `comment` | MessageSquare | comment_enabled / comment_audit | boolean |
| `advanced` | Database | enable_registrations / upload_max_size / storage_type / ai_enabled / ai_provider | boolean/number/text |
| `migration` | DatabaseZap | (无标准字段,整 tab 嵌入 MigrationPage) | special |
| `storage` | Cloud | (无标准字段,整 tab 嵌入 StorageProviderSettings) | special |

### 2.3 字段类型与渲染

`SettingFieldType` enum(`SettingsPage.tsx:20`):

```ts
'text' | 'textarea' | 'number' | 'boolean' | 'color'
| 'url' | 'social-links' | 'image-upload' | 'font-picker'
```

每种类型对应一段 JSX 渲染(`SettingsPage.tsx:469-555`):
- text/url/number → `<input>`
- textarea → 4 行 textarea
- boolean → `Toggle`(@aetherblog/ui)+ "已开启 / 已关闭" 提示
- color → `<input type=color>` + 显示 hex 的 `<input type=text>`
- social-links → 自定义组件 `SocialLinksEditor`
- image-upload → 内嵌 `ImageUploadField`(`SettingsPage.tsx:124-242`),含上传进度
- font-picker → 自定义 `FontPickerModal`(预览 → 应用,见 `FontPreviewContext`)

### 2.4 状态拓扑

```
activeTab: 当前 tab key
formData: 所有 key/value 的扁平 map(从 settingsService.getAll 加载)
hasChanges: formData 与 originalData 是否不一致(浅 compare)
saving / savingError: 保存状态
saveMutation: react-query mutation 触发 settingsService.batchUpdate

mount:
  useQuery(['settings']) → settingsService.getAll → SettingsMap
   → setFormData + setOriginalData

handleInputChange(key, value):
  setFormData((prev) => ({ ...prev, [key]: value }))

handleSave:
  saveMutation.mutate(formData) → settingsService.batchUpdate
   → 成功: setOriginalData(formData) + toast.success
   → 失败: toast.error

handleReset:
  setFormData(originalData)
```

### 2.5 调用接口

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/v1/admin/settings` | 全部设置 K/V |
| GET | `/v1/admin/settings/group/{group}` | 按组拉(目前未用) |
| PATCH | `/v1/admin/settings/batch` | 批量更新 |
| GET | `/v1/admin/settings/{key}` | 单字段(未用) |
| PUT | `/v1/admin/settings/{key}` | 单字段更新(注释中提示用 batch 更稳妥) |
| POST | `/v1/admin/media/upload` | image-upload 字段触发 |

### 2.6 字体系统接入

- 字段 `font_family` 对应 `font-picker` 类型
- 渲染:展示当前字体卡片 + "选择字体" 按钮 → 弹 `FontPickerModal`
- modal 选中:**先预览**(通过 `FontPreviewContext.startPreview(id)` 实时改 body fontFamily),用户点"应用"才真正保存
- 应用走 `AdminFontProvider.handleSaveFontId` → `settingsService.batchUpdate({ font_family })` + `queryClient.invalidateQueries(['settings'])`
- 失败时 `applyPreview` 自动回滚到旧字体(见 `FontPreviewContext.tsx:74-82`)

### 2.7 主色调系统

- 字段 `theme_primary_color_light` / `theme_primary_color_dark` / `theme_primary_color`(legacy)
- 都是 hex 字符串,通过 `<input type=color>` 输入
- 保存后 `AdminThemeColorProvider`(`components/AdminThemeColorProvider.tsx`)读取 → `generateColorVars(color, isDark)` 派生完整 token 集 → `colorVarsToCSS(vars)` 拼成 CSS → 注入 `<style id="aetherblog-admin-primary-color">`
- 派生函数在 `@aetherblog/utils`,根据 OKLCH 算法从 primary 推 hover/border/glass/aurora-1..4 等

### 2.8 storage / migration 两个特殊 tab

```tsx
{activeTab === 'migration' ? <Suspense><MigrationPage /></Suspense>
 : activeTab === 'storage' ? <Suspense><StorageProviderSettings /></Suspense>
 : (... 标准字段渲染 ...)}
```

两个组件都用 `lazy()` 懒加载:
- `MigrationPage` 见 §3
- `StorageProviderSettings` 见 06 文档

### 2.9 设计系统应用点

- tab 切换 active:`bg-primary text-white shadow-md`(legacy 主色)
- 主体 card:`rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]`(legacy)
- 输入框:`bg-[var(--bg-input)] border-[var(--border-subtle)] focus:border-primary/50`
- 保存按钮:`bg-primary text-white shadow-lg shadow-primary/20`
- 大量 legacy `var(--text-*)` / `var(--bg-*)` 系列

### 2.10 已知限制

1. ⚠ **设置字段元数据硬编码**:新增字段需要前端 + 后端(可能也要 migration)同步改;后端可以提供 schema endpoint
2. ⚠ **`useSettingsStore` 与本页的 formData 重复**:store 里也有 siteName/siteDescription/siteUrl,但没人写;真实数据走后端
3. ⚠ **保存只 PATCH,不区分字段类型**:bool 转 string、JSON 转 string 全前端做(`settingsService.batchUpdate(Record<string,string>)`)
4. ⚠ **`hasChanges` 浅 compare** 在 social-links 之类的数组上不准 — 数组 reference 改但内容相同时会误标
5. ⚠ **`Suspense fallback` 用 `Loader2 animate-spin`** ⚠ 违反 §3.6 spinner 红线

---

## 3. VanBlog 迁移(`MigrationPage.tsx`,123 行 + `pages/migration/*`)

### 3.1 入口

- 路径:`/settings` 选 `migration` tab(也注册了独立 `/migration` 路由?— **未在 App.tsx 看到**)
- 入口:`pages/MigrationPage.tsx`
- 子模块:
  - `useMigrationWizard.ts`:5 步状态机(reducer)
  - `steps/StepUpload.tsx` → `StepOptions.tsx` → `StepPreview.tsx` → `StepExecute.tsx` → `StepSummary.tsx`

### 3.2 5 步向导

```
upload     选 / 拖 .json 文件,客户端解析得到 backup 概览
options    导入选项:conflict 策略 / preserveTimestamps / 是否导入隐藏 / 草稿 / 已删除 / preservePasswords / onlyArticleIds
preview    POST /analyze (multipart) 拉 dry-run 报告 → 显示 AnalysisReport
execute    POST /import/stream (SSE) 流式执行 → 实时进度
summary    展示 ExecutionSummary 与 errors/warnings
```

### 3.3 状态机(`useMigrationWizard.ts`)

`useReducer` + 12 种 Action:

```ts
'setFile' | 'clearFile' | 'setOptions' | 'setStep'
'setSelectedIds' | 'analyzeStart' | 'analyzeSuccess' | 'analyzeFailure'
'executeStart' | 'executeEvent' | 'executeEnd' | 'reset'
```

`executeEvent` 是 SSE 事件聚合:
- `phase`:更新 phases map(start / categories / tags / articles / post_tags / done)
- `item`:推到 recentItems(只显示最近若干条)
- `summary`:写到 state.summary
- `fatal`:写到 fatalError

### 3.4 调用接口

| Method | Path | 用途 |
| --- | --- | --- |
| POST | `/v1/admin/migrations/vanblog/analyze` | dry-run(返回 AnalysisReport) |
| POST(SSE) | `/v1/admin/migrations/vanblog/import/stream` | 流式执行,事件 `phase / item / summary / fatal` |
| POST | `/v1/admin/migrations/vanblog/import?mode=dry-run\|execute` | 兼容老接口(在 `postService.importVanBlog` 暴露,但 MigrationPage 不用) |

### 3.5 SSE 实现(`migrationService.streamImport`)

`migrationService.ts:150-219`:

- 用 `fetch + ReadableStream`(EventSource 不支持 multipart POST)
- 鉴权:从 `useAuthStore.getState().token` 取 Bearer + `credentials: 'include'`
- 按 `\n\n` 拆事件,行内 `data:` 前缀去掉
- 多行 `data:` 用 `\n` join 后 `JSON.parse`
- malformed 事件静默忽略(继续消费流)

### 3.6 设计系统应用点

- Stepper:Codex 风格 `aurora-1` 圈 + 字号阶梯 + tracking
- 步骤卡:`surface-leaf` 表面 + Codex 排版

---

## 4. 友链(`FriendsPage.tsx`,413 行)

### 4.1 入口

- 路径:`/friends`
- 入口:`pages/FriendsPage.tsx`
- 子模块:`pages/friends/components/SortableFriendItem.tsx`(单条,集成 dnd-kit)

### 4.2 视图

- Header(标题 + 添加 CTA)
- 友链列表:每条显示 logo / name / url / description / themeColor / 可见性 toggle / 编辑 / 删除 / 拖拽手柄
- 编辑表单:dialog 形式(`isFormOpen`),react-hook-form + zod 校验
- 移动端用 createPortal 全屏抽屉,桌面端 inline modal

### 4.3 状态拓扑

```
useQuery(['friends']) → friendService.getAll() → FriendLink[]
saveMutation:    friendService.create / update
deleteMutation:  friendService.delete
toggleMutation:  friendService.toggleVisible(id)
reorderMutation: friendService.reorder(ids[])
```

### 4.4 表单校验(`friendSchema`)

```ts
z.object({
  name: z.string().min(1).max(50),
  url: z.string().url(),
  logo: z.string().url().optional(),
  description: z.string().max(200).optional(),
  email: z.string().email().optional(),
  themeColor: z.string().optional(),
  rssUrl: z.string().url().optional(),
})
```

### 4.5 拖拽排序

`@dnd-kit/core` + `@dnd-kit/sortable`:

```tsx
<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
  <SortableContext items={friendsIds} strategy={verticalListSortingStrategy}>
    {friends.map(f => <SortableFriendItem key={f.id} ... />)}
  </SortableContext>
</DndContext>
```

`handleDragEnd` 用 `arrayMove(friends, oldIdx, newIdx)` 算新顺序 → `reorderMutation.mutate(ids)` → 后端 `PATCH /friend-links/reorder`(body 是按新顺序排的 id 数组)。

⚠ 看到的是"乐观更新前用 mutation 的 onSuccess invalidateQueries",**没有**先本地切换数组 + 后端补充 — 卡顿时拖拽会回弹。

### 4.6 调用接口

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/v1/admin/friend-links` | 全部(按 sortOrder 升序) |
| GET | `/v1/admin/friend-links/page?pageNum=&pageSize=` | 分页(未用) |
| POST | `/v1/admin/friend-links` | 创建 |
| PUT | `/v1/admin/friend-links/{id}` | 更新 |
| DELETE | `/v1/admin/friend-links/{id}` | 删除 |
| DELETE | `/v1/admin/friend-links/batch` | 批量删除(未用) |
| PATCH | `/v1/admin/friend-links/{id}/toggle-visible` | 切换可见性 |
| PATCH | `/v1/admin/friend-links/reorder` | 重新排序 |

### 4.7 设计系统应用点

- 卡片:`surface-leaf` + `data-interactive`(自动 hover stripe)
- 主色按钮 + Codex `font-display` 标题
- 表单 `react-hook-form + zod` 错误展示用 `text-status-danger`

### 4.8 已知限制

1. ⚠ **拖拽不乐观更新**:大列表卡顿时体验差
2. ⚠ **批量删除入口缺**:后端 `/batch` 已有,前端没接
3. ⚠ **logo 是 url string,不能直接上传**:与 SettingsPage 的 image-upload 不一致

---

## 5. AetherHub(`pages/aetherhub/AetherHubWorkspacePage.tsx`)

### 5.1 入口

- 路径:`/aetherhub`(注意:**不在 AdminLayout 内**,见 `App.tsx:70` `<AuthGuard><AetherHubWorkspacePage /></AuthGuard>`)
- 入口:`pages/aetherhub/AetherHubWorkspacePage.tsx`(>1500 行,本文档侧重交互逻辑)
- 入口在 sidebar `INTELLIGENCE` 组,标 "灵境"

### 5.2 定位

独立的 AI 对话工作台,与 AIToolsPage(单步生成)、AiWritingWorkspace(在文章里用)区分:
- 多轮对话(messages 数组)
- 多会话管理(sessions 列表 + 切换 + 删除)
- 三种模式:`chat / cowork / code`(对应 AgentMode)
- 显示模式:`bubble`(气泡)/ `engraved`(版书 — 凸起浮印质感)
- 流式动画:`none / fade / smooth`
- 字号自定义:13-17px
- 上下文(@):选中已发布文章,作为对话上下文

### 5.3 状态拓扑(摘要)

```
sessions / activeId / hydrated      // 会话集合 + localStorage 持久化(每用户独立 ns)
modelsState                         // useAgentModels(true) 拉模型清单
composer / streaming / abortRef     // 输入区 + 流式控制
selectedArticles                    // @ 选中的文章(每会话独立)
panelCollapsed                      // 右侧上下文面板
displayMode / streamAnimation / fontSize  // 显示偏好(localStorage 持久化)
greeting                            // 跨整点切换"早上好/中午好/...")
```

### 5.4 数据流

```
mount:
  loadSessions(currentUser.id) → 读 localStorage[`aetherblog.admin.agent.sessions.{userId}`]
  没有就 createEmptySession('chat') → 第一条空会话

useAgentModels(true):
  → /api/v1/admin/providers/models?model_type=&enabled_only=
  → 显示在模型选择器

handleSend(text):
  ├─ 添加 userMsg + 占位 assistantMsg(pending: true)
  ├─ streamAgentChat({ sessionId, mode, messages, modelId, providerCode, articleIds, tagSlugs },
  │                   { onDelta, onThink, onSources, onDone, onError }, signal)
  │     → POST /api/v1/agent/chat (SSE)
  ├─ 流式接收并 useSmoothStream 平滑吐字
  └─ onDone → assistantMsg.pending=false + finishedAt

handleAbort:
  abortRef.current.abort()
  关键修复:abort 走 AbortError 不会触发 onDone/onError,
  所以手动把所有 pending=true 的 assistant 消息落定到完成态
  避免 ThinkingMeta 的 100ms tick 一直滚

handleNewSession / handleSelectSession / handleDeleteSession:
  操作 sessions array + activeId,自动持久化
```

### 5.5 调用接口

| Method | Path | 用途 |
| --- | --- | --- |
| POST(SSE) | `/api/v1/agent/chat` | Agent 对话流(直接打到 ai-service,通过 backend 透传) |
| GET | `/api/v1/admin/providers/models?...` | 模型清单(useAgentModels) |
| GET | `/api/v1/admin/posts/?...` | @ 选文章时的搜索(useArticleSearch) |

### 5.6 SSE 协议(`services/agent/chat.ts`)

事件类型(`streamAgentChat` 内部解析):

```
delta    {type, content, isThink?: bool}    增量正文 / 思考
think    (单独 type 'think')                早期协议,目前合并到 delta.isThink
sources  {type, sources: [{title, slug}]}   引用文章
done                                         结束
error    {type, message}                     错误
```

与 `useStreamResponse` / `useReindexStream` 协议又是一份独立实现。

### 5.7 持久化策略

- 会话 + 消息存 `localStorage[storageKey(userId)]`,每用户独立 namespace
- 注释说"后续上 DB 时把 load/saveSessions 替换为 /api/v1/agent/sessions REST 即可"
- 显示偏好(displayMode / streamAnimation / fontSize)走单独 localStorage key

### 5.8 设计系统应用点

满级 Codex:
- 全屏 `bg-[var(--bg-void)]` + 自管 ambient 光晕
- `font-display` (Fraunces) 顶端 brand
- `font-mono` (Geist Mono) caption
- `surface-overlay` Modal / 上下文面板
- aurora-1..4 强调
- markdown preview(@aetherblog/editor)+ codex 字体

### 5.9 已知限制

1. ⚠ **`AetherHubWorkspacePage.tsx` 1500+ 行**,组件未拆分(顶部 70 行 import,后面 1400+ 行 JSX/state/handler)
2. ⚠ **会话存 localStorage,跨设备不同步**;清缓存丢全部历史
3. ⚠ **对话历史无搜索 / 标签 / 归档**
4. ⚠ **无导出**(转 Markdown / PDF)
5. ⚠ **错误恢复**:中途断网导致部分 assistant 消息可能 `pending=true` 永留 — handleAbort 修复了主动 abort,但 onError 路径下 pending state 处理需要核实
6. ⚠ **三种模式(chat/cowork/code)前端逻辑统一**,后端处理不同 — 切模式后是否清 messages 待核实

---

## 6. 跨切片依赖

- SettingsPage 依赖 `mediaService.upload`(03)处理 logo 上传
- SettingsPage 内嵌 MigrationPage(本文)+ StorageProviderSettings(06)
- AetherHub 通过 `useArticleSearch`(`services/agent/resources.ts`)消费 PostsService(02)
- AetherHub 通过 `useAgentModels` 消费 aiProviderService(04)
- FriendsPage 是少数完全 React Query + dnd-kit 的页面,可以作为其他列表页迁移的样板

---

## 7. 已知限制 / 待改进

1. ⚠ Settings 字段元数据硬编码;新增字段需双侧改
2. ⚠ Suspense fallback 用 spinner,违反 §3.6
3. ⚠ AetherHubWorkspacePage 应拆组件
4. ⚠ AetherHub 会话本地存,缺 DB 持久化
5. ⚠ Migration 的 `phases / recentItems / summary` 在 reducer 内强约束;新增 phase / item 类型需更新 union
6. ⚠ Friends 拖拽不乐观更新
7. ⚠ Agent SSE 协议 / useStreamResponse 协议 / useReindexStream 协议 / migrationService SSE 协议 — 4 套独立 SSE 实现,缺公共解析层
8. ⚠ Settings 大量 legacy token,Codex 迁移不彻底
