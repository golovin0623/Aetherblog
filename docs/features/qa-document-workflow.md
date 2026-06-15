# 试卷智能拆题 / 校对 / 修复 / 审批入库闭环（QA Document Workflow）

> 状态：v1（feat 分支 `claude/document-qa-workflow-y4adbu`）。本文件是后端 / AI 服务 / 前端三层的**唯一契约源**。任何接口/字段变更必须先改本文件。
>
> 设计原则（铁律）：
> 1. **不直接改原始文件**。原图/原 PDF 落 `media_files`，只读。所有校对/修复/合并/Diff 都基于 **Canonical Document Tree**（`qa_doc_blocks` + 版本快照）。
> 2. **Agent 只产出 Patch Proposal**，审批前**绝不**写正式题库（`qa_questions`）。Agent 只读「当前版本子树 + 标注 + 裁剪图 + OCR 结果」。
> 3. **每个 Worker 阶段幂等、可重试、可观测**（`qa_document_jobs` 记录 attempt/log/error）。
> 4. OCR/版面/PDF 栅格化引擎**可插拔**，当前默认 **mock**（确定性、无外部系统依赖），契约稳定后可换真实引擎。

---

## 1. 状态机（`qa_documents.status`）

```
UPLOADED → PREPROCESSING → SEGMENTED → OCR_DONE → STRUCTURED → REVIEW_READY
  → (人工标注) ANNOTATED
  → (触发 Agent) AGENT_RUNNING → PATCH_PROPOSED
  → (合并 Patch) MERGED → DIFF_READY
  → (审批) APPROVED → (发布) PUBLISHED
任意阶段异常 → FAILED
```

自动流水线（上传后由 Worker 串行推进，无需人工）：`PREPROCESSING → SEGMENTED → OCR_DONE → STRUCTURED → REVIEW_READY`。
人在环节点（显式 API）：标注、Agent 修复、合并、审批、发布。

合法迁移表（service 层 `qaTransitions` 强校验，非法迁移返回 409）：

| from | allowed to |
| --- | --- |
| UPLOADED | PREPROCESSING, FAILED |
| PREPROCESSING | SEGMENTED, FAILED |
| SEGMENTED | OCR_DONE, FAILED |
| OCR_DONE | STRUCTURED, FAILED |
| STRUCTURED | REVIEW_READY, FAILED |
| REVIEW_READY | ANNOTATED, AGENT_RUNNING, FAILED |
| ANNOTATED | AGENT_RUNNING, REVIEW_READY, FAILED |
| AGENT_RUNNING | PATCH_PROPOSED, FAILED |
| PATCH_PROPOSED | MERGED, REVIEW_READY, ANNOTATED, FAILED |
| MERGED | DIFF_READY, FAILED |
| DIFF_READY | APPROVED, REVIEW_READY, FAILED |
| APPROVED | PUBLISHED, FAILED |
| PUBLISHED | (terminal) |
| FAILED | PREPROCESSING, SEGMENTED, OCR_DONE, STRUCTURED, REVIEW_READY (reprocess 重入) |

## 2. 拆分粒度（`qa_documents.split_granularity`）

| 枚举 | 中文 | 生成的 block 层级 |
| --- | --- | --- |
| COARSE | 粗略 | 按页：PAGE |
| STANDARD | 标准 | 版面块：PAGE → BLOCK |
| FINE | 精细 | 题目级：PAGE → BLOCK → QUESTION →（STEM / OPTION / ANSWER / ANALYSIS）|
| ULTRA_FINE | 极精细 | 在 FINE 基础上再拆：SUB_QUESTION / FORMULA / TABLE / TABLE_CELL |

block_type 全集：`PAGE, BLOCK, QUESTION, STEM, OPTION, ANSWER, ANALYSIS, SUB_QUESTION, FORMULA, TABLE, TABLE_CELL`。

## 3. Canonical Document Tree（节点 JSON）

`qa_doc_blocks` 一行 = 一个节点；树通过 `parent_id` + `order_index` 重建。`stable_key` 跨版本稳定，是 Patch/Diff/Merge 的命中锚点。

```jsonc
{
  "stableKey": "p1-b2-q1.stem",     // 跨版本稳定锚点
  "blockType": "STEM",
  "pageNo": 1,
  "bbox": {"x": 0.10, "y": 0.20, "w": 0.50, "h": 0.05}, // 归一化 0~1，相对页面
  "text": "求函数 f(x)=x^2 的导数",
  "confidence": 0.97,                // 0~1，OCR/结构化置信度
  "sourceCropUrl": "/api/uploads/qa/<docId>/crops/p1-b2-q1.stem.png",
  "orderIndex": 0,
  "fieldPath": "questions[0].stem",  // 发布时映射 qa_questions 字段
  "children": [ /* 同结构 */ ]
}
```

## 4. Patch Proposal（`qa_patches.operations`）

Agent 只能返回如下结构，命中 `stableKey`(+`fieldPath`)：

```jsonc
{
  "summary": "修正 3 处错字、1 处答案错误",
  "operations": [
    {
      "op": "replace_text",   // replace_text | update_field | insert_block | delete_block | split_block | merge_block
      "stableKey": "p1-b2-q1.stem",
      "fieldPath": "text",    // 字段级时填
      "oldValue": "导树",
      "newValue": "导数",
      "reason": "OCR 错字",
      "confidence": 0.95
    }
  ]
}
```

## 5. Diff（`qa_document_diffs.diff`）

```jsonc
{
  "level": "CHAR",            // CHAR | FIELD | STRUCTURE（取本次合并涉及的最高粒度）
  "fromVersion": 1,
  "toVersion": 2,
  "changes": [
    {"stableKey": "p1-b2-q1.stem", "fieldPath": "text", "kind": "modified",
     "before": "导树", "after": "导数",
     "charDiff": [{"t":"导","op":"="},{"t":"树","op":"-"},{"t":"数","op":"+"}]}
  ],
  "conflicts": [ {"stableKey": "p1-b2-q5.answer", "reason": "base 已被人工修改，patch 基线过期"} ]
}
```

有 `conflicts` 时 `qa_document_diffs.has_conflict=true`，进入人工处理（前端冲突区）。

## 6. 数据库（migration 000081）

| 表 | 作用 |
| --- | --- |
| `qa_documents` | 文档主记录 + 状态机 + 当前版本号 |
| `qa_document_jobs` | 异步流水线任务（每阶段一行，幂等/重试/日志）|
| `qa_document_versions` | 版本快照（tree_json + source：OCR/STRUCTURE/AGENT/MERGE/MANUAL）|
| `qa_doc_blocks` | Canonical Tree 节点（按 version_id 归属）|
| `qa_annotations` | 校对标注 |
| `qa_patches` | Agent Patch Proposal（PROPOSED/MERGED/APPROVED/REJECTED/CONFLICT）|
| `qa_document_diffs` | 合并产生的 Diff 结果 |
| `qa_questions` | 审批发布后的正式题库（带 source 溯源 + 版本号）|
| `qa_audit_logs` | 审计日志（每个状态迁移/人工动作）|

详见 migration 文件与 `.claude/docs/database-migrations.md`。

## 7. 后端 REST（`/api/v1/admin/qa-documents`，需 admin）

| 方法 路径 | 说明 |
| --- | --- |
| POST `` | multipart 上传(file,title?,granularity?)→建 media_file+qa_document，入队流水线 |
| GET `` | 列表（pageNum,pageSize,status,keyword）|
| GET `/:id` | 详情（document + jobs + 当前版本摘要）|
| DELETE `/:id` | 软删除 |
| POST `/:id/reprocess` | 从指定阶段重跑（body:{stage}）|
| GET `/:id/jobs` | 流水线任务列表 |
| GET `/:id/tree?version=` | 当前/指定版本 Canonical Tree |
| PATCH `/:id/blocks/:blockId` | 人工编辑某 block 文本（生成 MANUAL 版本）|
| GET `/:id/annotations` | 标注列表 |
| POST `/:id/annotations` | 新建标注 |
| PATCH `/:id/annotations/:aid` | 更新标注（状态/纠正文本）|
| DELETE `/:id/annotations/:aid` | 删除标注 |
| POST `/:id/agent-fix` | 触发 Agent 修复，入队 AGENT_FIX，产出 PATCH_PROPOSED |
| GET `/:id/patches` | Patch 列表 |
| GET `/:id/patches/:pid` | Patch 详情 |
| POST `/:id/patches/:pid/merge` | 合并 Patch→新候选版本+Diff（DIFF_READY；冲突标记）|
| GET `/:id/diffs/:did` | Diff 详情 |
| POST `/:id/approve` | body{versionId} 审批候选版本（→APPROVED）|
| POST `/:id/publish` | 发布→写 qa_questions（→PUBLISHED）|
| GET `/:id/questions` | 已发布题目 |
| GET `/:id/audit` | 审计日志 |

## 8. AI 服务（`/api/v1/ai/qa/*`，Go 经 `X-Internal-Service` 调用）

可插拔 OCR Provider 接口 `OcrProvider`，默认 `MockOcrProvider`（确定性）。

| 方法 路径 | 入 → 出 |
| --- | --- |
| POST `/api/v1/ai/qa/preprocess` | {documentId,fileUrl,fileType} → {pages:[{pageNo,width,height,imageUrl}]} |
| POST `/api/v1/ai/qa/segment` | {pages,granularity} → {blocks:[{pageNo,bbox,blockType,orderIndex,sourceCropUrl,parentRef,localRef}]} |
| POST `/api/v1/ai/qa/ocr` | {blocks} → {results:[{ref,text,confidence}]} |
| POST `/api/v1/ai/qa/structure` | {blocks,granularity} → {tree:[<canonical node>]} |
| POST `/api/v1/ai/qa/quality-check` | {tree} → {issues:[{stableKey,type,message,severity}]} |
| POST `/api/v1/ai/qa/agent-fix` | {tree,annotations,crops,ocr} → {patch:{summary,operations:[...]}} |

`agent-fix` 在配置了真实 LLM 时调用 LLM（结构化 JSON 输出）；否则回退到确定性 mock（基于标注 corrected_text 直接生成 replace_text 操作）。

后端通过 `AETHERBLOG_QA_PIPELINE_MODE`（`mock`|`http`，**默认 `mock`**，对齐「pluggable, mock first」）选择用内置确定性 mock 流水线（无 Python 环境/单测/默认）还是调用 AI 服务 `/api/v1/ai/qa/*`。mock 流水线会在某个 STEM 注入一处已知错字（导树→导数）以驱动「质检→标注→Agent 修复→Diff→审批」全链路演示。

## 9. 权限与安全

- 所有 `/v1/admin/qa-documents/*` 走 `authMW + pwdRotated + RequireRole("admin")`。
- 写路径每用户 60/min 限流（`onlyMutating` 包装，读不计桶）。
- Agent 输出强制走 Patch 表，发布 API 是唯一写 `qa_questions` 的入口，且要求 `status=APPROVED`。
- 上传走现有 `MediaService`（继承存储后端/大小限制/文件夹权限）。

## 10. 测试

- Go：状态机迁移合法性、粒度→block 层级映射、Canonical Tree Diff（字符/字段/结构）、Patch 应用与冲突检测、mock 流水线各阶段幂等（pure-logic，无需 DB）。
- Python：mock OCR provider 确定性、各 `qa/*` 端点 schema、agent-fix mock 回退。
- 前端：service 层 API 形状对齐本文件。
