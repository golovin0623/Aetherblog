# 02 · Atlas Carrier 与 Annotation

## 1 · 责任范围

Carrier 是 Atlas 的输入材料抽象,Annotation 是材料上的可迁移标注。当前工作树已实现 Markdown note carrier、carrier versioning、annotation CRUD 和锚定迁移的基础管线;PDF carrier 有 service skeleton,但不在 server.go 路由里暴露为完整用户路径。

本能力不负责知识点关系图,那部分在 [03-knowledge-points-relations.md](./03-knowledge-points-relations.md)。

---

## 2 · 关键代码入口

| 入口 | 责任 |
| --- | --- |
| `apps/server-go/internal/server/server.go:264-297` | 装配 Atlas repo/service/handler,挂载 `/v1/admin/atlas` |
| `apps/server-go/internal/knowledge/handler/atlas_handler.go:26-53` | `/atlas/health` 和子 handler 挂载 |
| `apps/server-go/internal/knowledge/handler/carrier_handler.go` | carrier 路由挂载：`POST /carriers/{markdown,pdf,post,web,...}`、`GET /carriers`（list，支撑「读物」入口，按 owner/scope/type/limit 列出最近载体，`CarrierRepo.List`）、`GET /carriers/:id`、`GET /carriers/:id/text-layer` |
| `apps/server-go/internal/knowledge/handler/annotation_handler.go:37-44` | annotation CRUD 与 carrier 下标注列表 |
| `apps/server-go/internal/knowledge/service/markdown_carrier.go:55-131` | note -> markdown carrier 的懒创建、hash 检测、标注迁移、版本推进 |
| `apps/server-go/internal/knowledge/service/anchoring.go:43-68` | carrier 内容变化后更新 annotation anchor_state/score |
| `apps/server-go/internal/knowledge/pkg/anchoring/doc.go:1-10` | 当前锚定算法边界说明 |

---

## 3 · 数据流

### 3.1 Markdown carrier 懒创建

```
Admin Atlas Reader /atlas/reader/note/:noteId
  -> POST /v1/admin/atlas/carriers/markdown { noteId }
  -> CarrierHandler.EnsureMarkdown
  -> MarkdownCarrierService.GetOrCreateForNote
      1. NoteReader.GetNoteSnapshot
      2. source_uri = notes://{note_id}
      3. contentSHA256(note.Content)
      4. CarrierRepo.UpsertBySourceURI
      5. 首次创建 carrier + carrier_version v1
      6. 若 hash 变化,先迁移 annotation,再推进 hash/version
```

关键不变量:

- 不修改 `notes` 表 schema,仅通过 `NoteReader` 最小接口读取 note 快照。
- `source_uri` 必须唯一。migration 000066 将该不变量下沉到 DB,见 `apps/server-go/migrations/000066_atlas_carrier_unique_source_uri.up.sql:1-13`。
- 内容变更时先迁移 annotation,再写新 hash。这样迁移失败后下次打开仍会因 hash 不一致重试,见 `apps/server-go/internal/knowledge/service/markdown_carrier.go:98-127`。

### 3.2 Annotation CRUD

```
POST /v1/admin/atlas/annotations
  -> AnnotationHandler.Create
  -> AnnotationService.Create
  -> AnnotationRepo.Create
  -> INSERT atlas_annotations(selectors, rel_position, body_type, body_text, body_meta, anchor_state)
```

`server.go` 对 `/atlas/*` 加了两层权限:

- 读路径需要 `content.atlas.read`。
- 写路径通过子 handler 传入 `content.atlas.write`,见 `apps/server-go/internal/server/server.go:277-296`。

---

## 4 · DB 表与字段

由 000062 建立:

- `atlas_carriers`:多模态载体,字段含 `type/source_uri/content_hash/title/metadata/owner_id/status/deleted`。
- `atlas_carrier_versions`:每个 carrier 的版本叠加,`(carrier_id, version_no)` 唯一。
- `atlas_annotations`:W3C selector 数组、Y.RelativePosition、body、anchor_state、anchor_score。

由 000066 增加:

- `uq_atlas_carriers_source_uri UNIQUE(source_uri)`:保证并发打开同一 note 不会产生重复 carrier。

---

## 5 · 配置 / 环境变量 / 第三方依赖

- 当前 Markdown carrier 不依赖外部服务。
- PDF carrier skeleton 会读取 media file,但当前没有完整 admin route 链路。
- 锚定算法当前主要是文本空间转换与简单 relocate,不是完整向量/Bitap 混合实现。

---

## 6 · 与其他模块耦合

- **智能笔记:** Markdown carrier 只读取 note 快照,不直接 import Note model。适配器见 `apps/server-go/internal/knowledge/service/note_reader_adapter.go:1-6`。
- **权限系统:** 依赖 `content.atlas.read/write/admin` 权限 seed。
- **前端 Reader:** 前端选区生成 selector 的逻辑在 `apps/admin/src/pages/atlas/lib/selectors.ts` 与 `anchoring.ts`。
- **数据库迁移:** 000062 是核心骨架,000066 修并发唯一性。

---

## 7 · 已知限制 / 待改进

1. **`anchoring/doc.go` 明确当前不存在完整锚定算法。** 注释写着 anchor_state/score 仍为默认 1.0,这与 service 中已有迁移管线并存,说明“管线有了,算法还粗”。
2. **PDF carrier 是 skeleton。** `pdf_carrier.go` 可基于 `media://{media_file_id}` 包装 PDF,但 admin 页面和路由尚未形成闭环。
3. **Annotation selector 约束分散。** DB 只保证 selectors 数组非空,service/前端才保证多选择器语义;新增载体类型时要补双端校验。

---

## 8 · 测试覆盖说明

- `apps/server-go/internal/knowledge/pkg/anchoring/markdown_text_test.go` 覆盖 Markdown 到 plaintext 的转换。
- 当前未看到 annotation handler/service 的 Go 单元测试;涉及 selector 迁移和并发 upsert 的路径需要补。
