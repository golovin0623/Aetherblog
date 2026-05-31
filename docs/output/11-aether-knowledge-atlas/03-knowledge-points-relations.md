# 03 · KnowledgePoint / TypedRelation / Graph

## 1 · 责任范围

KnowledgePoint(KP) 是 Atlas 的一阶知识对象,TypedRelation 是 KP 之间的有类型关系。Annotation 是证据,但不是 KP 本身。当前实现支持 KP CRUD、Annotation-KP evidence 链接、Relation CRUD、Graph 查询。

---

## 2 · 关键代码入口

| 入口 | 责任 |
| --- | --- |
| `apps/server-go/internal/knowledge/handler/kp_handler.go:1-16` | 路由清单:KP、evidence、relations、graph |
| `apps/server-go/internal/knowledge/handler/kp_handler.go:48-60` | 具体挂载到 `/v1/admin/atlas/*` |
| `apps/server-go/internal/knowledge/service/kp_service.go:32-60` | KP service 入口与 Create 校验 |
| `apps/server-go/internal/knowledge/repository/kp_repo.go:30-47` | KP insert/select |
| `apps/server-go/internal/knowledge/repository/relation_repo.go:27-43` | relation insert/select |
| `apps/server-go/internal/knowledge/model/knowledge_point.go:5-63` | KP / relation model 与 relation type 集合 |
| `packages/types/src/models/atlas.ts:35-63` | 前端共享 KP type、status、relation type |

---

## 3 · 数据流

### 3.1 创建 KP

```
POST /v1/admin/atlas/knowledge-points
  -> KPHandler.CreateKP
  -> KnowledgePointService.Create
  -> KPRepo.Create
  -> INSERT atlas_knowledge_points
```

KP 字段包括 `title/body_markdown/type/confidence/status/embedding/embedding_dim/author_id/provenance/ai_suggestion_id`。`uuid` 在 000064 加默认 `gen_random_uuid()`,避免应用层必须显式传。

### 3.2 绑定 evidence

```
POST /v1/admin/atlas/knowledge-points/:id/annotations
  -> atlas_annotation_kp_links(annotation_id,kp_id,role)
```

同一 annotation 可以支撑多个 KP,同一 KP 可以有多条 annotation 作为出处。`role` 支持 `evidence/definition/example/counter`,见 `apps/server-go/migrations/000064_atlas_kp_links.up.sql:17-32`。

### 3.3 创建 relation

```
POST /v1/admin/atlas/relations
  -> RelationService.Create
  -> RelationRepo.Create
  -> INSERT atlas_typed_relations
```

relation type 为严格枚举,当前 9 种:

```
supports, refutes, specializes, generalizes, precedes,
causes, similar_to, cites, instance_of
```

ai-service stub 和 TS 类型必须跟 Go model 保持一致。

### 3.4 Graph 查询

```
GET /v1/admin/atlas/graph?limit=...
  -> KPHandler.Graph
  -> KPRepo.List(limit)
  -> RelationRepo.ListGraphEdges(kp ids)
  -> { nodes, edges }
```

PR review 后图节点上限提高并在 repository 层限制,避免一次性返回过多节点拖垮 admin 图谱视图。

---

## 4 · DB 表与索引

- `atlas_knowledge_points`:KP 主表,含 fulltext GIN `to_tsvector('simple', left(title || ' ' || body_markdown, 200000))`。
- `atlas_typed_relations`:from/to KP、有类型关系、strength、provenance、ai_suggestion_id。
- `atlas_annotation_kp_links`:annotation 与 KP 多对多。
- `atlas_relation_evidence`:relation 与 annotation 多对多。

注意:KP 表预留 `embedding vector` 与 `embedding_dim`,但当前没有看到对应 HNSW index migration。未来上语义图谱搜索时要按 dim 建 partial index。

---

## 5 · 与其他模块耦合

- **Atlas annotation:** KP evidence 只存 annotation id,取证内容要回 annotation/carrier。
- **AI suggestion:** accept suggestion 时可创建 KP 或 relation,且 `provenance='ai_suggested'`。
- **前端图谱:** `AtlasGraphPage` 消费 `atlasService.getGraph`。
- **共享类型:** `packages/types/src/models/atlas.ts` 是 admin 的类型事实来源,与 Go model 手工同步。

---

## 6 · 已知限制 / 待改进

1. **关系类型同步是手工的。** Go model、DB CHECK、ai-service stub、TS 类型任一漏改都会产生运行期不一致。
2. **Graph 目前是列表图,不是图数据库。** 查询由 SQL list + relation edge 组成,没有路径搜索、社区发现或图算法。
3. **KP embedding 预留但未成体系。** 字段已在 000062,但未见索引、写入和召回闭环。

---

## 7 · 测试覆盖说明

当前未看到 KP/relation handler/service/repository 的专门测试文件。建议优先补:

- relation type 不支持时返回业务错误。
- self-loop 被拒绝。
- annotation-KP link 幂等。
- graph limit 生效。
