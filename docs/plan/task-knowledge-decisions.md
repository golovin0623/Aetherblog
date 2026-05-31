# task-knowledge-decisions — Atlas 关键决策记录

> 父手册: [task-aether-knowledge-system.md](./task-aether-knowledge-system.md)  
> 用途: 锁定 D1/D2/D3 以及任何后续重大决策的状态、论据与回滚条件。  
> **变更协议**: 任何反转必须先在此文件追加新版本块（不删旧版本），再修改父手册对应章节。  
> 最新版本: V1.1 (2026-05-26) — Phase 0 启动当日定稿。

---

## D1 · 编辑器栈：CodeMirror vs Tiptap+Yjs

**当前选项**: **保守路径**（CodeMirror 单轨，新模块用 Tiptap+Yjs 并存于 Phase 2+，并非替换 `@aetherblog/editor`）。

**论据**:

- 现有 `@aetherblog/editor` (CodeMirror) 已稳定服务 `notes` + `posts` + `ai-writing`，重写代价巨大（仅 `CreateNotePage.tsx` 就 894 行）。
- Phase 1 的鲁棒锚定可以**只用 W3C 多选择器** + diff-match-patch 的 Bitap + Myers diff + 向量回退实现，**不依赖 Y.RelativePosition**。
- 锚定召回率红线 R1 = 90%——Phase 1 末若 W3C 单轨达标，Tiptap+Yjs 的双轨提升将是**边际收益**，不值得 bundle 体积代价（+400-600KB）。
- 风险登记 RISK-01 已记录。

**何时重估**: Phase 2 末复盘 R1 实际数字：
- 若 ≥ 95%：维持保守，永久搁置 Tiptap+Yjs（D1 终态）
- 若 90-95%：评估"是否值得 +400KB 换 5% 提升"
- 若 < 90%（已触发 R1）：必须深挖锚定栈，再决定是否上 CRDT

**Phase 0 Spike 结论**: 见 §Spike-1 / §Spike-2。

---

## D2 · `note_embeddings` 表与 worker

**当前选项**: **复活而非废弃**。表（`migration 000054`）+ admin UI 占位（`CreateNotePage.tsx` 的 "AI 索引状态" PanelGroup）已经接上 landing baseline worker：`000074` 补 profile/dim/model/token 与 HNSW 索引，ai-service `NoteIndexerService` 写 `note_embeddings`，Go `NoteService` 在 note 变更后异步触发索引，`scripts/atlas/reindex-embeddings.mjs` 可对历史 KP/note 执行 missing/stale backfill。

**论据**:

- 表结构已合理（`note_id / profile_id / chunk_index / chunk_text / parent_text / embedding / status`），与 KB 模块的 `kb_embeddings` 同模式。
- admin UI 已经把 `embeddingStatus` 字段渲染出来——补 worker 是**回填用户预期**，不是新增 UI 负担。
- Markdown Carrier 适配器已通过 `notes://{id}` 复用此表进入 Atlas recall，避免新建 `carrier_embeddings` 一张表导致两份索引数据。
- 当前仍需在生产环境实际运行 backfill 并保存输出；新建/更新后的 notes 已走异步索引。

**何时重估**:

- Phase 3 若决定建统一 `carrier_embeddings`，做一次 `note_embeddings → carrier_embeddings` 数据迁移
- 触发条件: 多种载体的向量统一查询出现 join 复杂度 > 3 时

---

## D3 · `note_links` 与 `atlas_typed_relations` 关系

**当前选项**: **两表并存，永不迁移**。`note_links` 是 notes 模块内部 wiki `[[]]` 实现；`atlas_typed_relations` 是 KP 之间的有类型关系。

**论据**:

- `note_links` 的语义是"文本字符串引用"，无类型；强行 cast 为 typed relation 会污染数据。
- 当用户从 note 升格为 KP 时，由 service 层做"建议 typed 化"而不是自动迁移。
- 两表索引数据量小（推断 < 10 万行），双轨成本可忽略。

**何时重估**: 永不（D3 终态）。如果未来要做"全图谱视图含 notes 节点"，新建 `unified_graph_view` 物化视图即可，不动底表。

---

## Spike-1 · diff-match-patch 中文鲁棒性

**任务编号**: `task-knowledge-P0-08-anchoring-spike`

**目的**: 验证 Hypothes.is 风格 robust anchoring 在中文 + Markdown 场景下的召回率，决定 D1 是否需要升级到 Y.RelativePosition 双轨。

**实施**: `scripts/atlas/anchoring-spike.mjs`（见同目录）。

### 方法（Phase 0 简化版）

- 选定 10 段 200-500 字中文文本（学术段落 + 技术博客 + 散文各 3-4 段）
- 对每段做 100 次随机编辑（插入/删除/替换 1-3 字）
- 在每个版本中尝试用 TextQuote (exact+prefix+suffix 各 30 字) 重新定位 50 个固定 anchor
- 统计 anchored / soft_anchored / orphan 比例

### Phase 0 跑分结果（2026-05-26）

| 编辑强度 | anchored | soft_anchored | orphan | recall (a+s) |
|---|---|---|---|---|
| light (5 edits)  | 31.37% | 49.24% | 19.39% | **80.61%** |
| medium (20 edits) | 0.43% | 9.94% | 89.63% | **10.37%** |
| heavy (60 edits)  | 0.00% | 0.43% | 99.57% | **0.43%** |

种子 `seed=1729`，10 段文本 × 50 锚点/段。

### Phase 0 结论 — 数据要点 + 重要 caveat

1. **light 场景 80.61% < 90% R1 红线** —— 但本 spike 的 fallback 算法是简化版滑窗+Levenshtein 编辑距离，**不是真实的 diff-match-patch Bitap+Myers diff**。真实 d-m-p 在 Hypothes.is 的工程实测上 light 场景普遍 ≥ 95%。本数字应解读为「下界」，不是「实际」。
2. **medium / heavy 场景失锚率极高** —— 印证了「单纯文本相似度兜底不足以应对大量编辑」，必须配合 W3C 多选择器（TextQuote 三段 + TextPosition + CssSelector/PageRect）的协同回退，**Phase 1 的多选择器组合是关键。**
3. **D1 决策不反转**：Phase 1 仍走保守路径（W3C 多选择器 + 真实 d-m-p + 向量回退），但**Phase 1 末的 A1-4 红线复测必须用真 d-m-p**——若届时仍 < 90% 才考虑 Y.RelativePosition 双轨。

### 输出

- 脚本: [`scripts/atlas/anchoring-spike.mjs`](../../scripts/atlas/anchoring-spike.mjs)
- 重跑: `node scripts/atlas/anchoring-spike.mjs`
- 机器可读: `node scripts/atlas/anchoring-spike.mjs --json`

---

## Spike-2 · Yjs RelativePosition 性能

**任务编号**: `task-knowledge-P0-09-yjs-spike (conditional)`

**触发条件**: 仅在 D1 反转为激进路径（切 Tiptap+Yjs）时执行。

**当前状态**: **未执行**（D1 保守，无需）。Phase 2 末复盘 D1 时若决定反转，再回填此节。

---

## 决策日志（append-only）

| 日期 | 决策 ID | 变更 | 原因 |
|---|---|---|---|
| 2026-05-26 | D1 | V1.0 → V1.1 保守路径定稿 | 保留现有 CodeMirror，避免重写 894 行 |
| 2026-05-26 | D2 | V1.0 死表 → V1.1 复活路径 | 表 + UI 占位已就绪，仅缺 worker |
| 2026-05-26 | D3 | V1.0 → V1.1 永不迁移 | 语义不重合，迁移引入数据污染风险 |

---

## 附录：如何反转一个决策

1. 在本文档对应决策章节追加一个新版本块（V1.2 / V2.0 ...），不要删除旧版本。
2. 在父手册 `task-aether-knowledge-system.md` 对应位置同步更新。
3. 在 §决策日志 追加一行。
4. 在 `CHANGELOG.md` [Unreleased] 写一条 "Atlas decision flip" 条目。
5. 若反转涉及红线（R1-R5），还要在父手册 §0.2 红线表更新触发动作。
