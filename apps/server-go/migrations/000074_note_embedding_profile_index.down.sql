DROP INDEX IF EXISTS idx_note_emb_768_active;
DROP INDEX IF EXISTS idx_note_emb_1024_active;
DROP INDEX IF EXISTS idx_note_emb_1536_active;
DROP INDEX IF EXISTS idx_note_emb_3072_active;
DROP INDEX IF EXISTS idx_note_emb_profile_dim_status;
DROP INDEX IF EXISTS idx_note_emb_note_profile_chunk;

ALTER TABLE note_embeddings
    DROP COLUMN IF EXISTS token_count,
    DROP COLUMN IF EXISTS model_id,
    DROP COLUMN IF EXISTS embedding_dim;
