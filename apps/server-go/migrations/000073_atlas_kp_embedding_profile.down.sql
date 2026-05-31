DROP INDEX IF EXISTS idx_atlas_kp_emb_768_active;
DROP INDEX IF EXISTS idx_atlas_kp_emb_1024_active;
DROP INDEX IF EXISTS idx_atlas_kp_emb_1536_active;
DROP INDEX IF EXISTS idx_atlas_kp_emb_3072_active;
DROP INDEX IF EXISTS idx_atlas_kp_embedding_profile_status;

ALTER TABLE atlas_knowledge_points
    DROP COLUMN IF EXISTS embedding_indexed_at,
    DROP COLUMN IF EXISTS embedding_model_id,
    DROP COLUMN IF EXISTS embedding_profile_id;
