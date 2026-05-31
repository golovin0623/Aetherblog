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

PDF files can also enter Atlas from the media library detail panel:

- `加入 Atlas` creates or reuses the PDF carrier for the uploaded media file.
- `查看标注` opens the PDF Reader for that carrier.
- `抽取知识点` previews the carrier-level AI run cost and then creates pending KP suggestions in the Atlas Inbox when the run stays within budget.

Video and audio files can enter Atlas through a manual transcript baseline from the media detail panel:

- Paste a transcript into the `Atlas Transcript` panel. Timestamp markers such as `[00:12]` or `[01:02:03]` are preserved as the primary text layer.
- `保存转录` creates or updates a `video` or `audio` carrier for the uploaded media file.
- `查看转录` opens `/admin/atlas/reader/transcript/<carrierId>`, where transcript text can be annotated and evidence links can jump back to the media URL with a `#t=<seconds>` fragment when a nearby timestamp is present.
- `抽取知识点` uses the same carrier-level cost preview and pending KP suggestion pipeline as PDF, Markdown, Web, and Blog Post carriers.

This media-library path currently covers uploaded PDF files plus manually supplied video/audio transcripts. Automatic speech-to-text ingestion, image-specific extraction, and richer batch media workflows remain later multimodal work.

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

The `语义重排` switch is enabled by default. When it is on, `/atlas/search` still returns keyword KP/Annotation/Carrier matches, and the backend additionally calls the same active-profile Atlas semantic recall path used by AetherHub. Semantic KP hits are hydrated through the Go backend scope checks, ranked ahead of keyword-only KP hits, and marked with source and score chips. If ai-service recall is unavailable, the page keeps the keyword results and shows a degradation banner instead of failing the whole search.

This is a search-page semantic rerank baseline, not full GraphRAG/community/global query ranking. Production recall completeness still depends on running the KP/note embedding backfill command after deployment.

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
- Updated-time window filter.
- Provenance and confidence filters.
- Evidence health filters for KPs and relations.
- Topology filters for orphan and hub KPs.
- Hub folding for nodes with high incoming degree.
- `保存过滤` stores the current keyword/type/relation/time/provenance/confidence/evidence/topology/hub-folding filter set as a named preset for the current graph scope. Use the preset menu to apply it later, or `删除预设` to remove it.
- Zoom controls, mouse-wheel zoom, drag panning, and reset view.
- The minimap in the lower-right corner shows the current viewport and can jump to a graph region.
- `保存布局` persists the current visible node positions plus zoom/pan viewport for the selected graph scope; `重置布局` clears that saved state.

Click a KP or relation to open the inspector. The inspector shows metadata, evidence counts, graph degree, relation endpoints, rationale/body preview, and the first accessible evidence quote with carrier and annotation source under the current Atlas scope. Use the node and relation navigation actions when you need to inspect the full KP detail; multi-evidence browsing and direct Reader jumps remain later graph polish.

Click a node or relation to inspect metadata, evidence counts, degree, relation summary, and navigation actions without leaving the graph. Open a KP from the inspector when you need the full detail page. On a KP detail page, use the local graph section to inspect depth 1, 2, or 3 neighborhoods without leaving the KP.

## 9. AI Suggestions

Use `/admin/atlas/suggestions` to review pending suggestions.

How to generate suggestions:

- From a Markdown or PDF Reader header, click `全文 AI 建议`. Atlas first previews the run cost against the per-run budget, then sends a bounded slice of the current carrier root text through the AI service and creates carrier-bound pending KP suggestions in the Inbox. If the estimate exceeds the threshold, generation is cancelled before any suggestion is created.
- From a PDF media detail panel, click `抽取知识点`. The media action first ensures the uploaded PDF has an Atlas carrier, then uses the same preflight budget and carrier-level suggestion pipeline as the PDF Reader.
- From a video or audio media detail panel, paste a transcript and click `抽取知识点`. The media action first saves or reuses the transcript carrier, then runs the same preflight budget and carrier-level suggestion pipeline.
- From the AI Writing workspace for an existing post, open the Atlas Reader action to annotate the saved post text layer, or click the Atlas suggestion action to wrap the draft/published post as a `blog_post` carrier, preview the run cost, and create pending KP suggestions.
- From the Reader annotation list, click `AI 建议` on an annotation. Atlas sends the selected evidence text through the AI service and creates pending KP suggestions.
- From a KP detail page, select a target KP in the relation form and click the `AI` action. Atlas asks the AI service for one typed relation suggestion and places it in the Inbox.

Rules:

- AI output is a suggestion, not a committed graph fact.
- Accepting a KP suggestion creates a KP with `provenance=ai_suggested`.
- Accepting a relation suggestion creates a typed relation and links suggestion evidence when available.
- Rejecting or ignoring a suggestion prevents duplicate pending suggestions from reappearing.

The AI service now validates structured JSON output and retries once before falling back to deterministic heuristics. Migration `000072` seeds the `atlas_claims` and `atlas_relations` task types and inherits the site's default chat routing when possible. The current landing evidence includes a live R3 gate run through gateway/server-go/ai-service with explicit model `gemini-3.1-flash-lite-preview`: KP accept `100%`, relation accept `50%`, schema valid `100%`, grounded `100%`, non-stub `100%`, and token coverage `100%`. Production release still needs default Atlas routing credentials configured and a production rerun.

Carrier-level extraction is currently a synchronous bounded baseline for Reader and writing-workspace usage. It includes a preflight token/cost estimate, pricing-missing warning, and per-run `maxCostUsd` threshold guard. Blog-post carriers use `posts://{id}` source URIs and require migration `000075` so the database CHECK constraint accepts `blog_post` carrier rows. The AI Writing workspace can open `/admin/atlas/reader/blog-post/:carrierId`, where the saved article text layer can be highlighted, deleted, and used for annotation-level or full-text AI suggestions. Web clip carriers are available through `POST /atlas/carriers/web`: the caller supplies `sourceUrl`, title, and Markdown body text, and Atlas stores a scoped `web` carrier plus a reusable text layer. The admin Atlas dashboard can save a Web snapshot and opens `/admin/atlas/reader/web/:carrierId`, where the saved text layer can be highlighted, deleted, and used for annotation-level or full-text AI suggestions. Browser capture UI and Readability extraction remain later work. Large async batch jobs, progress reporting, persistent user-configurable budgets, and batch-job cost rollups remain later P2-02/P2-08 work.

## 10. AetherHub Scope

Current available handoff:

1. Open AetherHub.
2. Ask directly to let Atlas perform empty-scope semantic recall from the last user message, or use Atlas search/graph to identify relevant KP nodes first.
3. In the `Atlas` picker bar, optionally add the KP nodes that should seed the next answer.
4. Ask the question.
5. AetherHub sends `atlasScope` with semantic recall enabled. When KP nodes are selected it sends their ids; when none are selected it sends an empty `kpIds` scope for automatic query recall.
6. The AI service uses the last user message as the recall query, then merges selected KPs, active-profile semantic KP hits, Markdown carrier note chunks, relation-neighborhood rows, and evidence quotes into the conversation context.
7. New or updated KPs are indexed asynchronously after create, update, evidence link, or accepting a KP suggestion. Very recent edits may need the background indexing call to finish before they appear in semantic recall.
8. Notes are indexed asynchronously after create, full save, duplicate, and title/summary edits. Markdown carriers backed by `notes://{id}` can contribute `[Note #id chunk n]` context after this worker finishes.
9. Answers should cite Atlas context with `[KP #id]`, `[Evidence #annotation_id]`, and `[Note #id chunk n]` markers where relevant.

Historical KP/note rows can be backfilled through ai-service internal endpoints with:

```bash
AI_INTERNAL_SERVICE_TOKEN=... node scripts/atlas/reindex-embeddings.mjs --kind all --limit 100 --batches 20
```

This is an automatic semantic recall baseline, not full GraphRAG. The admin search page now has a semantic rerank baseline, while community/global graph query and production evidence from running the KP/note embedding backfill command remain future gates.

## 11. AI Writing Workspace

In `/admin/posts/ai-writing/:id`, the Atlas reference action searches the current user's Atlas KP set with a bounded query built from the current title, summary, and body. The panel lists related KPs, semantic scores when available, and the first accessible evidence quote for each KP when the KP has linked evidence.

Use `链接` to add an internal Markdown link like `Atlas KP #42` to the current cursor position. Use `证据` to insert a public-safe blockquote citation containing the evidence quote, source carrier title, KP id, and evidence annotation id without linking readers into `/admin`. Richer writing-agent synthesis remains later work.

## 12. Release Checklist

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
