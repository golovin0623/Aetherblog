-- Intelligent Notes query-readiness metadata.
--
-- `embedding_status` alone cannot prove that the current note revision is
-- queryable: an old async job may finish after a newer save, and a profile
-- switch can leave valid chunks that no longer belong to the active profile.
-- Persist the exact source fingerprint and profile committed with the chunks
-- so readiness can fail closed.

ALTER TABLE notes
    ADD COLUMN IF NOT EXISTS embedding_fingerprint VARCHAR(64),
    ADD COLUMN IF NOT EXISTS embedding_profile_id BIGINT REFERENCES search_profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS embedding_indexed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS embedding_error TEXT;

CREATE INDEX IF NOT EXISTS idx_notes_embedding_readiness
    ON notes (embedding_profile_id, embedding_status, embedding_indexed_at DESC)
    WHERE deleted = FALSE;

COMMENT ON COLUMN notes.embedding_fingerprint IS
    'SHA-256 of the exact title/summary/content payload committed with note_embeddings; stale jobs must not replace a different fingerprint.';
COMMENT ON COLUMN notes.embedding_profile_id IS
    'Search profile whose chunks were committed with embedding_fingerprint; readiness requires the active profile.';
COMMENT ON COLUMN notes.embedding_indexed_at IS
    'Successful or skipped index commit time for the recorded fingerprint/profile.';
COMMENT ON COLUMN notes.embedding_error IS
    'Last indexing failure for the current note revision; user-facing APIs expose only a safe product message.';
