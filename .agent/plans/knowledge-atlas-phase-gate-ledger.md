# Knowledge Atlas Phase Gate Ledger

> Date: 2026-05-31
> Worktree: `codex/knowledge-atlas-landing`
> Source plan: `.agent/plans/knowledge-atlas-gap-analysis-iteration-review.md`

## Gate Policy

This ledger separates "MVP route exists" from "product phase gate passed". A phase is not marked passed unless the code, UI, tests, and product red lines have current evidence.

## Current Gate Status

| Gate | Status | Current evidence | Remaining work |
| --- | --- | --- | --- |
| P0-01 real Atlas dashboard | Implemented | `/atlas` now loads health, KP, pending suggestions, graph edges, health metrics, recent KP, and quick links | Browser smoke after full stack is running |
| P0-02 subpage navigation | Implemented | Dashboard quick links plus Sidebar links for `/atlas`, `/atlas/kps`, `/atlas/graph`, `/atlas/suggestions`; `/atlas/kps` route added | Reader still enters through Notes or direct note route until note detail has an "Open in Atlas Reader" action |
| P0-03 Multi-user Gate execution | Implemented for Atlas handlers and UI scope controls | Atlas routes now use RBAC read/write/admin permissions instead of legacy admin-only grouping; `AtlasScopeMiddleware` resolves `content.atlas.admin`; list/get/graph/relation/suggestion/carrier/annotation paths enforce author/owner scope; Dashboard/KP/Graph/Suggestions expose `all`/`mine` scope controls; unit tests cover non-admin author switching and admin scope modes | Full non-admin browser smoke still needs seeded users and gateway session data |
| P0-04 graph scoped edges | Implemented | `RelationRepo.ListForNodeIDs` filters `from_kp_id` and `to_kp_id` with the returned node set and optional author scope; unit tests cover empty, node-scoped, and author-scoped cases | Local graph depth and graph inspector remain Sprint 1/3 work |
| P0-05 suggestion source binding | Implemented for KP suggestions | `AISuggestionService.Create` rejects `kind=kp` without `carrierId` or `annotationId`; production demo button removed from Suggestions page | Real AI extraction still P2; relation suggestion evidence policy should be revisited with relation extraction |
| P0-06 ignored/pending suggestion dedupe | Implemented | `fingerprint` column/index migration; service checks ignored fingerprint and returns existing pending duplicate | Backfill fingerprint for old pending suggestions is not included |
| P0-07 relation evidence API | Implemented | Create relation accepts `evidenceAnnotationIds`; `POST/GET/DELETE /relations/:id/evidence` added; AI relation accept links suggestion annotation as evidence; KP detail relation form can attach current-KP evidence and relation cards show evidence quotes | Dedicated relation evidence delete UI is still future polish |
| P0-08 baseline tests/redline evidence | Implemented for Sprint 0 scope | `go test ./internal/knowledge/...`; `go test ./...`; `pnpm --filter @aetherblog/admin typecheck`; `pnpm --filter @aetherblog/admin build`; Atlas native select/spinner/demo redline grep is clean | R1/R2/R3/R4/R5 fixed corpus scripts are still future gate automation, not Sprint 0 blockers |
| P0-11 source URI uniqueness | Implemented at schema/repo level | Migration `000068` replaces global `UNIQUE(source_uri)` with live per-owner expression index; carrier source lookup/upsert is owner-scoped | Rollback can fail if per-owner duplicates are created before reverting, because the down migration restores global uniqueness |
| P0-12 phase gate ledger | Implemented | This file records evidence and remaining work | Must be updated at each Atlas sprint exit |
| P2-10 data integrity hardening | Implemented | Migration `000068` adds `proposed_kp_type` CHECK and `carrier_version_id` index; service rejects invalid `proposedKpType` | Existing invalid historical suggestions are not corrected |
| P1-01 Reader inline highlight | Implemented baseline | Markdown Reader overlays anchored/soft annotation ranges into rendered Markdown with state-colored `<mark>` nodes and keeps orphan annotations in the side list only | Fixed R1 corpus and PDF/version migration recall are still not proven |
| P1-02 annotation to KP | Implemented baseline | Markdown Reader annotation cards now open an editable KP draft for title/body/type/status/confidence/evidence role, create the KP, and link the annotation as the selected evidence role | Multi-annotation batching and browser smoke remain future improvements |
| P1-03 annotation to AI suggestion | Implemented baseline | Reader annotation cards can call `POST /atlas/annotations/:id/suggestions`; server-go validates annotation scope, calls ai-service `/v1/atlas/claims/extract` through `X-Internal-Service`, and writes pending KP suggestions into Inbox | Batch annotation extraction and model-quality evaluation remain P2 work |
| P1-04 KP list | Implemented baseline | `/atlas/kps` provides keyword/type/status/provenance/evidence filters, scope switching, health summary, and quick links to KP detail | Bulk actions remain Sprint 1+ polish |
| P1-05 KP edit/archive/delete | Implemented baseline | KP detail exposes edit modal for title/body/type/status/confidence, archive/restore, and delete confirmation wired to existing APIs with toast/error states | Restore/delete release smoke still needs authenticated browser data |
| P1-06 relation creation guide | Implemented baseline | KP detail relation form uses styled `Select`, relation explanations, target KP selection, strength, rationale/body, and current-KP evidence attachment; relation list shows rationale and evidence quotes | Target KP search is still limited to the loaded KP list, not full async search |
| P1-07 global search | Implemented baseline | Dashboard search deep-links into KP list; KP list supports backend keyword/type/status/provenance/evidence filters; Graph page can keyword-locate KP and records graph search telemetry | Embedding/semantic search is still P2-04/P2-05 |
| P1-08 control and skeleton redline | Implemented for Atlas pages touched in this sprint | Atlas dashboard, KP list/detail, graph, suggestions, and markdown reader use shared `Select`/skeleton states; redline grep has no native select/spinner/demo matches in Atlas pages | Broader admin design-system automation is not available in this worktree |
| P1-09 AetherHub Atlas scope | Implemented baseline | AetherHub can select the current user's Atlas KP, sends `atlasScope` to Agent chat, ai-service injects selected KP / one-hop relations / evidence into the system context, and answer completion records citation count | Semantic Atlas recall and broader graph neighborhood retrieval remain P2-05 |
| P1-10 user guide | Implemented baseline | `docs/atlas-user-guide.md` documents note -> annotation -> KP -> relation -> graph workflow and the AetherHub Atlas handoff | Full semantic Atlas recall remains P2-05 work |
| P1-12 analytics events | Implemented baseline | Atlas writes activity events for annotation creation, annotation->KP, suggestion accept/reject, graph search, and AetherHub Atlas answer citation counts (`atlas.*` event types under `system` category); `/atlas/events` is restricted to known telemetry event types | Metrics still need real user data and dashboard aggregation |
| G1-01 local graph | Implemented baseline | KP detail includes a depth 1/2/3 local graph view loaded from scoped relation APIs and updates when depth changes | It is an inline SVG baseline, not the later zoom/pan/minimap graph surface |
| P2-01 structured claim extraction | Implemented baseline | ai-service Atlas claim extraction now uses a LlmRouter structured JSON wrapper when Atlas task routing or an explicit model is available; pydantic validates candidate schema and retries once before heuristic fallback; unit tests cover invalid JSON repair | Real prompt/model eval, production routing seed, and acceptance-rate evidence are still open |
| P2-03 relation suggestion | Implemented baseline | KP detail can request a relation suggestion for current KP + target KP; server-go calls ai-service `/v1/atlas/relations/suggest`, validates scope, and writes a pending relation suggestion to Inbox; ai-service validates relation type against the 9-type enum and retries once | Relation evidence attachment and quality metrics remain open |

## Verification Commands

| Command | Result |
| --- | --- |
| `go test ./internal/knowledge/...` from `apps/server-go` | Passed |
| `go test ./internal/knowledge/repository ./internal/knowledge/service ./internal/knowledge/handler` from `apps/server-go` | Passed after P1 relation evidence role upsert and Atlas telemetry handler tests |
| `go test ./...` from `apps/server-go` | Passed |
| `pnpm --filter @aetherblog/admin typecheck` | Passed after `pnpm install --offline --ignore-scripts` initialized the new worktree node_modules |
| `pnpm --filter @aetherblog/admin build` | Passed; Vite emitted existing large-chunk warnings only |
| `rg -n "<select\|Loader2\|animate-spin\|P3-DEMO\|Phase 0 占位\|严禁" apps/admin/src/pages/atlas apps/admin/src/services/atlasService.ts` | No matches |
| `PYTHONPATH=. uv run pytest tests/test_atlas_routes.py -q --no-cov` from `apps/ai-service` | Passed for structured Atlas extraction/relation retry tests |
| `python -m compileall apps/ai-service/app/api/routes/atlas.py apps/ai-service/app/api/routes/agent.py` | Passed |
| Browser smoke | In-app Browser was unavailable in this environment; Playwright could load `/admin/atlas` through the Vite dev server and reached the expected login screen without a Vite overlay |

## Not Yet Passed

| Phase / Gate | Why it is not passed |
| --- | --- |
| Phase 1 R1 anchoring recall | No fixed Markdown/PDF/version migration corpus or >=90% recall script yet |
| Sprint 1 all-green | P1-01/P1-02/P1-05/P1-06/P1-07/P1-09/P1-10/P1-12/G1-01 now have implementation baselines, but authenticated browser smoke is still open |
| Phase 2 R2 relation density | Relation creation/evidence API exists, but no real dataset proving density or evidence coverage |
| Phase 3 R3 AI quality | Structured extraction/relation baseline exists, but eval harness, real model routing seed, and measured accept rate are still missing |
| R4 performance budget | No Playwright trace/build-stat/graph FPS evidence yet |
| R5 no-regression gate | Full gateway smoke across Notes/KB/Blog/AetherHub not run in this worktree |
| Full non-admin release smoke | Multi-user code paths are implemented, but release evidence still needs seeded non-admin/admin browser sessions through the gateway |
