# 11 · Aether Knowledge / Atlas / 知识库 总体设计

> 范围:`apps/server-go/internal/{handler,service,repository,model,dto}/kb*`、`apps/server-go/internal/knowledge/**`、`apps/admin/src/pages/{knowledge,atlas}/**`、`apps/ai-service/app/api/routes/{knowledge_bases,atlas}.py`、`apps/ai-service/app/services/kb_*.py`、`packages/types/src/models/atlas.ts`。
>
> 基线:2026-05-29 / `origin/main` 基线 + 当前文档纠偏改动 / migrations 至 000067。

---

## 1 · 模块定位

Aether Knowledge 是近期新增的知识工作台集合,实际由两个相互独立但会逐步汇合的子域组成:

- **知识库(KB)**:面向灵境对话的 RAG 资料库。用户创建自定义库,上传文档,系统把文件归档到媒体库的系统目录,交给 ai-service 解析、切片、嵌入,并在 Agent chat 中按 `kbIds` 做语义召回。
- **Atlas / 知识图集**:面向笔记和多模态材料的标注图谱。它把输入材料抽象为 Carrier,在 Carrier 上创建 Annotation,再把 Annotation 提炼成 KnowledgePoint 和 TypedRelation。AI 产出只能进入 suggestion inbox,用户 accept 后才落地。

这不是旧 AI 搜索的简单扩展。KB 复用 search profile 的蓝绿思想,但拥有独立 `kb_profiles` / `kb_embeddings`;Atlas 复用 notes 和媒体的内容来源,但建了独立 `internal/knowledge` 子域,避免把知识点关系塞回 `notes` 或 `posts` 表。

---

## 2 · 架构图

```
Admin SPA
  /intelligence/knowledge
  /atlas/*
      |
      | axios R<T>
      v
server-go :8080
  /v1/admin/kbs/*            -> KB handler/service/repo
  /v1/agent/knowledge-bases  -> Agent KB picker
  /v1/agent/chat             -> 过滤 kbIds 后代理 ai-service
  /v1/admin/atlas/*          -> Atlas handler/service/repo
      |
      | internal token
      v
ai-service :8000
  /api/v1/kb/{id}/files/{fid}/index
  /api/v1/agent/chat + kb_recall
  /v1/atlas/claims/extract
  /v1/atlas/relations/suggest
      |
      v
PostgreSQL
  knowledge_bases / kb_profiles / kb_files / kb_embeddings / kb_members
  atlas_carriers / atlas_annotations / atlas_knowledge_points / atlas_typed_relations
  atlas_ai_suggestions / atlas_ignored_suggestions
  post_embeddings / search_profiles (SYSTEM_POSTS 召回复用)
```

---

## 3 · 子能力清单

| # | 能力 | 文档 | 主要入口 |
| --- | --- | --- | --- |
| 01 | 知识库 CRUD、文件归档、Profile、成员权限 | [01-knowledge-base.md](./01-knowledge-base.md) | `apps/server-go/internal/service/kb_service.go:69` |
| 02 | Atlas Carrier 与 Annotation | [02-atlas-carrier-annotation.md](./02-atlas-carrier-annotation.md) | `apps/server-go/internal/knowledge/service/markdown_carrier.go:38` |
| 03 | KnowledgePoint、TypedRelation 与 Graph | [03-knowledge-points-relations.md](./03-knowledge-points-relations.md) | `apps/server-go/internal/knowledge/handler/kp_handler.go:34` |
| 04 | AI suggestion inbox、KB recall、Agent 注入 | [04-ai-suggestions-and-recall.md](./04-ai-suggestions-and-recall.md) | `apps/server-go/internal/knowledge/service/suggestion_service.go:28` |
| 05 | Admin 前端入口与服务层 | [05-frontend-admin-surfaces.md](./05-frontend-admin-surfaces.md) | `apps/admin/src/App.tsx:37` |
| 06 | 数据库迁移与运维耦合 | [06-migrations-and-ops.md](./06-migrations-and-ops.md) | `apps/server-go/migrations/000058_knowledge_bases.up.sql:25` |

---

## 4 · 横向依赖

- **被以下模块调用:** 04 AI/搜索/系统(Agent chat、search profile)、06 Admin 前端、07 AI service、08 数据库迁移、10 运维部署。
- **调用以下模块:** 03 媒体与存储(KB 文件真实存储和系统目录)、01 鉴权与权限(RBAC/permission code)、02 内容与笔记(Atlas Markdown carrier 读取 notes)、04 搜索(post_embeddings/search_profiles)。
- **共享资源:** `AI_INTERNAL_SERVICE_TOKEN`、PostgreSQL `vector` 扩展、`media_folders` 系统目录 `/root/_system_kb`、`search_profiles` active profile、Agent chat 的 `X-Forwarded-User-ID`。

强耦合点:

| 触发改动 | 必须同步 | 证据 |
| --- | --- | --- |
| 修改 KB 文件上传大小或类型白名单 | Go `kbMaxBytes`、ai-service `/api/v1/kb/*` base64 decode、Admin 上传提示 | `apps/server-go/internal/service/kb_service.go:542` / `apps/ai-service/app/api/routes/knowledge_bases.py:74` |
| 修改 KB profile 模型/维度策略 | `kb_profiles` schema、`kb_indexer.py` 写入、`kb_recall.py` cast、HNSW partial index | `apps/server-go/migrations/000061_kb_embedding_hnsw.up.sql:14` / `apps/ai-service/app/services/kb_recall.py:88` |
| 修改 Atlas relation type | Go model 校验、DTO、TS 类型、ai-service stub、migration CHECK | `apps/server-go/internal/knowledge/model/knowledge_point.go:37` / `packages/types/src/models/atlas.ts:63` |
| 修改 Agent chat body | Go 侧 `filterBodyKBIDs` 与 Python `AgentChatRequest.kbIds` 要同步 | `apps/server-go/internal/handler/agent_handler.go:533` / `apps/ai-service/app/api/routes/agent.py:82` |

---

## 5 · 关键决策记录

### 5.1 KB 使用媒体库系统目录而不是新建文件存储

**背景:** 知识库文件仍需要上传、版本、备份、MIME、存储 provider、对象 key 等能力。

**决策:** migration 000057 给 `media_folders` 增加 `is_system` / `undeletable`,并 seed `/root/_system_kb`;KB 创建与上传通过 `FolderService.EnsureFolderByPath` 把物理文件放入该隐藏树。

**代价:** 媒体模块所有 list/tree/delete 路径必须默认过滤系统目录。系统目录漂移会卡住后续 000058+ KB 迁移,因此 `deploy.sh` 增加了 v57 dirty self-heal。

### 5.2 KB profile 复制 search profile 蓝绿模型

**背景:** 不同知识库的资料类型、chunker、模型和召回阈值会不同。

**决策:** `kb_profiles` 每个 KB 最多一条 active,其余 shadow/deprecated;`kb_embeddings` 按 `(kb_file_id, profile_id, chunk_index)` 唯一,支持未来蓝绿迁移。

**代价:** 每次切换 profile 都可能触发重建;当前全库重建仍主要由 Go 端逐文件调 index endpoint,ai-service `/api/v1/kb/{id}/reindex` 只是 ack。

### 5.3 Atlas 的 Annotation 与 KnowledgePoint 解耦

**背景:** 标注是出处证据,知识点是用户综合产物。如果二者混在一起,材料一改就会让知识点失稳。

**决策:** `atlas_annotations` 存 W3C selectors 和 anchor_state;`atlas_knowledge_points` 是一阶对象;`atlas_annotation_kp_links` 做多对多证据链接。

**代价:** 用户需要显式把标注转成知识点或接受 AI suggestion。短期 UI 会比简单高亮工具更重。

### 5.4 AI 不直接写 KP/Relation

**背景:** 自动抽取有误判风险,不能让 LLM 直接污染长期知识图谱。

**决策:** ai-service `/v1/atlas/*` 只生成候选;server-go `atlas_ai_suggestions` 存 inbox;用户 accept 后,Go 在一个事务里插 KP/Relation 并更新 suggestion。

**代价:** 当前 `/v1/atlas/*` 还是 deterministic stub,不是 LiteLLM 真调用。需要文档显式标注,避免把 Phase 3 误认为完整 AI 建图。

---

## 6 · 技术栈与库版本

| 类别 | 选择 | 版本/位置 |
| --- | --- | --- |
| Backend | Go 1.24.1 + Echo + sqlx | `apps/server-go` |
| AI service | FastAPI + asyncpg + LiteLLM + pgvector | `apps/ai-service` |
| Admin | React 19 + Vite 6 + React Router 7 | `apps/admin` |
| Vector DB | PostgreSQL 17 + pgvector | `vector` / `halfvec` partial HNSW |
| Shared types | TypeScript model exports | `packages/types/src/models/atlas.ts` |

---

## 7 · 已知问题清单

| 优先级 | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |
| P1 | `AtlasPage` 文案仍称 Phase 0 占位,但路由已注册 reader/KP/graph/suggestions | 后续开发者可能误判 Atlas 只到健康检查 | 更新页面文案或把入口改成真实 dashboard |
| P1 | ai-service Atlas AI 是 stub | “AI 辅助建图”可端到端跑通 inbox,但不是真 LLM 抽取 | UI 和文档均保留 stub 标识,直到接入 LiteLLM |
| P1 | KB reindex 全库端点在 ai-service 仅 ack | 用户可能以为 Python 端会独立排队重建 | 以 Go 端逐文件重发为事实,后续要做 SSE 再改文档 |
| P2 | CUSTOM KB 同一模型维度以外的 >4000 dim 没有 HNSW | 大库召回可能退化成顺序扫描 | 推荐 1536/3072 维模型或增加外部 ANN |
| P2 | Agent chat 召回失败被 swallow | 对话可用性优先,但用户看不到 KB 未生效原因 | 增加可选 diagnostics / trace |

---

## 8 · 扩展点

- **KB 解析类型:** 在 `kb_indexer.py::parse_bytes_to_text` 增加解析器,并同步 Go 上传 MIME 白名单与 Admin 上传提示。
- **KB reindex SSE:** 把 ai-service `/api/v1/kb/{id}/reindex` 从 ack 升级为 SSE,Go/Admin 侧补流式进度。
- **Atlas LLM 抽取:** 将 `atlas.py` 的 heuristic stub 替换为 `deps.get_llm_router()` + task routing,但仍只写 suggestion。
- **Graph 搜索:** `atlas_knowledge_points.embedding` 已预留,后续可为 KP 建向量索引并把 KB recall 与 KP graph 合并。
- **权限细化:** 当前 `content.atlas.admin` 已 seed,但 server-go 路由主要用 read/write;未来要实现“管理任意用户 Atlas 数据”需补 service 层 owner/admin 判断。

---

## 9 · 与其他模块的交叉引用

- KB 文档上传依赖媒体系统目录和系统目录隐藏规则,详见 [03-backend-media-storage](../03-backend-media-storage/README.md)。
- Agent chat、搜索 profile 与 RAG 问答详见 [04-backend-ai-search-system/02-agent-and-jobs.md](../04-backend-ai-search-system/02-agent-and-jobs.md) 与 [04-backend-ai-search-system/03-search.md](../04-backend-ai-search-system/03-search.md)。
- Python 端 KB indexing / recall 归入 [07-ai-service-python](../07-ai-service-python/README.md)。
- 000057-000067 的 schema 与 dirty self-heal 归入 [08-database-migrations](../08-database-migrations/README.md)。
