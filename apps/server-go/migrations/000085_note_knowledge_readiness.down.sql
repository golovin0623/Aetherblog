DROP INDEX IF EXISTS idx_notes_embedding_readiness;

ALTER TABLE notes
    DROP COLUMN IF EXISTS embedding_attempt_id,
    DROP COLUMN IF EXISTS embedding_error,
    DROP COLUMN IF EXISTS embedding_indexed_at,
    DROP COLUMN IF EXISTS embedding_profile_id,
    DROP COLUMN IF EXISTS embedding_fingerprint;
