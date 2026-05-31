# Atlas User Guide

> Status: Atlas is an admin-side knowledge graph workflow. This guide describes the product paths that are available in the current implementation and calls out the pieces that still require later gate evidence.

## 1. Open The Atlas Workspace

1. Go to `/admin/atlas`.
2. Choose the data scope:
   - `仅我的`: only Atlas records owned by the current user.
   - `全部可访问`: records visible to the current user. Admin users can use this for cross-user review.
3. Use the dashboard search field to jump into `/admin/atlas/search` with a keyword filter.
4. Use the workspace entries for:
   - `搜索`: search KP, annotations, and carriers from one screen.
   - `知识点`: manage and search Knowledge Points.
   - `图谱`: inspect the graph.
   - `AI 建议`: review pending suggestions.
   - `阅读器`: start from Notes, then open a note in the Atlas Reader route.

## 2. Note To Annotation

1. Open a Markdown note in the Atlas Reader route:
   - From a note edit page, click the Atlas action in the header. Unsaved edits are saved before opening the Reader.
   - Direct route: `/admin/atlas/reader/note/<noteId>`.
2. Select text in the rendered Markdown preview.
3. Create an annotation from the selection.
4. Confirm that the annotation appears in the side list:
   - `anchored`: exact or position-based anchor is stable.
   - `soft_anchored`: text was recovered by fallback matching and should be reviewed.
   - `orphan`: the selector no longer maps to the current text; fix the source note or recreate the annotation.

Inline highlights are non-destructive. They are rendered over the Markdown preview and do not modify the note body.

## 3. PDF Carrier Ingest

The backend can now create a PDF Atlas carrier from an uploaded media file:

- Endpoint: `POST /api/v1/admin/atlas/carriers/pdf`
- Body: `{ "mediaFileId": <media file id> }`
- Access: requires `content.atlas.write`; non-admin users can only ingest their own uploaded PDF media.

The Go backend reads the media bytes from the configured storage provider and calls the internal AI service endpoint `POST /v1/atlas/pdf/extract`. The extracted page-aware root text is stored in `atlas_carrier_text_layers`, while the carrier version points at an immutable `atlas-text-layer://pdf/<mediaId>/<hash>` URI.

This is the text-layer ingest baseline. The current gateway smoke covers generated PDF upload, text-layer persistence, PDF Reader loading, page-rectangle jump-back, and non-admin Markdown Reader sessions. The R1 file-level PDF corpus gate also builds representative multi-page PDFs, extracts them through `pypdf`, and verifies recall across revision variants. Production/user PDF samples should still be rerun before release.

## 4. Annotation To Knowledge Point

1. In the Reader annotation list, click `提炼 KP`.
2. Review and edit the KP draft:
   - `title`: concise claim, concept, question, method, source, or example.
   - `body`: the supporting explanation or copied quote.
   - `type`: one of the supported KP types.
   - `status`: usually starts as `seed`.
   - `confidence`: how reliable the extracted KP is.
   - `evidence role`: choose whether the annotation is general evidence, a definition, an example, or counter-evidence.
3. Create the KP.
4. The Reader links the annotation to the new KP as evidence. Re-linking the same annotation/KP updates the evidence role instead of silently keeping the old value.

## 5. Manage Knowledge Points

Use `/admin/atlas/kps` for global KP management.

Available filters:

- Keyword: title and body Markdown.
- Type: claim, concept, question, definition, method, example, person, source.
- Status: seed, growing, evergreen, archived.
- Provenance: user, AI suggested, imported.
- Evidence: with or without linked annotation evidence.
- Scope: mine or all accessible.

Open a KP detail page to:

- Edit title, body, type, status, and confidence.
- Archive or restore the KP.
- Delete the KP with confirmation.
- Review evidence annotations and jump back to the source Reader route when the carrier maps to a note.

## 6. Search Across Atlas

Use `/admin/atlas/search` for a single keyword search across:

- KP title and body Markdown.
- Annotation body text and W3C selector text.
- Carrier title, source URI, and author.

Search respects the same Atlas scope control as the dashboard: non-admin users stay scoped to their own Atlas data, while admin users can choose all accessible records or only their own records.

This page is still the keyword-search baseline. Semantic Atlas recall is available in the AetherHub handoff when Atlas scope is selected, but `/atlas/search` does not yet rerank results with vectors or GraphRAG.

## 7. Create Relations

1. Open a KP detail page.
2. In `Relations`, choose the relation type. The UI shows a short explanation for each type:
   - `supports`, `refutes`, `specializes`, `generalizes`, `precedes`, `causes`, `similar_to`, `cites`, `instance_of`.
3. Choose the target KP.
4. Set strength.
5. Add a rationale in the body field.
6. Attach an evidence annotation from the current KP when available.
7. Create the relation.

Relation cards show direction, type, strength, rationale, and attached evidence quotes. Evidence makes a relation auditable: a relation without evidence can exist, but should be treated as less reliable until evidence is attached.

## 8. Inspect The Graph

Use `/admin/atlas/graph` for the global graph view.

The `/admin/atlas` dashboard reads live graph health from `/api/v1/admin/atlas/graph/health`. The health panel shows active KP count, relation count and density, orphan KP ratio, KP evidence coverage, relation evidence-or-rationale coverage, and top hub nodes under the selected Atlas scope.

Available controls:

- Keyword search across KP title, body, type, status, and provenance.
- Scope.
- KP type filter.
- Relation type filter.
- Hub folding for nodes with high incoming degree.

Click a node to open its KP detail page. On a KP detail page, use the local graph section to inspect depth 1, 2, or 3 neighborhoods without leaving the KP.

## 9. AI Suggestions

Use `/admin/atlas/suggestions` to review pending suggestions.

How to generate suggestions:

- From the Reader annotation list, click `AI 建议` on an annotation. Atlas sends the selected evidence text through the AI service and creates pending KP suggestions.
- From a KP detail page, select a target KP in the relation form and click the `AI` action. Atlas asks the AI service for one typed relation suggestion and places it in the Inbox.

Rules:

- AI output is a suggestion, not a committed graph fact.
- Accepting a KP suggestion creates a KP with `provenance=ai_suggested`.
- Accepting a relation suggestion creates a typed relation and links suggestion evidence when available.
- Rejecting or ignoring a suggestion prevents duplicate pending suggestions from reappearing.

The AI service now validates structured JSON output and retries once before falling back to deterministic heuristics. Migration `000072` seeds the `atlas_claims` and `atlas_relations` task types and inherits the site's default chat routing when possible. The current landing evidence includes a live R3 gate run through gateway/server-go/ai-service with explicit model `gemini-3.1-flash-lite-preview`: KP accept `100%`, relation accept `50%`, schema valid `100%`, grounded `100%`, non-stub `100%`, and token coverage `100%`. Production release still needs default Atlas routing credentials configured and a production rerun.

## 10. AetherHub Scope

Current available handoff:

1. Use Atlas search or the graph to identify relevant KP nodes.
2. Open AetherHub.
3. In the `Atlas` picker bar, add the KP nodes that should ground the next answer.
4. Ask the question.
5. AetherHub sends the selected KP ids as `atlasScope` with semantic recall enabled.
6. The AI service uses the last user message as the recall query, then merges selected KPs, active-profile semantic KP hits, relation-neighborhood rows, and evidence quotes into the conversation context.
7. New or updated KPs are indexed asynchronously after create, update, evidence link, or accepting a KP suggestion. Very recent edits may need the background indexing call to finish before they appear in semantic recall.
8. Answers should cite Atlas context with `[KP #id]` and `[Evidence #annotation_id]` markers.

This is a selected-scope semantic baseline, not full automatic GraphRAG. Empty-scope Atlas recall from arbitrary questions, search-page semantic rerank, community/global graph query, historical KP backfill, and the D2 `note_embeddings` worker remain future gates.

## 11. Release Checklist

Before treating an Atlas iteration as a passed product gate, record evidence in `.agent/plans/knowledge-atlas-phase-gate-ledger.md`:

- Backend tests for repository/service/handler paths touched by the change.
- Admin type-check and build.
- Atlas UI redline grep for native select, spinner, demo placeholder, and explicit "do not use" markers.
- R1 Markdown/version anchoring recall: `node scripts/atlas/anchoring-recall.mjs --min-recall 0.9`.
- R1 PDF text-layer anchoring recall: `node scripts/atlas/pdf-anchoring-recall.mjs --min-recall 0.9`.
- R1 real-PDF corpus gate: `node scripts/atlas/pdf-real-corpus-gate.mjs --min-recall 0.9`.
- R2 relation health fixed corpus: `node scripts/atlas/relation-health-gate.mjs`.
- R2 live non-admin dataset gate: `ATLAS_SMOKE_PASSWORD=... node scripts/atlas/run-relation-health-live-gate.mjs`.
- R3 AI quality fixed corpus: `node scripts/atlas/ai-quality-gate.mjs`.
- R3 live AI quality gate: `ATLAS_SMOKE_PASSWORD=... node scripts/atlas/run-ai-quality-live-gate.mjs`, or `ATLAS_SMOKE_PASSWORD=... ATLAS_R3_MODEL_ID=<enabled-chat-model> node scripts/atlas/run-ai-quality-live-gate.mjs` for an explicit live model probe while production default routing is not credentialed. This gate must fail if Atlas task routing has no usable credential and no explicit model is supplied, or if generated suggestions fall back to `atlas-stub/heuristic-v1`.
- R4 build-stat budget: `node scripts/atlas/performance-budget-gate.mjs --allow-missing-runtime`.
- R5 smoke report template: `node scripts/atlas/release-smoke-gate.mjs --print-template`; full release evidence requires `--input <report.json>` with all 15 checks passed, including KP archive/restore/delete lifecycle checks.
- Multi-user smoke gate: `node scripts/atlas/multiuser-smoke-gate.mjs --input <report.json>` with all 17 checks passed, including non-admin Markdown Reader sessions and cross-user Reader source denial.
- Browser smoke for dashboard, Reader, KP list/detail, Graph, and Suggestions.
- Cross-surface smoke for Notes, KnowledgeBase, Blog, and AetherHub when the change touches shared contracts.

Phase gates are stricter than MVP availability. A feature can have a usable baseline while its full product gate remains open because recall, quality, performance, or no-regression evidence is missing.
