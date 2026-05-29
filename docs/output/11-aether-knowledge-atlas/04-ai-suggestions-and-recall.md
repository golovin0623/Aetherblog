# 04 · AI Suggestions / KB Recall / Agent 注入

## 1 · 责任范围

本能力覆盖两条 AI 辅助链路:

- **KB recall:** Agent chat 根据用户选择的 `kbIds` 和最后一条 user message,从 CUSTOM KB 或 SYSTEM_POSTS 中召回片段并注入 system context。
- **Atlas suggestion inbox:** AI 或 admin demo 生成 KP/relation 候选,先落 `atlas_ai_suggestions`,用户 accept/reject 后才改变 KP/Relation 图谱。

---

## 2 · 关键代码入口

| 入口 | 责任 |
| --- | --- |
| `apps/ai-service/app/api/routes/agent.py:82-85` | Agent chat request 接收 `kbIds` |
| `apps/ai-service/app/api/routes/agent.py:545-578` | 构建 KB context,失败时 warn 并继续对话 |
| `apps/ai-service/app/api/routes/agent.py:1088-1100` | 将 KB context 与 picker_context 合并 |
| `apps/ai-service/app/services/kb_recall.py:35-85` | 多 KB 并行召回和全局排序 |
| `apps/ai-service/app/services/kb_recall.py:97-158` | CUSTOM KB 召回:kb_embeddings + kb_profiles |
| `apps/ai-service/app/services/kb_recall.py:161-242` | SYSTEM_POSTS 召回:post_embeddings + search_profiles |
| `apps/ai-service/app/api/routes/atlas.py:89-115` | heuristic claim extraction stub |
| `apps/ai-service/app/api/routes/atlas.py:153-192` | heuristic relation suggestion stub |
| `apps/server-go/internal/knowledge/service/suggestion_service.go:120-254` | suggestion accept 原子事务 |

---

## 3 · KB Recall 数据流

```
AgentChatRequest.kbIds
  -> _build_kb_context_for_chat
      1. 取最后一条 user 消息作为 query
      2. recall_kbs(pool,llm,kb_ids,query,top_k_total=12)
      3. 每个 KB 并行 recall_one
         - kind=SYSTEM_POSTS -> post_embeddings + search_profiles
         - kind=CUSTOM       -> kb_embeddings + kb_profiles
      4. 全局按 similarity 降序截断
      5. render_kb_context 生成 system message
```

CUSTOM KB 关键 SQL 约束:

- 按 `kb_id/profile_id/status='active'/embedding_dim` 过滤。
- `candidate_limit = min(max(profile.top_k * 3, 20), 100)`。
- `similarity >= profile.score_threshold` 后再按 top_k 截断。

SYSTEM_POSTS 额外过滤:

- `posts.deleted = false`
- `posts.status = 'PUBLISHED'`
- `posts.password IS NULL`
- `posts.is_hidden = false`

这修正了历史上“密码保护/隐藏文章被召回”的风险,见 `apps/ai-service/app/services/kb_recall.py:219-225`。

---

## 4 · Atlas Suggestion 数据流

### 4.1 生成候选

ai-service 当前是 stub:

```
POST /v1/atlas/claims/extract
  -> 按中文关键词切句,返回 ClaimCandidate[]

POST /v1/atlas/relations/suggest
  -> char-bigram Jaccard + 关键词,返回 relation_type/strength/rationale
```

它挂 `require_admin_or_internal`,允许管理员 JWT 或 Go 内部 token,见 `apps/ai-service/app/api/routes/atlas.py:31-39`。

### 4.2 入 inbox

```
POST /v1/admin/atlas/suggestions
  -> SuggestionHandler.Create
  -> AISuggestionService.Create
  -> SuggestionRepo.Create
  -> INSERT atlas_ai_suggestions(status=pending)
```

### 4.3 Accept 原子落地

```
POST /v1/admin/atlas/suggestions/:id/accept
  -> load suggestion
  -> validate pending/kind/type
  -> BEGIN
  -> SELECT status FOR UPDATE
  -> INSERT atlas_knowledge_points 或 atlas_typed_relations
  -> UPDATE atlas_ai_suggestions SET status='accepted', resolved_*_id=...
  -> COMMIT
```

关键防御:

- 先 `SELECT ... FOR UPDATE`,避免并发 accept 各自做完昂贵 INSERT 再回滚。
- `UPDATE ... WHERE status='pending'` 后检查 `RowsAffected`,否则并发下会留下重复 KP/Relation。
- 所有 AI 落地实体都带 `provenance='ai_suggested'` 与 `ai_suggestion_id` 回指。

### 4.4 Reject / Ignore

Reject 会把 suggestion 标为 rejected 并写 `atlas_ignored_suggestions` 指纹,避免重复打扰。指纹逻辑集中在 `suggestion_service.go`。

---

## 5 · 配置 / 环境变量

- `AI_INTERNAL_SERVICE_TOKEN`:保护 `/v1/atlas/*` 和 `/api/v1/kb/*` 内部调用。
- `ai_models` / `ai_task_routing`:未来 Atlas 真 LLM 抽取应走这些表,当前 stub 不消耗模型配额。
- `kb_profiles.model_id`:KB recall 的 embedding model 选择。

---

## 6 · 与其他模块耦合

- **Search profile:** SYSTEM_POSTS 使用当前 active search profile 的 model_id 与 post_embeddings。
- **Agent picker:** Go 侧必须先过滤 kbIds,Python 端不再做用户权限判断。
- **Atlas graph:** Suggestion accept 会写 KP/Relation,影响图谱。
- **AI usage / pricing:** 当前 Atlas stub 未记录 usage;未来真 LLM 调用必须计入成本。

---

## 7 · 已知限制 / 待改进

1. **Atlas AI 是 stub。** `atlas_health` 明确返回 `stub: true`,见 `apps/ai-service/app/api/routes/atlas.py:215-223`。
2. **KB recall 失败对用户不可见。** `_build_kb_context_for_chat` catch 后返回 None,对话正常进行但没有提示。
3. **同 profile model 的多 KB 查询没有去重 embed。** 注释说明 Phase1 简化不去重,大规模多库时可优化。
4. **SYSTEM_POSTS top_k/threshold 是硬编码。** 当前使用 top_k=6 threshold=0.20,还未暴露到 admin。

---

## 8 · 测试覆盖说明

当前测试更多覆盖 embedding 使用和 vector checkpoint,缺少:

- `filterBodyKBIDs` 的恶意 body / 未授权 id / null 空数组行为。
- `kb_recall` 的 CUSTOM/SYSTEM_POSTS 双路径。
- suggestion accept 并发事务。
- ai-service Atlas stub 的输入边界。
