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
| `apps/admin/src/components/layout/Sidebar.tsx:69-80` | INTELLIGENCE 导航:灵境、智能笔记、知识图集、知识库、智能编排等 |
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

### 3.2 Atlas 入口与子页

`AtlasPage` 当前仍有较强 Phase 0 文案,但 App 已经注册 reader/KP/graph/suggestions 子页。这是一个实际文档/代码漂移点:入口页的“只显示健康自检和路线图”不再代表全模块能力。

### 3.3 服务层

`knowledgeBaseService` 覆盖:

- KB list/get/create/update/delete/stats
- files list/get/upload/delete/reindex/reindexAll
- profiles list/create/update/activate/delete/migrate
- members list/upsert/delete
- Agent picker `fetchAgentKnowledgeBases`

`atlasService` 覆盖:

- health
- carriers markdown ensure/get
- annotations CRUD/list
- knowledge points CRUD/evidence
- typed relations CRUD/graph
- suggestions list/get/create/accept/reject

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
