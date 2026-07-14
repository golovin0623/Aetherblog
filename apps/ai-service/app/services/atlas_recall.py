"""Atlas semantic recall and graph-neighborhood context assembly.

This service intentionally reuses the existing search profile abstraction used
by blog search and KB recall. Knowledge Atlas does not need a second embedding
configuration surface for the first semantic-recall slice; it needs the same
active profile, pgvector cast rules, and explicit user scoping.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from app.core.config import get_settings
from app.services.llm_router import LlmRouter
from app.services.vector_store import SearchProfile, VectorStoreService

logger = logging.getLogger("ai-service")


@dataclass
class AtlasEmbeddingUpdate:
    kp_id: int
    profile_id: int
    model_id: str
    embedding_dim: int


@dataclass
class AtlasKnowledgePointHit:
    id: int
    title: str
    body_markdown: str
    type: str
    status: str
    confidence: float
    provenance: str
    similarity: float | None = None
    recall_source: str = "selected"


@dataclass
class AtlasRelationHit:
    id: int
    from_kp_id: int
    to_kp_id: int
    type: str
    strength: float
    body_markdown: str | None = None
    depth: int = 1


@dataclass
class AtlasEvidenceHit:
    kp_id: int
    role: str
    annotation_id: int
    body_text: str
    anchor_state: str
    carrier_title: str | None = None
    source_uri: str | None = None


@dataclass
class AtlasNoteHit:
    note_id: int
    title: str
    chunk_index: int
    chunk_text: str
    similarity: float
    source_uri: str | None = None


@dataclass(frozen=True)
class AtlasNoteSourceRevision:
    note_id: int
    status: str
    fingerprint: str
    profile_id: int
    model_id: str
    embedding_dims: tuple[int, ...]


@dataclass(frozen=True)
class AtlasSelectedSourceSnapshot:
    kp_versions: tuple[tuple[int, str], ...]
    carrier_versions: tuple[tuple[int, str, str], ...]
    note_revisions: tuple[AtlasNoteSourceRevision, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "kp_versions", tuple(sorted(self.kp_versions)))
        object.__setattr__(self, "carrier_versions", tuple(sorted(self.carrier_versions)))
        object.__setattr__(
            self,
            "note_revisions",
            tuple(sorted(self.note_revisions, key=lambda revision: revision.note_id)),
        )


@dataclass
class AtlasRecallContext:
    knowledge_points: list[AtlasKnowledgePointHit | dict[str, Any]] = field(default_factory=list)
    relations: list[AtlasRelationHit | dict[str, Any]] = field(default_factory=list)
    evidence: list[AtlasEvidenceHit | dict[str, Any]] = field(default_factory=list)
    note_hits: list[AtlasNoteHit | dict[str, Any]] = field(default_factory=list)
    selected_note_revisions: tuple[AtlasNoteSourceRevision, ...] = field(
        default_factory=tuple,
        repr=False,
    )

    def __post_init__(self) -> None:
        self.knowledge_points = [_coerce_kp(row) for row in self.knowledge_points]
        self.relations = [_coerce_relation(row) for row in self.relations]
        self.evidence = [_coerce_evidence(row) for row in self.evidence]
        self.note_hits = [_coerce_note_hit(row) for row in self.note_hits]
        self.selected_note_revisions = tuple(
            sorted(self.selected_note_revisions, key=lambda revision: revision.note_id)
        )


def _dedupe_positive_ints(values: list[int] | None, limit: int) -> list[int]:
    out: list[int] = []
    seen: set[int] = set()
    for value in values or []:
        if isinstance(value, bool):
            continue
        try:
            item = int(value)
        except (TypeError, ValueError):
            continue
        if item <= 0 or item in seen:
            continue
        seen.add(item)
        out.append(item)
        if len(out) >= limit:
            break
    return out


def _snapshot_token(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return str(value.isoformat())
    return str(value)


async def selected_atlas_sources_snapshot(
    pool,
    *,
    llm: LlmRouter | None = None,
    user_id: int,
    kp_ids: list[int] | None,
    carrier_ids: list[int] | None,
) -> AtlasSelectedSourceSnapshot | None:
    """Capture the exact live, owned revisions behind a selected Atlas scope.

    Note-backed carriers also have a revision contract: an old indexed chunk
    must not remain selectable after the note entered PENDING/FAILED or the
    active profile changed. A successfully indexed blank note (SKIPPED) is
    still a valid empty source and is handled by the normal retrieval outcome.
    """
    requested_kp_ids = _dedupe_positive_ints(kp_ids, 12)
    requested_carrier_ids = _dedupe_positive_ints(carrier_ids, 6)

    async with pool.acquire() as conn:
        resolved_kp_rows: list[dict[str, Any]] = []
        if requested_kp_ids:
            rows = await conn.fetch(
                """
                SELECT id, updated_at
                FROM atlas_knowledge_points
                WHERE id = ANY($1::bigint[])
                  AND deleted = FALSE
                  AND archived = FALSE
                  AND status <> 'archived'
                  AND author_id = $2
                ORDER BY array_position($1::bigint[], id)
                """,
                requested_kp_ids,
                user_id,
            )
            resolved_kp_rows = [_row_to_dict(row) for row in rows]

        resolved_carrier_rows: list[dict[str, Any]] = []
        if requested_carrier_ids:
            rows = await conn.fetch(
                """
                SELECT id, type, source_uri, content_hash, updated_at
                FROM atlas_carriers
                WHERE id = ANY($1::bigint[])
                  AND deleted = FALSE
                  AND status = 'ready'
                  AND owner_id = $2
                ORDER BY array_position($1::bigint[], id)
                """,
                requested_carrier_ids,
                user_id,
            )
            resolved_carrier_rows = [_row_to_dict(row) for row in rows]

    resolved_kp_ids = [int(row["id"]) for row in resolved_kp_rows]
    resolved_carrier_ids = [int(row["id"]) for row in resolved_carrier_rows]
    sources_match = (
        set(resolved_kp_ids) == set(requested_kp_ids)
        and set(resolved_carrier_ids) == set(requested_carrier_ids)
    )
    if not sources_match:
        return None

    note_ids: list[int] = []
    for row in resolved_carrier_rows:
        if str(row.get("type") or "") != "markdown":
            continue
        source_uri = str(row.get("source_uri") or "")
        raw_note_id = source_uri.removeprefix("notes://")
        if not source_uri.startswith("notes://") or not raw_note_id.isdigit():
            return None
        note_id = int(raw_note_id)
        if note_id <= 0:
            return None
        note_ids.append(note_id)
    note_ids = _dedupe_positive_ints(note_ids, 12)
    note_sources: dict[int, AtlasNoteSourceRevision] = {}
    if note_ids:
        if llm is None:
            return None
        profile = await _get_active_search_profile(pool, llm)
        note_sources = await _resolve_current_note_sources(
            pool,
            note_ids=note_ids,
            user_id=user_id,
            profile=profile,
        )
        if set(note_sources) != set(note_ids):
            return None

    kp_rows_by_id = {int(row["id"]): row for row in resolved_kp_rows}
    carrier_rows_by_id = {int(row["id"]): row for row in resolved_carrier_rows}
    return AtlasSelectedSourceSnapshot(
        kp_versions=tuple(
            (kp_id, _snapshot_token(kp_rows_by_id[kp_id].get("updated_at")))
            for kp_id in requested_kp_ids
        ),
        carrier_versions=tuple(
            (
                carrier_id,
                _snapshot_token(carrier_rows_by_id[carrier_id].get("updated_at")),
                _snapshot_token(carrier_rows_by_id[carrier_id].get("content_hash")),
            )
            for carrier_id in requested_carrier_ids
        ),
        note_revisions=tuple(note_sources[note_id] for note_id in note_ids),
    )


async def selected_atlas_sources_available(
    pool,
    *,
    llm: LlmRouter | None = None,
    user_id: int,
    kp_ids: list[int] | None,
    carrier_ids: list[int] | None,
) -> bool:
    """Return whether every selected Atlas source has a valid snapshot."""
    return (
        await selected_atlas_sources_snapshot(
            pool,
            llm=llm,
            user_id=user_id,
            kp_ids=kp_ids,
            carrier_ids=carrier_ids,
        )
        is not None
    )


def _row_to_dict(row: Any) -> dict[str, Any]:
    if isinstance(row, dict):
        return row
    return dict(row)


def _coerce_kp(row: AtlasKnowledgePointHit | dict[str, Any]) -> AtlasKnowledgePointHit:
    if isinstance(row, AtlasKnowledgePointHit):
        return row
    return AtlasKnowledgePointHit(
        id=int(row["id"]),
        title=str(row.get("title") or ""),
        body_markdown=str(row.get("body_markdown") or ""),
        type=str(row.get("type") or "concept"),
        status=str(row.get("status") or "seed"),
        confidence=float(row.get("confidence") or 0),
        provenance=str(row.get("provenance") or "user"),
        similarity=(
            None
            if row.get("similarity") is None
            else float(row.get("similarity") or 0)
        ),
        recall_source=str(row.get("recall_source") or "selected"),
    )


def _coerce_relation(row: AtlasRelationHit | dict[str, Any]) -> AtlasRelationHit:
    if isinstance(row, AtlasRelationHit):
        return row
    return AtlasRelationHit(
        id=int(row["id"]),
        from_kp_id=int(row["from_kp_id"]),
        to_kp_id=int(row["to_kp_id"]),
        type=str(row.get("type") or "cites"),
        strength=float(row.get("strength") or 0),
        body_markdown=row.get("body_markdown"),
        depth=int(row.get("depth") or 1),
    )


def _coerce_evidence(row: AtlasEvidenceHit | dict[str, Any]) -> AtlasEvidenceHit:
    if isinstance(row, AtlasEvidenceHit):
        return row
    return AtlasEvidenceHit(
        kp_id=int(row["kp_id"]),
        role=str(row.get("role") or "evidence"),
        annotation_id=int(row["annotation_id"]),
        body_text=str(row.get("body_text") or ""),
        anchor_state=str(row.get("anchor_state") or "orphan"),
        carrier_title=row.get("carrier_title"),
        source_uri=row.get("source_uri"),
    )


def _coerce_note_hit(row: AtlasNoteHit | dict[str, Any]) -> AtlasNoteHit:
    if isinstance(row, AtlasNoteHit):
        return row
    return AtlasNoteHit(
        note_id=int(row["note_id"]),
        title=str(row.get("title") or ""),
        chunk_index=int(row.get("chunk_index") or 0),
        chunk_text=str(row.get("chunk_text") or ""),
        similarity=float(row.get("similarity") or 0),
        source_uri=row.get("source_uri"),
    )


def _cast_type_for_dim(dim: int) -> str:
    # Keep this aligned with kb_recall.py and the pgvector partial indexes.
    if dim > 4000:
        return "vector"
    if dim > 2000:
        return "halfvec"
    return "vector"


def _trim(text: str, max_chars: int) -> str:
    text = (text or "").strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "..."


def _build_kp_embedding_text(row: dict[str, Any]) -> str:
    title = str(row.get("title") or "").strip()
    body = str(row.get("body_markdown") or "").strip()
    evidence_texts = [
        str(item).strip()
        for item in (row.get("evidence_texts") or [])
        if str(item or "").strip()
    ][:8]

    parts = [f"Title: {title}"]
    if body:
        parts.append(f"Body:\n{body}")
    if evidence_texts:
        parts.append("Evidence:\n" + "\n".join(f"- {text}" for text in evidence_texts))
    return "\n\n".join(parts).strip()


async def _get_active_search_profile(pool, llm: LlmRouter) -> SearchProfile:
    return await VectorStoreService(pool, llm).get_active_profile()


async def _resolve_current_note_sources(
    pool,
    *,
    note_ids: list[int],
    user_id: int | None,
    profile: SearchProfile,
) -> dict[int, AtlasNoteSourceRevision]:
    """Classify current note revisions as indexed or intentionally empty.

    Fingerprints are recalculated with the NoteIndexer helpers so Atlas cannot
    drift from the indexing/readiness identity contract. The chunk existence
    check is batched to keep selected-carrier validation bounded and avoid an
    N+1 readiness call per source.
    """
    from app.services.note_indexer import _build_note_embedding_text, _note_fingerprint

    note_ids = _dedupe_positive_ints(note_ids, 12)
    if not note_ids:
        return {}

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                n.id,
                n.title,
                n.summary,
                n.content_markdown,
                n.embedding_status,
                n.embedding_fingerprint,
                n.embedding_profile_id,
                ARRAY(
                    SELECT DISTINCT ne.embedding_dim
                    FROM note_embeddings ne
                    WHERE ne.note_id = n.id
                      AND ne.profile_id = $2
                      AND ne.model_id = $3
                      AND ne.status = 'INDEXED'
                      AND ne.embedding IS NOT NULL
                      AND ne.embedding_dim IS NOT NULL
                    ORDER BY ne.embedding_dim
                ) AS indexed_dims
            FROM notes n
            WHERE n.id = ANY($1::bigint[])
              AND n.deleted = FALSE
              AND n.author_id = $4
            """,
            note_ids,
            profile.id,
            profile.model_id,
            user_id,
        )

    current_sources: dict[int, AtlasNoteSourceRevision] = {}
    for raw_row in rows:
        row = _row_to_dict(raw_row)
        current_fingerprint = _note_fingerprint(_build_note_embedding_text(row))
        if row.get("embedding_fingerprint") != current_fingerprint:
            continue
        if row.get("embedding_profile_id") != profile.id:
            continue

        note_id = int(row["id"])
        status = str(row.get("embedding_status") or "").upper()
        indexed_dims = tuple(sorted({int(dim) for dim in (row.get("indexed_dims") or []) if dim}))
        if status == "INDEXED" and not indexed_dims:
            continue
        if status == "SKIPPED" and indexed_dims:
            continue
        if status not in {"INDEXED", "SKIPPED"}:
            continue
        current_sources[note_id] = AtlasNoteSourceRevision(
            note_id=note_id,
            status=status,
            fingerprint=current_fingerprint,
            profile_id=profile.id,
            model_id=profile.model_id,
            embedding_dims=indexed_dims,
        )

    return current_sources


async def upsert_knowledge_point_embedding(
    pool,
    llm: LlmRouter,
    *,
    kp_id: int,
    user_id: int | None = None,
    profile: SearchProfile | None = None,
) -> AtlasEmbeddingUpdate | None:
    """Embed one Knowledge Point using the active search profile.

    The embedding payload includes title, body, and linked evidence quotes. The
    write records profile/model metadata next to the vector so recall can avoid
    mixing embeddings produced by a different active profile.
    """
    profile = profile or await _get_active_search_profile(pool, llm)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                kp.id,
                kp.title,
                kp.body_markdown,
                COALESCE(
                    array_agg(COALESCE(NULLIF(btrim(a.body_text), ''), tq.quote) ORDER BY a.updated_at DESC)
                        FILTER (
                            WHERE a.id IS NOT NULL
                              AND COALESCE(NULLIF(btrim(a.body_text), ''), tq.quote) IS NOT NULL
                        ),
                    ARRAY[]::text[]
                ) AS evidence_texts
            FROM atlas_knowledge_points kp
            LEFT JOIN atlas_annotation_kp_links l ON l.kp_id = kp.id
            LEFT JOIN atlas_annotations a ON a.id = l.annotation_id AND a.deleted = FALSE
            LEFT JOIN LATERAL (
                SELECT NULLIF(btrim(selector->>'exact'), '') AS quote
                FROM jsonb_array_elements(a.selectors) AS selector
                WHERE selector->>'type' = 'TextQuoteSelector'
                  AND NULLIF(btrim(selector->>'exact'), '') IS NOT NULL
                LIMIT 1
            ) tq ON TRUE
            WHERE kp.id = $1
              AND kp.deleted = FALSE
              AND ($2::bigint IS NULL OR kp.author_id = $2)
            GROUP BY kp.id, kp.title, kp.body_markdown
            """,
            kp_id,
            user_id,
        )
    if not row:
        return None

    text = _build_kp_embedding_text(_row_to_dict(row))
    embedding = await llm.embed(
        text,
        user_id=user_id,
        embedding_model_id=profile.model_id,
        strict_embedding_model_id=True,
    )
    dim = len(embedding) if embedding else 0
    if dim <= 0:
        raise RuntimeError(f"Atlas KP {kp_id} embedding returned an empty vector")

    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE atlas_knowledge_points
            SET embedding = $1,
                embedding_dim = $2,
                embedding_profile_id = $3,
                embedding_model_id = $4,
                embedding_indexed_at = CURRENT_TIMESTAMP
            WHERE id = $5
              AND deleted = FALSE
              AND ($6::bigint IS NULL OR author_id = $6)
            """,
            embedding,
            dim,
            profile.id,
            profile.model_id,
            kp_id,
            user_id,
        )

    return AtlasEmbeddingUpdate(
        kp_id=kp_id,
        profile_id=profile.id,
        model_id=profile.model_id,
        embedding_dim=dim,
    )


async def recall_atlas_context(
    pool,
    llm: LlmRouter | None,
    *,
    user_id: int | None,
    query: str | None,
    kp_ids: list[int] | None = None,
    carrier_ids: list[int] | None = None,
    semantic_limit: int = 8,
    neighborhood_depth: int = 1,
    include_evidence: bool = True,
    strict: bool = False,
) -> AtlasRecallContext:
    """Combine selected Atlas scope, semantic recall, graph neighborhood, evidence."""
    selected_kp_ids = _dedupe_positive_ints(kp_ids, 12)
    carrier_ids = _dedupe_positive_ints(carrier_ids, 6)
    semantic_limit = max(0, min(int(semantic_limit or 0), 12))
    neighborhood_depth = max(0, min(int(neighborhood_depth or 0), 2))

    carrier_note_ids: list[int] = []
    if carrier_ids:
        carrier_kp_ids = await _fetch_kp_ids_for_carriers(pool, carrier_ids, user_id)
        carrier_note_ids = await _fetch_note_ids_for_carriers(pool, carrier_ids, user_id)
        selected_kp_ids = _dedupe_positive_ints([*selected_kp_ids, *carrier_kp_ids], 12)

    selected_rows = await _fetch_kps_by_ids(
        pool,
        selected_kp_ids,
        user_id,
        recall_source="selected",
    )

    semantic_rows: list[AtlasKnowledgePointHit] = []
    note_rows: list[AtlasNoteHit] = []
    query = (query or "").strip()
    requested_note_ids = list(carrier_note_ids)
    selected_note_revisions: tuple[AtlasNoteSourceRevision, ...] = ()
    query_profile: SearchProfile | None = None
    query_embedding: list[float] | None = None
    query_dim = 0
    if llm is not None and query and (semantic_limit > 0 or carrier_note_ids):
        try:
            query_profile = await _get_active_search_profile(pool, llm)
            if carrier_note_ids:
                note_sources = await _resolve_current_note_sources(
                    pool,
                    note_ids=carrier_note_ids,
                    user_id=user_id,
                    profile=query_profile,
                )
                if strict and set(note_sources) != set(carrier_note_ids):
                    raise RuntimeError("selected note carrier revision is not current")
                selected_note_revisions = tuple(
                    note_sources[note_id]
                    for note_id in requested_note_ids
                    if note_id in note_sources
                )
                carrier_note_ids = [
                    note_id
                    for note_id in carrier_note_ids
                    if note_id in note_sources and note_sources[note_id].status == "INDEXED"
                ]

            if semantic_limit > 0 or carrier_note_ids:
                query_embedding = await llm.embed(
                    query,
                    user_id=user_id,
                    embedding_model_id=query_profile.model_id,
                    strict_embedding_model_id=True,
                )
                query_dim = len(query_embedding) if query_embedding else 0
                if query_dim <= 0:
                    raise RuntimeError("Atlas query embedding is empty")
                dimension_mismatches = [
                    note_id
                    for note_id in carrier_note_ids
                    if query_dim not in note_sources[note_id].embedding_dims
                ]
                if strict and dimension_mismatches:
                    raise RuntimeError("selected note carrier embedding dimension is not current")
                carrier_note_ids = [
                    note_id for note_id in carrier_note_ids if note_id not in dimension_mismatches
                ]
        except Exception as exc:
            if strict and requested_note_ids:
                raise
            logger.warning(
                "atlas_recall.query_embedding_failed",
                extra={"data": {"user_id": user_id, "error": f"{type(exc).__name__}: {exc}"[:240]}},
            )

    if query_profile is not None and query_embedding and query_dim > 0 and semantic_limit > 0:
        try:
            semantic_rows = await _semantic_recall_with_vector(
                pool,
                profile=query_profile,
                embedding=query_embedding,
                dim=query_dim,
                user_id=user_id,
                limit=semantic_limit,
            )
        except Exception as exc:
            logger.warning(
                "atlas_recall.semantic_failed",
                extra={"data": {"user_id": user_id, "error": f"{type(exc).__name__}: {exc}"[:240]}},
            )

    if query_profile is not None and query_embedding and query_dim > 0 and carrier_note_ids:
        try:
            note_rows = await _semantic_note_recall_with_vector(
                pool,
                profile=query_profile,
                embedding=query_embedding,
                dim=query_dim,
                user_id=user_id,
                note_revisions=[note_sources[note_id] for note_id in carrier_note_ids],
                limit=semantic_limit or 4,
            )
        except Exception as exc:
            if strict and requested_note_ids:
                raise
            logger.warning(
                "atlas_recall.note_semantic_failed",
                extra={"data": {"user_id": user_id, "error": f"{type(exc).__name__}: {exc}"[:240]}},
            )

    kps = _merge_kps([*selected_rows, *semantic_rows])
    seed_ids = [kp.id for kp in kps]

    relation_rows: list[AtlasRelationHit] = []
    if seed_ids and neighborhood_depth > 0:
        relation_rows = await _fetch_relation_neighborhood(
            pool,
            seed_ids,
            user_id,
            depth=neighborhood_depth,
        )
        neighbor_ids = sorted({
            rel.from_kp_id
            for rel in relation_rows
            if rel.from_kp_id not in {kp.id for kp in kps}
        } | {
            rel.to_kp_id
            for rel in relation_rows
            if rel.to_kp_id not in {kp.id for kp in kps}
        })
        if neighbor_ids:
            kps = _merge_kps([
                *kps,
                *(await _fetch_kps_by_ids(pool, neighbor_ids, user_id, recall_source="neighbor")),
            ])

    evidence_rows: list[AtlasEvidenceHit] = []
    if include_evidence and kps:
        evidence_rows = await _fetch_evidence(pool, [kp.id for kp in kps], user_id)

    return AtlasRecallContext(
        knowledge_points=kps,
        relations=relation_rows,
        evidence=evidence_rows,
        note_hits=note_rows,
        selected_note_revisions=selected_note_revisions,
    )


async def _fetch_kp_ids_for_carriers(pool, carrier_ids: list[int], user_id: int | None) -> list[int]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT l.kp_id
            FROM atlas_annotation_kp_links l
            JOIN atlas_annotations a ON a.id = l.annotation_id
            JOIN atlas_carriers c ON c.id = a.carrier_id
            WHERE a.deleted = FALSE
              AND c.deleted = FALSE
              AND c.status = 'ready'
              AND a.carrier_id = ANY($1::bigint[])
              AND ($2::bigint IS NULL OR a.author_id = $2)
              AND ($2::bigint IS NULL OR c.owner_id = $2)
            LIMIT 12
            """,
            carrier_ids,
            user_id,
        )
    return [int(row["kp_id"]) for row in rows]


async def _fetch_note_ids_for_carriers(pool, carrier_ids: list[int], user_id: int | None) -> list[int]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT substring(c.source_uri FROM '^notes://([0-9]+)$')::bigint AS note_id
            FROM atlas_carriers c
            WHERE c.id = ANY($1::bigint[])
              AND c.type = 'markdown'
              AND c.deleted = FALSE
              AND c.status = 'ready'
              AND ($2::bigint IS NULL OR c.owner_id = $2)
              AND c.source_uri ~ '^notes://[0-9]+$'
            LIMIT 12
            """,
            carrier_ids,
            user_id,
        )
    return [int(row["note_id"]) for row in rows]


async def _fetch_kps_by_ids(
    pool,
    kp_ids: list[int],
    user_id: int | None,
    *,
    recall_source: str,
) -> list[AtlasKnowledgePointHit]:
    kp_ids = _dedupe_positive_ints(kp_ids, 24)
    if not kp_ids:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                id,
                title,
                body_markdown,
                type,
                status,
                confidence,
                provenance,
                NULL::double precision AS similarity,
                $3::text AS recall_source
            FROM atlas_knowledge_points
            WHERE deleted = FALSE
              AND archived = FALSE
              AND status <> 'archived'
              AND id = ANY($1::bigint[])
              AND ($2::bigint IS NULL OR author_id = $2)
            ORDER BY array_position($1::bigint[], id)
            LIMIT 24
            """,
            kp_ids,
            user_id,
            recall_source,
        )
    return [_coerce_kp(_row_to_dict(row)) for row in rows]


async def _semantic_recall(
    pool,
    llm: LlmRouter,
    *,
    query: str,
    user_id: int | None,
    limit: int,
) -> list[AtlasKnowledgePointHit]:
    profile = await _get_active_search_profile(pool, llm)
    embedding = await llm.embed(
        query,
        user_id=user_id,
        embedding_model_id=profile.model_id,
        strict_embedding_model_id=True,
    )
    dim = len(embedding) if embedding else 0
    if dim <= 0:
        return []
    return await _semantic_recall_with_vector(
        pool,
        profile=profile,
        embedding=embedding,
        dim=dim,
        user_id=user_id,
        limit=limit,
    )


async def _semantic_recall_with_vector(
    pool,
    *,
    profile: SearchProfile,
    embedding: list[float],
    dim: int,
    user_id: int | None,
    limit: int,
) -> list[AtlasKnowledgePointHit]:
    cast_type = _cast_type_for_dim(dim)
    candidate_limit = min(max(limit * 4, 24), 120)
    threshold = get_settings().search_threshold
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            WITH semantic_candidates AS (
                SELECT
                    id,
                    title,
                    body_markdown,
                    type,
                    status,
                    confidence,
                    provenance,
                    1 - (embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})) AS similarity,
                    'semantic'::text AS recall_source
                FROM atlas_knowledge_points
                WHERE embedding_profile_id = $2
                  AND embedding_dim = $3
                  AND embedding IS NOT NULL
                  AND deleted = FALSE
                  AND archived = FALSE
                  AND status <> 'archived'
                  AND ($6::bigint IS NULL OR author_id = $6)
                ORDER BY embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})
                LIMIT $4
            )
            SELECT *
            FROM semantic_candidates
            WHERE similarity >= $5
            ORDER BY similarity DESC
            LIMIT $7
            """,
            embedding,
            profile.id,
            dim,
            candidate_limit,
            threshold,
            user_id,
            limit,
        )
    return [_coerce_kp(_row_to_dict(row)) for row in rows]


async def _semantic_note_recall_with_vector(
    pool,
    *,
    profile: SearchProfile,
    embedding: list[float],
    dim: int,
    user_id: int | None,
    note_revisions: list[AtlasNoteSourceRevision],
    limit: int,
) -> list[AtlasNoteHit]:
    revisions_by_id = {
        revision.note_id: revision
        for revision in note_revisions
        if revision.note_id > 0
        and revision.status == "INDEXED"
        and revision.profile_id == profile.id
        and revision.model_id == profile.model_id
        and dim in revision.embedding_dims
    }
    revisions = sorted(revisions_by_id.values(), key=lambda revision: revision.note_id)[:12]
    if not revisions or limit <= 0:
        return []
    note_ids = [revision.note_id for revision in revisions]
    expected_fingerprints = [revision.fingerprint for revision in revisions]

    cast_type = _cast_type_for_dim(dim)
    candidate_limit = min(max(limit * 4, 24), 120)
    threshold = get_settings().search_threshold
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            WITH semantic_candidates AS (
                SELECT
                    ne.note_id,
                    n.title,
                    ne.chunk_index,
                    ne.chunk_text,
                    1 - (ne.embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})) AS similarity,
                    COALESCE(c.source_uri, 'notes://' || ne.note_id::text) AS source_uri
                FROM note_embeddings ne
                JOIN notes n ON n.id = ne.note_id
                JOIN unnest($8::bigint[], $10::text[]) AS expected(note_id, fingerprint)
                  ON expected.note_id = ne.note_id
                 AND n.embedding_fingerprint = expected.fingerprint
                LEFT JOIN atlas_carriers c
                  ON c.source_uri = 'notes://' || ne.note_id::text
                 AND c.type = 'markdown'
                 AND c.deleted = FALSE
                 AND ($6::bigint IS NULL OR c.owner_id = $6)
                WHERE ne.profile_id = $2
                  AND ne.embedding_dim = $3
                  AND ne.model_id = $9
                  AND ne.status = 'INDEXED'
                  AND ne.embedding IS NOT NULL
                  AND n.deleted = FALSE
                  AND n.embedding_status = 'INDEXED'
                  AND n.embedding_profile_id = $2
                  AND ($6::bigint IS NULL OR n.author_id = $6)
                ORDER BY ne.embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})
                LIMIT $4
            )
            SELECT *
            FROM semantic_candidates
            WHERE similarity >= $5
            ORDER BY similarity DESC
            LIMIT $7
            """,
            embedding,
            profile.id,
            dim,
            candidate_limit,
            threshold,
            user_id,
            limit,
            note_ids,
            profile.model_id,
            expected_fingerprints,
        )
    return [_coerce_note_hit(_row_to_dict(row)) for row in rows]


async def _fetch_relation_neighborhood(
    pool,
    seed_kp_ids: list[int],
    user_id: int | None,
    *,
    depth: int,
) -> list[AtlasRelationHit]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH RECURSIVE relation_walk AS (
                SELECT
                    r.id,
                    r.from_kp_id,
                    r.to_kp_id,
                    r.type,
                    r.strength,
                    r.body_markdown,
                    1 AS depth,
                    ARRAY[r.from_kp_id, r.to_kp_id]::bigint[] AS path
                FROM atlas_typed_relations r
                WHERE r.deleted = FALSE
                  AND ($2::bigint IS NULL OR r.author_id = $2)
                  AND (r.from_kp_id = ANY($1::bigint[]) OR r.to_kp_id = ANY($1::bigint[]))

                UNION ALL

                SELECT
                    r.id,
                    r.from_kp_id,
                    r.to_kp_id,
                    r.type,
                    r.strength,
                    r.body_markdown,
                    rw.depth + 1 AS depth,
                    rw.path || CASE
                        WHEN r.from_kp_id = ANY(rw.path) THEN r.to_kp_id
                        ELSE r.from_kp_id
                    END
                FROM atlas_typed_relations r
                JOIN relation_walk rw
                  ON (r.from_kp_id = rw.from_kp_id OR r.from_kp_id = rw.to_kp_id
                   OR r.to_kp_id = rw.from_kp_id OR r.to_kp_id = rw.to_kp_id)
                WHERE r.deleted = FALSE
                  AND ($2::bigint IS NULL OR r.author_id = $2)
                  AND rw.depth < $3
                  AND NOT (
                    r.from_kp_id = ANY(rw.path)
                    AND r.to_kp_id = ANY(rw.path)
                  )
            )
            SELECT DISTINCT ON (id)
                id,
                from_kp_id,
                to_kp_id,
                type,
                strength,
                body_markdown,
                depth
            FROM relation_walk
            ORDER BY id, depth ASC, strength DESC
            LIMIT 64
            """,
            seed_kp_ids,
            user_id,
            depth,
        )
    relations = [_coerce_relation(_row_to_dict(row)) for row in rows]
    relations.sort(key=lambda item: (item.depth, -item.strength, item.id))
    return relations


async def _fetch_evidence(pool, kp_ids: list[int], user_id: int | None) -> list[AtlasEvidenceHit]:
    kp_ids = _dedupe_positive_ints(kp_ids, 36)
    if not kp_ids:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                l.kp_id,
                l.role,
                a.id AS annotation_id,
                COALESCE(NULLIF(btrim(a.body_text), ''), tq.quote, '') AS body_text,
                a.anchor_state,
                c.title AS carrier_title,
                c.source_uri
            FROM atlas_annotation_kp_links l
            JOIN atlas_annotations a ON a.id = l.annotation_id
            LEFT JOIN LATERAL (
                SELECT NULLIF(btrim(selector->>'exact'), '') AS quote
                FROM jsonb_array_elements(a.selectors) AS selector
                WHERE selector->>'type' = 'TextQuoteSelector'
                  AND NULLIF(btrim(selector->>'exact'), '') IS NOT NULL
                LIMIT 1
            ) tq ON TRUE
            LEFT JOIN atlas_carriers c ON c.id = a.carrier_id
            WHERE l.kp_id = ANY($1::bigint[])
              AND a.deleted = FALSE
              AND ($2::bigint IS NULL OR a.author_id = $2)
            ORDER BY array_position($1::bigint[], l.kp_id), a.updated_at DESC
            LIMIT 32
            """,
            kp_ids,
            user_id,
        )
    return [_coerce_evidence(_row_to_dict(row)) for row in rows]


def _merge_kps(kps: list[AtlasKnowledgePointHit]) -> list[AtlasKnowledgePointHit]:
    merged: list[AtlasKnowledgePointHit] = []
    seen: set[int] = set()
    for kp in kps:
        if kp.id in seen:
            continue
        seen.add(kp.id)
        merged.append(kp)
    return merged


def render_atlas_context(context: AtlasRecallContext, max_chars: int = 12000) -> str | None:
    if not context.knowledge_points and not context.note_hits:
        return None

    parts: list[str] = [
        "# Aether Atlas Context",
        (
            "Use this Atlas context as grounded knowledge. When citing it, include "
            "citations like [KP #id], [Evidence #annotation_id], and "
            "[Note #id chunk n]. If the answer depends on evidence, mention the "
            "evidence citation."
        ),
    ]
    total = sum(len(part) for part in parts)

    def append(line: str) -> bool:
        nonlocal total
        if total + len(line) + 1 > max_chars:
            return False
        parts.append(line)
        total += len(line) + 1
        return True

    if context.knowledge_points:
        append("## Knowledge Points")
        for kp in context.knowledge_points:
            score = "" if kp.similarity is None else f", score={kp.similarity:.2f}"
            if not append(
                f"- [KP #{kp.id}] {kp.title} "
                f"(type={kp.type}, status={kp.status}, confidence={kp.confidence:.2f}, "
                f"provenance={kp.provenance}, recall={kp.recall_source}{score})"
            ):
                break
            body = _trim(kp.body_markdown, 900)
            if body and not append(f"  Body: {body}"):
                break

    if context.note_hits:
        append("## Note Carrier Chunks")
        for note in context.note_hits:
            snippet = _trim(note.chunk_text, 700)
            source = note.source_uri or f"notes://{note.note_id}"
            if not append(
                f"- [Note #{note.note_id} chunk {note.chunk_index}] {note.title} "
                f"(source={source}, score={note.similarity:.2f}): {snippet}"
            ):
                break

    if context.relations:
        append("## Relations")
        for rel in context.relations:
            rationale = _trim(rel.body_markdown or "", 360)
            line = (
                f"- [Relation #{rel.id}] KP #{rel.from_kp_id} --{rel.type} "
                f"({rel.strength:.2f}, depth={rel.depth})--> KP #{rel.to_kp_id}"
            )
            if rationale:
                line += f"; rationale: {rationale}"
            if not append(line):
                break

    if context.evidence:
        append("## Evidence")
        for ev in context.evidence:
            quote = _trim(ev.body_text, 500)
            source = ev.carrier_title or ev.source_uri or "unknown source"
            if not append(
                f"- [Evidence #{ev.annotation_id}] for [KP #{ev.kp_id}] "
                f"role={ev.role} anchor={ev.anchor_state} source={source}: {quote}"
            ):
                break

    return "\n".join(parts)
