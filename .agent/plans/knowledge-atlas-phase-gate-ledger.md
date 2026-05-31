# Knowledge Atlas Phase Gate Ledger

> Date: 2026-05-31
> Worktree: `codex/knowledge-atlas-landing`
> Source plan: `.agent/plans/knowledge-atlas-gap-analysis-iteration-review.md`

## Gate Policy

This ledger separates "MVP route exists" from "product phase gate passed". A phase is not marked passed unless the code, UI, tests, and product red lines have current evidence.

## Current Gate Status

| Gate | Status | Current evidence | Remaining work |
| --- | --- | --- | --- |
| P0-01 real Atlas dashboard | Implemented | `/atlas` now loads health, KP, pending suggestions, live graph health metrics, recent KP, and quick links | Browser smoke after full stack is running |
| P0-02 subpage navigation | Implemented | Dashboard quick links plus Sidebar links for `/atlas`, `/atlas/search`, `/atlas/kps`, `/atlas/graph`, `/atlas/suggestions`; `/atlas/kps` and `/atlas/search` routes added; Note edit header has an Atlas action that saves dirty content before opening `/atlas/reader/note/:noteId` | Authenticated browser smoke still needed for the Notes -> Atlas Reader click path |
| P0-03 Multi-user Gate execution | Implemented for Atlas handlers and UI scope controls | Atlas routes now use RBAC read/write/admin permissions instead of legacy admin-only grouping; `AtlasScopeMiddleware` resolves `content.atlas.admin`; list/get/graph/relation/suggestion/carrier/annotation paths enforce author/owner scope; Dashboard/KP/Graph/Suggestions expose `all`/`mine` scope controls; unit tests cover non-admin author switching and admin scope modes | Full non-admin browser smoke still needs seeded users and gateway session data |
| P0-04 graph scoped edges | Implemented | `RelationRepo.ListForNodeIDs` filters `from_kp_id` and `to_kp_id` with the returned node set and optional author scope; unit tests cover empty, node-scoped, and author-scoped cases | Local graph depth and graph inspector remain Sprint 1/3 work |
| P0-05 suggestion source binding | Implemented for KP suggestions | `AISuggestionService.Create` rejects `kind=kp` without `carrierId` or `annotationId`; production demo button removed from Suggestions page | Real AI extraction still P2; relation suggestion evidence policy should be revisited with relation extraction |
| P0-06 ignored/pending suggestion dedupe | Implemented | `fingerprint` column/index migration; service checks ignored fingerprint and returns existing pending duplicate | Backfill fingerprint for old pending suggestions is not included |
| P0-07 relation evidence API | Implemented | Create relation accepts `evidenceAnnotationIds`; `POST/GET/DELETE /relations/:id/evidence` added; AI relation accept links suggestion annotation as evidence; KP detail relation form can attach current-KP evidence and relation cards show evidence quotes | Dedicated relation evidence delete UI is still future polish |
| P0-08 baseline tests/redline evidence | Implemented for Sprint 0 scope | `go test ./internal/knowledge/...`; `go test ./...`; `pnpm --filter @aetherblog/admin typecheck`; `pnpm --filter @aetherblog/admin build`; Atlas native select/spinner/demo redline grep is clean; R1/R2/R3/R4/R5 gate scripts now provide repeatable command evidence or report templates | Full authenticated gateway smoke and live dataset metrics remain separate release evidence |
| P0-11 source URI uniqueness | Implemented at schema/repo level | Migration `000068` replaces global `UNIQUE(source_uri)` with live per-owner expression index; carrier source lookup/upsert is owner-scoped | Rollback can fail if per-owner duplicates are created before reverting, because the down migration restores global uniqueness |
| P0-12 phase gate ledger | Implemented | This file records evidence and remaining work | Must be updated at each Atlas sprint exit |
| P2-10 data integrity hardening | Implemented | Migration `000068` adds `proposed_kp_type` CHECK and `carrier_version_id` index; service rejects invalid `proposedKpType` | Existing invalid historical suggestions are not corrected |
| P1-01 Reader inline highlight | Implemented baseline | Markdown Reader overlays anchored/soft annotation ranges into rendered Markdown with state-colored `<mark>` nodes and keeps orphan annotations in the side list only; `scripts/atlas/anchoring-recall.mjs --min-recall 0.9` proves 23/23 Markdown version-migration anchorable cases recalled and 1/1 deliberate orphan retained; `scripts/atlas/pdf-anchoring-recall.mjs --min-recall 0.9` proves 23/23 PDF text-layer version-migration anchorable cases recalled and 1/1 deliberate orphan retained; PDF media carrier ingest now calls ai-service `POST /v1/atlas/pdf/extract`, persists extracted rootText in `atlas_carrier_text_layers`, stores the immutable `atlas-text-layer://pdf/...` URI in carrier versions, and PDF Reader now reads the persisted text layer, creates TextQuote/TextPosition/PageRect selectors, overlays page rects, and jumps back to `page+rect` from annotation evidence links | Real PDF file authenticated browser smoke remains open |
| P1-02 annotation to KP | Implemented baseline | Markdown Reader annotation cards now open an editable KP draft for title/body/type/status/confidence/evidence role, create the KP, and link the annotation as the selected evidence role | Multi-annotation batching and browser smoke remain future improvements |
| P1-03 annotation to AI suggestion | Implemented baseline | Reader annotation cards can call `POST /atlas/annotations/:id/suggestions`; server-go validates annotation scope, calls ai-service `/v1/atlas/claims/extract` through `X-Internal-Service`, and writes pending KP suggestions into Inbox | Batch annotation extraction and model-quality evaluation remain P2 work |
| P1-04 KP list | Implemented baseline | `/atlas/kps` provides keyword/type/status/provenance/evidence filters, scope switching, health summary, and quick links to KP detail | Bulk actions remain Sprint 1+ polish |
| P1-05 KP edit/archive/delete | Implemented baseline | KP detail exposes edit modal for title/body/type/status/confidence, archive/restore, and delete confirmation wired to existing APIs with toast/error states | Restore/delete release smoke still needs authenticated browser data |
| P1-06 relation creation guide | Implemented baseline | KP detail relation form uses styled `Select`, relation explanations, target KP selection, strength, rationale/body, and current-KP evidence attachment; relation list shows rationale and evidence quotes | Target KP search is still limited to the loaded KP list, not full async search |
| P1-07 global search | Implemented baseline | Dashboard search deep-links into `/atlas/search`; `GET /atlas/search` aggregates KP title/body, Annotation body/selectors, and Carrier title/source/author with Atlas scope enforcement; KP list still supports backend keyword/type/status/provenance/evidence filters; Graph page can keyword-locate KP and records graph search telemetry | Embedding/semantic search is still P2-04/P2-05 |
| P1-08 control and skeleton redline | Implemented for Atlas pages touched in this sprint | Atlas dashboard, KP list/detail, graph, suggestions, and markdown reader use shared `Select`/skeleton states; redline grep has no native select/spinner/demo matches in Atlas pages | Broader admin design-system automation is not available in this worktree |
| P1-09 AetherHub Atlas scope | Implemented baseline | AetherHub can select the current user's Atlas KP, sends `atlasScope` to Agent chat, ai-service injects selected KP / one-hop relations / evidence into the system context, and answer completion records citation count | Semantic Atlas recall and broader graph neighborhood retrieval remain P2-05 |
| P1-10 user guide | Implemented baseline | `docs/atlas-user-guide.md` documents note -> annotation -> KP -> relation -> graph workflow and the AetherHub Atlas handoff | Full semantic Atlas recall remains P2-05 work |
| P1-12 analytics events | Implemented baseline | Atlas writes activity events for annotation creation, annotation->KP, suggestion accept/reject, Atlas search, graph search, and AetherHub Atlas answer citation counts (`atlas.*` event types under `system` category); `/atlas/events` is restricted to known telemetry event types | Metrics still need real user data and dashboard aggregation |
| R2-01 relation health gate | Implemented fixed-corpus/JSON/DB evaluator plus live scoped API baseline | `scripts/atlas/relation-health-gate.mjs` measures active KP count, typed relation density, KP evidence coverage, relation evidence-or-rationale coverage, orphan ratio, invalid edge references, and relation type validity; fixed corpus passes density `2.00`, KP evidence `100%`, relation evidence/rationale `100%`; `GET /atlas/graph/health` computes the same core density/evidence/orphan/hub metrics against the scoped live DB dataset and the dashboard reads it | Production/user dataset proof with recorded threshold output is still required before declaring the product R2 gate passed |
| G1-01 local graph | Implemented baseline | KP detail includes a depth 1/2/3 local graph view loaded from scoped relation APIs and updates when depth changes | It is an inline SVG baseline, not the later zoom/pan/minimap graph surface |
| G1-06 graph health metrics | Implemented live API/dashboard baseline | `GET /atlas/graph/health` returns active KP count, relation count/density, orphan KP count/ratio, KP evidence coverage, relation evidence-or-rationale coverage, missing evidence counts, AI KP count, and top hubs under the same Atlas author scope as `/graph`; `/atlas` dashboard no longer derives health from a limited graph payload | Needs seeded production/user dataset capture and threshold report before it can close the R2 live-evidence gap |
| P2-01 structured claim extraction | Implemented baseline | ai-service Atlas claim extraction now uses a LlmRouter structured JSON wrapper when Atlas task routing or an explicit model is available; pydantic validates candidate schema and retries once before heuristic fallback; unit tests cover invalid JSON repair | Real prompt/model eval, production routing seed, and acceptance-rate evidence are still open |
| P2-03 relation suggestion | Implemented baseline | KP detail can request a relation suggestion for current KP + target KP; server-go calls ai-service `/v1/atlas/relations/suggest`, validates scope, and writes a pending relation suggestion to Inbox; ai-service validates relation type against the 9-type enum and retries once | Relation evidence attachment and quality metrics remain open |
| P2-07 AI quality gate | Implemented fixed-corpus/JSON/DB evaluator baseline | `scripts/atlas/ai-quality-gate.mjs` measures final KP/relation suggestion acceptance, schema validity, and grounding; fixed corpus passes KP accept `62.50%`, relation accept `50.00%`, schema `100%`, grounding `100%` | Real model eval dataset, prompt comparison, and real user accept-rate evidence remain open |
| R4-01 performance budget gate | Implemented build-stat baseline | `scripts/atlas/performance-budget-gate.mjs --allow-missing-runtime` checks Atlas route chunk size and largest JS asset from `apps/admin/dist`; current build evidence passes Atlas JS `213.3KiB` and largest JS `1.38MiB` | Runtime LCP and graph FPS measurements are skipped unless supplied and remain required for full R4 |
| R5-01 release smoke report gate | Implemented report verifier template | `scripts/atlas/release-smoke-gate.mjs --print-template` emits the required gateway smoke matrix covering Admin, Atlas, Notes, KnowledgeBase, AetherHub, and Blog | Full gateway smoke report has not been executed; `--input` report with all checks passed is still required |
| P3-06 search page | Implemented baseline | `/atlas/search` provides a scoped keyword search UI over KP, Annotation, and Carrier results; backend escapes LIKE wildcards and caps per-kind results | Semantic recall/rerank and GraphRAG search ranking remain P3-05/P3-07 work |

## Verification Commands

| Command | Result |
| --- | --- |
| `go test ./internal/knowledge/repository -run TestRelationRepoGraphHealthComputesLiveMetrics -count=1` from `apps/server-go` | Passed after adding live graph health aggregation coverage |
| `go test ./internal/knowledge/repository -run TestCarrierRepoFindTextLayerByCarrierAndHash -count=1` from `apps/server-go` | Passed after adding the current-hash PDF text-layer read path |
| `go test ./internal/knowledge/...` from `apps/server-go` | Passed after adding `GET /atlas/carriers/:id/text-layer` and PDF Reader support |
| `go test ./...` from `apps/server-go` | Passed after PDF text-layer read/jump-back support |
| `pnpm --filter @aetherblog/admin typecheck` | Passed after PDF Reader route, service types, and media/KP/search entrypoints |
| `pnpm --filter @aetherblog/admin build` | Passed after PDF Reader route; Vite emitted existing large-chunk warnings only |
| `git diff --check` | Passed after PDF text-layer read/jump-back support |
| `go test ./internal/knowledge/...` from `apps/server-go` | Passed after adding `GET /atlas/graph/health` |
| `pnpm --filter @aetherblog/admin typecheck` | Passed after dashboard graph health API integration |
| `go test ./...` from `apps/server-go` | Passed after live graph health metrics |
| `pnpm --filter @aetherblog/admin build` | Passed after dashboard graph health API integration; Vite emitted existing large-chunk warnings only |
| `node scripts/atlas/relation-health-gate.mjs` | Passed fixed corpus after live graph health API; density `2.00`, KP evidence `100%`, relation evidence/rationale `100%` |
| `go test ./internal/knowledge/...` from `apps/server-go` | Passed after Atlas search repository coverage |
| `go test ./internal/knowledge/repository ./internal/knowledge/service ./internal/knowledge/handler` from `apps/server-go` | Passed after P1 relation evidence role upsert and Atlas telemetry handler tests |
| `go test ./...` from `apps/server-go` | Passed |
| `pnpm --filter @aetherblog/admin typecheck` | Passed after `pnpm install --offline --ignore-scripts` initialized the new worktree node_modules |
| `pnpm --filter @aetherblog/admin build` | Passed; Vite emitted existing large-chunk warnings only |
| `rg -n "<select\|Loader2\|animate-spin\|P3-DEMO\|Phase 0 占位\|严禁" apps/admin/src/pages/atlas apps/admin/src/services/atlasService.ts apps/admin/src/components/layout/Sidebar.tsx` | No matches |
| `rg -n "<select\|P3-DEMO\|Phase 0 占位\|严禁" apps/admin/src/pages/notes/CreateNotePage.tsx apps/admin/src/pages/atlas apps/admin/src/services/atlasService.ts apps/admin/src/components/layout/Sidebar.tsx` | No matches after replacing the Note folder dropdown with shared `Select` |
| `PYTHONPATH=. uv run pytest tests/test_atlas_routes.py -q --no-cov` from `apps/ai-service` | Passed for structured Atlas extraction/relation retry tests |
| `python -m compileall apps/ai-service/app/api/routes/atlas.py apps/ai-service/app/api/routes/agent.py` | Passed |
| `node scripts/atlas/anchoring-recall.mjs --min-recall 0.9` | Passed; 23/23 Markdown version-migration anchorable cases recalled, 1/1 deliberate orphan matched |
| `go test ./internal/knowledge/service -run TestRelocateMarkdownRecallCorpus -v` from `apps/server-go` | Passed |
| `node scripts/atlas/pdf-anchoring-recall.mjs --min-recall 0.9` | Passed; 23/23 PDF text-layer version-migration anchorable cases recalled, 1/1 deliberate orphan matched |
| `node scripts/atlas/pdf-anchoring-recall.mjs --min-recall 0.9 --json` | Passed and emitted machine-readable PDF text-layer R1 metrics |
| `go test ./internal/knowledge/service -run 'TestRelocate(Markdown\|PDFTextLayer)RecallCorpus' -v` from `apps/server-go` | Passed both Markdown and PDF text-layer relocation recall corpora |
| `go test ./internal/knowledge/service ./internal/knowledge/repository ./internal/server` from `apps/server-go` | Passed after PDF carrier text-layer persistence and AI extractor tests |
| `go test ./...` from `apps/server-go` | Passed after PDF carrier wiring |
| `PYTHONPATH=. .venv/bin/pytest tests/test_atlas_routes.py -q --no-cov` from `apps/ai-service` | Passed 4 Atlas route tests, including PDF text-layer page offsets and invalid base64 rejection |
| `node scripts/atlas/relation-health-gate.mjs` | Passed fixed corpus; density `2.00`, KP evidence `100%`, relation evidence/rationale `100%` |
| `node scripts/atlas/relation-health-gate.mjs --json` | Passed and emitted machine-readable R2 metrics |
| `node scripts/atlas/ai-quality-gate.mjs` | Passed fixed corpus; KP accept `62.50%`, relation accept `50.00%`, schema valid `100%`, grounded `100%` |
| `node scripts/atlas/ai-quality-gate.mjs --json` | Passed and emitted machine-readable R3 metrics |
| `node scripts/atlas/performance-budget-gate.mjs --allow-missing-runtime` | Passed build-stat budget; Atlas JS `213.3KiB`, largest JS asset `1.38MiB`; runtime metrics intentionally skipped |
| `node scripts/atlas/performance-budget-gate.mjs --allow-missing-runtime --json` | Passed and emitted machine-readable R4 build budget metrics |
| `node scripts/atlas/release-smoke-gate.mjs --print-template` | Passed template generation for the required R5 smoke matrix |
| `git diff --check` | Passed |
| Browser smoke | In-app Browser was unavailable in this environment; Playwright could load `/admin/atlas` through the Vite dev server and reached the expected login screen without a Vite overlay |

## Not Yet Passed

| Phase / Gate | Why it is not passed |
| --- | --- |
| Phase 1 R1 anchoring recall | Markdown and PDF text-layer version-migration corpora now have repeatable >=90% evidence, PDF media ingest has an internal pypdf extraction + persisted rootText path, and the admin PDF Reader has a PageRect jump-back baseline; full real-file authenticated browser R1 release evidence is still missing |
| Sprint 1 all-green | P1-01/P1-02/P1-05/P1-06/P1-07/P1-09/P1-10/P1-12/G1-01 now have implementation baselines, but authenticated browser smoke is still open |
| Phase 2 R2 relation density | Fixed-corpus/JSON/DB gate passes and live scoped graph health metrics are now exposed in API/dashboard, but no production/user dataset run has proven density or evidence coverage thresholds yet |
| Phase 3 R3 AI quality | Fixed-corpus/JSON/DB quality gate exists and the fixed corpus passes, but real model routing seed data, prompt/model eval comparisons, and measured user accept rate are still missing |
| R4 performance budget | Build-stat budget evidence exists for Atlas route chunks, but Playwright LCP and graph FPS runtime evidence are still missing |
| R5 no-regression gate | Smoke report verifier/template exists, but full gateway smoke across Notes/KB/Blog/AetherHub has not been run in this worktree |
| Full non-admin release smoke | Multi-user code paths are implemented, but release evidence still needs seeded non-admin/admin browser sessions through the gateway |
