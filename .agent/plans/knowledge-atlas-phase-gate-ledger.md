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
| P0-07 relation evidence API | Implemented | Create relation accepts `evidenceAnnotationIds`; `POST/GET/DELETE /relations/:id/evidence` added; AI relation accept links suggestion annotation as evidence | Frontend relation inspector/evidence display is not built yet |
| P0-08 baseline tests/redline evidence | Implemented for Sprint 0 scope | `go test ./internal/knowledge/...`; `go test ./...`; `pnpm --filter @aetherblog/admin typecheck`; `pnpm --filter @aetherblog/admin build`; Atlas native select/spinner/demo redline grep is clean | R1/R2/R3/R4/R5 fixed corpus scripts are still future gate automation, not Sprint 0 blockers |
| P0-11 source URI uniqueness | Implemented at schema/repo level | Migration `000068` replaces global `UNIQUE(source_uri)` with live per-owner expression index; carrier source lookup/upsert is owner-scoped | Rollback can fail if per-owner duplicates are created before reverting, because the down migration restores global uniqueness |
| P0-12 phase gate ledger | Implemented | This file records evidence and remaining work | Must be updated at each Atlas sprint exit |
| P2-10 data integrity hardening | Implemented | Migration `000068` adds `proposed_kp_type` CHECK and `carrier_version_id` index; service rejects invalid `proposedKpType` | Existing invalid historical suggestions are not corrected |
| P1-02 annotation to KP | Minimal implementation | Markdown Reader annotation cards now expose "提炼 KP" and create a `claim` KP with the annotation as evidence | Needs editable create form for title/body/type/status/confidence before this gate is fully passed |
| P1-04 KP list | Implemented baseline | `/atlas/kps` provides keyword/type/status filters, scope switching, health summary, and quick links to KP detail | Evidence-health/bulk actions remain Sprint 1 enhancements |
| P1-08 control and skeleton redline | Implemented for Atlas pages touched in this sprint | Atlas dashboard, KP list/detail, graph, suggestions, and markdown reader use shared `Select`/skeleton states; redline grep has no native select/spinner/demo matches in Atlas pages | Broader admin design-system automation is not available in this worktree |

## Verification Commands

| Command | Result |
| --- | --- |
| `go test ./internal/knowledge/...` from `apps/server-go` | Passed |
| `go test ./...` from `apps/server-go` | Passed |
| `pnpm --filter @aetherblog/admin typecheck` | Passed after `pnpm install --offline --ignore-scripts` initialized the new worktree node_modules |
| `pnpm --filter @aetherblog/admin build` | Passed; Vite emitted existing large-chunk warnings only |
| `rg -n "<select\|Loader2\|animate-spin\|P3-DEMO\|Phase 0 占位\|严禁" apps/admin/src/pages/atlas apps/admin/src/services/atlasService.ts` | No matches |
| Browser smoke | In-app Browser was unavailable in this environment; Playwright could load `/admin/atlas` through the Vite dev server and reached the expected login screen without a Vite overlay |

## Not Yet Passed

| Phase / Gate | Why it is not passed |
| --- | --- |
| Phase 1 R1 anchoring recall | No fixed Markdown/PDF/version migration corpus or >=90% recall script yet |
| Phase 2 R2 relation density | Relation creation/evidence API exists, but no real dataset proving density or evidence coverage |
| Phase 3 R3 AI quality | Suggestions still depend on future LiteLLM structured extraction and eval harness |
| R4 performance budget | No Playwright trace/build-stat/graph FPS evidence yet |
| R5 no-regression gate | Full gateway smoke across Notes/KB/Blog/AetherHub not run in this worktree |
| Full non-admin release smoke | Multi-user code paths are implemented, but release evidence still needs seeded non-admin/admin browser sessions through the gateway |
