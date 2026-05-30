# Atlas User Guide

> Status: Atlas is an admin-side knowledge graph workflow. This guide describes the product paths that are available in the current implementation and calls out the pieces that still require later gate evidence.

## 1. Open The Atlas Workspace

1. Go to `/admin/atlas`.
2. Choose the data scope:
   - `仅我的`: only Atlas records owned by the current user.
   - `全部可访问`: records visible to the current user. Admin users can use this for cross-user review.
3. Use the dashboard search field to jump into `/admin/atlas/kps` with a keyword filter.
4. Use the workspace entries for:
   - `知识点`: manage and search Knowledge Points.
   - `图谱`: inspect the graph.
   - `AI 建议`: review pending suggestions.
   - `阅读器`: start from Notes, then open a note in the Atlas Reader route.

## 2. Note To Annotation

1. Open a Markdown note in the Atlas Reader route: `/admin/atlas/reader/note/<noteId>`.
2. Select text in the rendered Markdown preview.
3. Create an annotation from the selection.
4. Confirm that the annotation appears in the side list:
   - `anchored`: exact or position-based anchor is stable.
   - `soft_anchored`: text was recovered by fallback matching and should be reviewed.
   - `orphan`: the selector no longer maps to the current text; fix the source note or recreate the annotation.

Inline highlights are non-destructive. They are rendered over the Markdown preview and do not modify the note body.

## 3. Annotation To Knowledge Point

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

## 4. Manage Knowledge Points

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

## 5. Create Relations

1. Open a KP detail page.
2. In `Relations`, choose the relation type. The UI shows a short explanation for each type:
   - `supports`, `refutes`, `specializes`, `generalizes`, `precedes`, `causes`, `similar_to`, `cites`, `instance_of`.
3. Choose the target KP.
4. Set strength.
5. Add a rationale in the body field.
6. Attach an evidence annotation from the current KP when available.
7. Create the relation.

Relation cards show direction, type, strength, rationale, and attached evidence quotes. Evidence makes a relation auditable: a relation without evidence can exist, but should be treated as less reliable until evidence is attached.

## 6. Inspect The Graph

Use `/admin/atlas/graph` for the global graph view.

Available controls:

- Keyword search across KP title, body, type, status, and provenance.
- Scope.
- KP type filter.
- Relation type filter.
- Hub folding for nodes with high incoming degree.

Click a node to open its KP detail page. On a KP detail page, use the local graph section to inspect depth 1, 2, or 3 neighborhoods without leaving the KP.

## 7. AI Suggestions

Use `/admin/atlas/suggestions` to review pending suggestions.

How to generate suggestions:

- From the Reader annotation list, click `AI 建议` on an annotation. Atlas sends the selected evidence text through the AI service and creates pending KP suggestions.
- From a KP detail page, select a target KP in the relation form and click the `AI` action. Atlas asks the AI service for one typed relation suggestion and places it in the Inbox.

Rules:

- AI output is a suggestion, not a committed graph fact.
- Accepting a KP suggestion creates a KP with `provenance=ai_suggested`.
- Accepting a relation suggestion creates a typed relation and links suggestion evidence when available.
- Rejecting or ignoring a suggestion prevents duplicate pending suggestions from reappearing.

The AI service now validates structured JSON output and retries once before falling back to deterministic heuristics. Do not treat suggestion quality as final model quality until the eval harness and acceptance-rate gates are complete.

## 8. AetherHub Scope

Current available handoff:

1. Use Atlas search or the graph to identify relevant KP nodes.
2. Open AetherHub.
3. In the `Atlas` picker bar, add the KP nodes that should ground the next answer.
4. Ask the question.
5. AetherHub sends the selected KP ids as `atlasScope`. The AI service injects the selected KP, one-hop relations, and evidence quotes into the conversation context.
6. Answers should cite Atlas context with `[KP #id]` and `[Evidence #annotation_id]` markers.

This is a selected-scope baseline, not full semantic GraphRAG. Automatic Atlas recall from arbitrary questions still depends on the future embedding and graph-neighborhood recall gates.

## 9. Release Checklist

Before treating an Atlas iteration as a passed product gate, record evidence in `.agent/plans/knowledge-atlas-phase-gate-ledger.md`:

- Backend tests for repository/service/handler paths touched by the change.
- Admin type-check and build.
- Atlas UI redline grep for native select, spinner, demo placeholder, and explicit "do not use" markers.
- Browser smoke for dashboard, Reader, KP list/detail, Graph, and Suggestions.
- Cross-surface smoke for Notes, KnowledgeBase, Blog, and AetherHub when the change touches shared contracts.

Phase gates are stricter than MVP availability. A feature can have a usable baseline while its full product gate remains open because recall, quality, performance, or no-regression evidence is missing.
