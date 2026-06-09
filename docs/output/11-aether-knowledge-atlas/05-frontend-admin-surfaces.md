# 05 · Admin 前端入口与服务层

## 1 · 责任范围

Admin 前端为知识库与 Atlas 提供可操作入口:

- `/intelligence/knowledge`:知识库列表,系统库置顶,用户库卡片。
- `/intelligence/knowledge/:slug`:知识库详情、文件、Profile、成员等。
- `/atlas`:Atlas 入口/健康卡/路线图。
- `/atlas/reader/note/:noteId`:Markdown note reader。
- `/atlas/kp/:id`:知识点详情。
- `/atlas/graph`:图谱视图。
- `/atlas/suggestions`:AI 建议 inbox。

这些入口都属于 `INTELLIGENCE` 导航组,不是内容管理或系统设置。

---

## 2 · 关键代码入口

| 入口 | 责任 |
| --- | --- |
| `apps/admin/src/App.tsx:37-43` | lazy 注册知识库和 Atlas 页面 |
| `apps/admin/src/App.tsx:127-133` | 实际路由注册 |
| `apps/admin/src/components/layout/Sidebar.tsx` | INTELLIGENCE 导航（已收敛为 6 项知识工作）：灵境、智能笔记、知识图集（单一入口）、知识库、智能编排、写作助手；AI 平台配置下沉到 `PLATFORM` 组 |
| `apps/admin/src/pages/atlas/AtlasLayout.tsx` | 知识图集工作台外壳：顶部 Tab（概览/读物/知识点/图谱/建议/搜索），收敛原本 5 个并列侧边栏入口 |
| `apps/admin/src/services/knowledgeBaseService.ts:172-283` | KB admin service 与 Agent picker service |
| `apps/admin/src/services/atlasService.ts:23-171` | Atlas REST 客户端 |
| `apps/admin/src/pages/knowledge/KnowledgeBasePage.tsx:46-100` | 知识库列表页主体 |
| `apps/admin/src/pages/atlas/AtlasPage.tsx:36-64` | Atlas 入口页健康检查与标题 |

---

## 3 · 页面结构

### 3.1 知识库列表

`KnowledgeBasePage` 使用 `IntelligenceShell` 和 `IntelligenceHeader`,调用 `knowledgeBaseService.list()` 拉取所有可见 KB。系统库通过 `kb.kind === 'SYSTEM_POSTS'` 加“系统”徽章,见 `apps/admin/src/pages/knowledge/KnowledgeBasePage.tsx:108-148`。

卡片显示:

- 文件数 `fileCount`
- chunk 数 `chunkCount`
- 失败数 `failedCount`
- active profile code
- 索引状态:已索引 / 部分失败 / 空库 / 处理中

### 3.2 Atlas 工作台与子页

（2026-06-09 重构，branch `codex/atlas-intelligence-redesign`，方案见 `docs/pm/atlas-redesign.md`）

`AtlasLayout` 作为工作台外壳，顶部 Tab 收敛六个子页：概览（`AtlasPage`）/ 读物（`ReadingsPage`）/ 知识点（`KnowledgePointsPage`）/ 图谱（`AtlasGraphPage`）/ 建议（`SuggestionsPage`）/ 搜索（`AtlasSearchPage`）；Reader 与 KP 详情作为沉浸式深页不挂 Tab 壳。

- **读物入口（`ReadingsPage` + `AddReadingDialog`）：** 修复「Reader 在 Atlas 内无入口」的激活断点。列出已有载体（`atlasService.listCarriers` → `GET /atlas/carriers`），并提供零依赖冷启动（网页快照 / 粘贴文本 → 直接进 Reader）。
- **概览（`AtlasPage`）：** 旧 Phase 0 占位文案已移除；顶部「读 → 标 → 联 → 问」可关闭引导条，并新增 `问灵境` 闭合「问」一步（此前 Atlas→灵境无任何链接）。
- **去术语化：** 所有 schema 枚举经 `apps/admin/src/pages/atlas/atlasLabels.ts` 翻译为用户语言，空状态均为真实 CTA；建议收件箱支持批量采纳。

### 3.3 服务层

`knowledgeBaseService` 覆盖:

- KB list/get/create/update/delete/stats
- files list/get/upload/delete/reindex/reindexAll
- profiles list/create/update/activate/delete/migrate
- members list/upsert/delete
- Agent picker `fetchAgentKnowledgeBases`

`atlasService` 覆盖:

- health
- carriers markdown/pdf/post/web/transcript/image ensure；`getCarrier`；**`listCarriers`（读物列表）**
- annotations CRUD/list
- knowledge points CRUD/evidence
- typed relations CRUD/graph
- suggestions list/get/create/accept/reject（前端支持批量采纳）

---

## 4 · 与其他模块耦合

- **AetherHub:** Agent chat 可选择 KB,因此知识库 service 也导出 `/v1/agent/knowledge-bases` picker。
- **智能笔记:** Atlas reader 路由以 noteId 为入口,借 MarkdownCarrierAdapter 包装 note。
- **权限/共享:** KB 成员权限和 Atlas RBAC 均依赖后端,前端只显示 effective permission 与操作可用性。
- **AI 配置:** KB profile 的 model_id 必须来自 embedding 模型,但当前 UI 需要确保不会选 chat-only model。

---

## 5 · 已知限制 / 待改进

1. **AtlasPage 文案过期。** 它仍显示 Phase 0 “严禁真实用户操作”,但其他 Atlas 子页已存在。需要更新为模块 dashboard 或移除误导文案。
2. **服务层类型分散。** KB 类型局部定义在 `knowledgeBaseService.ts`,Atlas 类型主要来自 `@aetherblog/types`,建议把 KB 类型也沉到 shared types。
3. **全局价格和搜索配置与 KB profile 选择关系未在 UI 串联。** 用户可能配置了 chat 模型但未配置 embedding 模型,KB vectorize 会失败。

---

## 6 · 测试覆盖说明

当前未看到前端知识库/Atlas 页面测试。建议补最小 smoke:

- `/intelligence/knowledge` 能渲染系统库和自定义库卡片。
- `/atlas/suggestions` accept/reject 后刷新状态。
- `/atlas/reader/note/:noteId` 能创建/复用 carrier。
- Agent picker 只显示有 USE 权限的 KB。
