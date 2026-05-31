# Recent Feature Audit - 2026-05-29

## Scope

- Window: 2026-05-15 00:00 to 2026-05-29 23:59, Asia/Shanghai.
- Baseline: latest `origin/main` at `28602f27`.
- Evidence collected:
  - 121 non-merge commits.
  - Non-merge numstat: `add=49778 del=8279 net=41499`.
  - Highest-touch areas: `apps/server-go`, `apps/admin`, `apps/ai-service`, `apps/blog`.

## Feature Clusters Reviewed

- Media upload/compression, backup verification, storage provider listing, and sync robustness.
- Access sharing, comment review, system/security admin surfaces.
- Admin intelligence UI unification, mobile navigation, pagination, and common table/list controls.
- Timeline/theme/avatar/favicon/public search UX fixes.
- Search profile reindex/resume, AI QA routing, embedding usage accounting.
- Intelligent notes and editor surface alignment.
- Knowledge Base / RAG: custom KB files, SYSTEM_POSTS, profile migration, Lingjing `kbIds` recall.
- Atlas knowledge system: carriers, annotations, knowledge points, typed relations, AI suggestions.
- Migration and deploy recovery around KB migration renumbering and `v57 dirty`.
- AI pricing sync from LiteLLM catalog.

## Adopted Findings

### 1. Search and KB vectors could silently mix embedding models

Severity: High.

The profile-aware indexing path used `profile.model_id`, but semantic search and some reindex/chunk paths could fall back to the global `ai_task_routing.embedding` route if the explicit profile model could not be resolved. That creates two bad states:

- Query vector from model B against an index written by model A, causing stable empty/low-quality recall.
- New chunks inside the same profile written with a fallback model, mixing dimensions or semantic spaces.

Fix:

- Added `strict_embedding_model_id` to `LlmRouter.embed()`.
- Search profile, KB index, KB recall, active reindex, and shadow reindex now fail closed when the configured profile model cannot be resolved.
- Usage logging for semantic search/reindex now records the active or target profile model instead of the stale global embedding route.

### 2. KB and Atlas keyword filters treated `%` / `_` as user-controlled wildcards

Severity: Medium.

`listPostsAsKBFiles` and Atlas `KPRepo.List` accepted user keywords into ILIKE patterns without escaping. The queries were parameterized, so this was not SQL injection, but it was wildcard injection: a keyword such as `%` or `_` could broaden result sets and add unnecessary DB load.

Fix:

- Applied `dbutil.EscapeLike` to both code paths.
- Added sqlmock regression tests to assert escaped arguments.

### 3. Public article search under-served natural-language and taxonomy queries

Severity: Medium.

The public `SearchPublished` query mainly searched the full phrase against title/summary/body and PostgreSQL full text. It did not search category/tag names, and natural-language queries like `Docker怎么使用?` were unlikely to match articles whose title/body contained `Docker` and `使用` separately.

Fix:

- Split mixed ASCII/CJK natural-language queries into bounded search terms.
- Added derived Chinese question terms such as `使用` from `怎么使用`.
- Added category and tag fallbacks.
- Capped the FTS score and boosted structured matches so repeated body matches do not outrank title/category/tag matches.
- Escaped LIKE patterns explicitly for phrase and term fallbacks.

## Watchlist / Recommendations

- Do not merge stale work based on old hotfix branches without rebasing to latest `origin/main`. The local dirty worktree based on `a222c7e7` would remove recently merged pricing, avatar, and migration repair work if pushed directly.
- Preserve the AetherHub KB picker and `kbIds` request path. Removing it breaks the recently added Lingjing RAG capability even though backend filtering still exists.
- Migration files that have already deployed must be treated as immutable by default. Latest `main` has the safer `v57` replay guard and `000067` idempotent repair; avoid replacing it with earlier unconditional self-heal logic.
- The open wildcard-injection PRs `#723`, `#732`, and `#735` overlap with the consolidated escaping fix in this branch. After this PR lands, those should be closed as duplicate or rebased only if they still cover distinct paths.
- Large UI rewrites such as the public search panel and AetherHub composer should require desktop/mobile screenshots and keyboard-flow checks before merge. The current audit intentionally avoided carrying a stale broad UI rewrite into this PR.

## Validation

- `cd apps/server-go && go test ./internal/repository ./internal/knowledge/repository ./internal/service`
- `cd apps/server-go && go test ./...`
- `cd apps/server-go && go build ./...`
- `cd apps/ai-service && PYTHONPATH=. uv run --python 3.12 pytest --no-cov tests/test_llm_router_embedding_usage.py tests/test_vector_store_chunk_checkpoint.py tests/test_search_reindex_route.py`
- `cd apps/ai-service && uv run --python 3.12 ruff check app tests/test_llm_router_embedding_usage.py tests/test_vector_store_chunk_checkpoint.py`
- `git diff --check`

Note: running the two focused AI pytest files without `--no-cov` passes all 8 tests but exits non-zero because the project-level pytest config enforces 80% total coverage across the entire app even for a narrow subset.
