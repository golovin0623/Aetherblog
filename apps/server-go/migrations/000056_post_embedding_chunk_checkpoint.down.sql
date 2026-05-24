DROP INDEX IF EXISTS idx_post_emb_profile_post_status;

ALTER TABLE post_embeddings
    DROP CONSTRAINT IF EXISTS chk_post_embeddings_chunk_count;

ALTER TABLE post_embeddings
    DROP COLUMN IF EXISTS chunk_count,
    DROP COLUMN IF EXISTS chunk_hash;
