# 01 · 知识库 KB

## 1 · 责任范围

知识库提供一个可被灵境对话消费的 RAG 资料空间。它不替代文章搜索,也不替代智能笔记;它把文档上传、归档、向量化、成员授权、Profile 配置和 Agent picker 串成闭环。

核心职责:

- `CUSTOM` 库:由用户创建,接受文件上传,文件落在媒体库系统目录。
- `SYSTEM_POSTS` 库:系统内置“文章索引库”,不接受上传,召回走 `post_embeddings` + `search_profiles`。
- Profile:每个 KB 一组模型、chunker、chunk size、overlap、top_k、threshold。
- 权限:owner/admin/kb_members 共同决定 `VIEW/USE/EDIT/MANAGE`。

---

## 2 · 关键代码入口

| 入口 | 责任 |
| --- | --- |
| `apps/server-go/internal/server/server.go:447-476` | 组装 KB repo/service/handler,挂载 `/v1/admin/kbs` 与 `/v1/agent/knowledge-bases`,并把 KBService 注入 AgentHandler |
| `apps/server-go/internal/handler/kb_handler.go:1-15` | KB CRUD、stats、files、reindex 路由清单 |
| `apps/server-go/internal/service/kb_service.go:69-106` | KBService 依赖聚合与默认 embedding model |
| `apps/server-go/internal/service/kb_service.go:220-355` | 创建 CUSTOM KB,自动建目录和默认 active profile |
| `apps/server-go/internal/service/kb_service.go:473-542` | 上传文件、落媒体系统目录、写 kb_files、后台向量化 |
| `apps/server-go/internal/handler/kb_agent_handler.go:1-26` | Agent picker 的 `/v1/agent/knowledge-bases` |
| `apps/ai-service/app/api/routes/knowledge_bases.py:49-96` | ai-service 单文件向量化执行端点 |
| `apps/ai-service/app/services/kb_indexer.py:143-204` | 上传字节到纯文本的解析矩阵 |

---

## 3 · 数据流

### 3.1 创建知识库

```
Admin /intelligence/knowledge
  -> POST /v1/admin/kbs
  -> KBHandler.Create
  -> KBService.Create
      1. slug 校验和唯一性预检
      2. INSERT knowledge_bases(kind=CUSTOM)
      3. EnsureFolderByPath /root/_system_kb/<slug>
      4. INSERT kb_profiles(code=default,status=active)
      5. UPDATE active_profile_id
      6. GetByIDForUser 返回 EffectivePermission
```

关键实现点:

- 显式 slug 会经 `slugifyStrict` 规范化校验,非法字符直接返回错误,避免污染 `/root/_system_kb/<slug>` 路径,见 `apps/server-go/internal/service/kb_service.go:231-246`。
- 创建失败会补偿删除 KB row,避免留下“无 active_profile_id 的孤儿 KB”,见 `apps/server-go/internal/service/kb_service.go:278-291`。
- 默认 profile 参数为 `recursive / 512 / 64 / top_k=6 / threshold=0.200`,见 `apps/server-go/internal/service/kb_service.go:303-316`。

### 3.2 文件上传与后台向量化

```
POST /v1/admin/kbs/:id/files multipart
  -> 校验 EDIT 权限 + CUSTOM kind
  -> EnsureFolderByPath /root/_system_kb/<slug>/<yyyy>/<mm>/<dd>
  -> MediaService.Upload(WithKBUploadContext)
  -> INSERT kb_files(vector_status=PENDING)
  -> goroutine scheduleIndex
      -> MarkRunning
      -> 下载 media 原始字节,最多 10MB
      -> POST ai-service /api/v1/kb/{kb}/files/{file}/index
      -> MarkSucceeded / MarkFailed
```

Go 侧单文件上限为 `kbMaxBytes = 10 * 1024 * 1024`,ai-service 路由也检查同样上限,见 `apps/server-go/internal/service/kb_service.go:542` 与 `apps/ai-service/app/api/routes/knowledge_bases.py:74-76`。

### 3.3 Agent 对话引用 KB

```
Admin AetherHub 选择 kbIds
  -> POST /v1/agent/chat body.kbIds
  -> AgentHandler.filterBodyKBIDs 按当前用户权限过滤
  -> ai-service AgentChatRequest.kbIds
  -> _build_kb_context_for_chat
  -> kb_recall.recall_kbs
  -> render_kb_context 拼进 system message
```

Go 侧先过滤客户端传入的 `kbIds`,避免用户手工拼未授权 KB 注入 prompt,见 `apps/server-go/internal/handler/agent_handler.go:133-145` 与 `apps/server-go/internal/handler/agent_handler.go:533-589`。

---

## 4 · DB 表与索引

主要由 migration 000058-000061 建立:

- `knowledge_bases`:主表,区分 `CUSTOM` / `SYSTEM_POSTS`,记录 owner、visibility、folder、active_profile 和统计缓存。
- `kb_profiles`:每 KB 独立索引配置,`uq_kb_profile_one_active` 保证单 active。
- `kb_members`:授权矩阵,principal 支持 `USER/TEAM/ROLE`,permission 支持 `VIEW/USE/EDIT/MANAGE`。
- `kb_files`:CUSTOM 引用 `media_files`,SYSTEM_POSTS 引用 `posts`,二者互斥。
- `kb_embeddings`:按 profile/file/chunk 存向量,embedding 不锁维度,用 `embedding_dim` 分桶。

HNSW partial index:

- `idx_kb_emb_1536_active`:vector(1536)
- `idx_kb_emb_3072_active`:halfvec(3072)
- `idx_kb_emb_1024_active`:vector(1024)
- `idx_kb_emb_768_active`:vector(768)

查询端必须按维度选择同样的 cast,否则 planner 不会命中表达式索引。ai-service 在 `_cast_type_for_dim` 中实现了同样规则,见 `apps/ai-service/app/services/kb_recall.py:88-94`。

---

## 5 · 配置与环境变量

- `AI_INTERNAL_SERVICE_TOKEN`:Go 调 ai-service KB index endpoint 的内部 token。
- `POSTGRES_DSN`:ai-service 直接写 `kb_embeddings`。
- `AI_MOCK_MODE`:若 mock 模式开启,embedding 行为需按 `LlmRouter.embed` 当前实现判断;生产不应依赖 mock。
- `search.active_embedding_model`:000059 为 SYSTEM_POSTS seed profile 时作为第一优先级读取。

---

## 6 · 与其他模块耦合

- **媒体系统:** 文件通过 `MediaService.Upload` 保存,系统目录依赖 migration 000057。
- **Agent chat:** `kbIds` 进入 Agent chat 前由 Go 过滤,Python 只信已过滤列表。
- **搜索系统:** `SYSTEM_POSTS` 召回复用 `post_embeddings` 与当前 active `search_profiles`。
- **活动审计:** KB handler 写 `activity_events` 的 `kb.*` 事件。

---

## 7 · 已知限制 / 待改进

1. **全库重建仍是 Go 侧逐文件调度。** ai-service `/api/v1/kb/{kb_id}/reindex` 当前只返回 ack 和文件数,见 `apps/ai-service/app/api/routes/knowledge_bases.py:99-116`。
2. **召回失败静默降级。** Agent chat 里 KB 召回异常被 warn 后吞掉,对话继续但用户不知道 KB 没生效。
3. **>4000 维向量无 HNSW。** `_cast_type_for_dim` 会回到 `vector`,对应没有 partial HNSW 索引。
4. **文档解析依赖可选包。** PDF 依赖 `pypdf`,DOCX 依赖 `python-docx`;缺包会把文件标 FAILED。

---

## 8 · 测试覆盖说明

- `apps/ai-service/tests/test_vector_store_chunk_checkpoint.py` 覆盖 chunk checkpoint 相关行为。
- `apps/ai-service/tests/test_llm_router_embedding_usage.py` 覆盖 embedding model 使用路径。
- 当前未看到专门的 Go KB service/repo 测试文件,这是后续应补的缺口。
