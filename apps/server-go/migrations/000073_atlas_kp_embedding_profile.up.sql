-- Atlas KP embedding profile metadata + pgvector HNSW buckets.
--
-- atlas_knowledge_points already has embedding / embedding_dim from 000062.
-- This migration closes the unsafe gap where a vector could be searched with a
-- different active profile of the same dimension. Recall now filters by
-- embedding_profile_id and embedding_dim, mirroring post_embeddings and
-- kb_embeddings profile discipline.

ALTER TABLE atlas_knowledge_points
    ADD COLUMN IF NOT EXISTS embedding_profile_id BIGINT REFERENCES search_profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS embedding_model_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS embedding_indexed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_atlas_kp_embedding_profile_status
    ON atlas_knowledge_points (embedding_profile_id, embedding_dim, updated_at DESC)
    WHERE deleted = false AND archived = false AND embedding IS NOT NULL;

-- 1536 维（text-embedding-3-small / ada-002）
CREATE INDEX IF NOT EXISTS idx_atlas_kp_emb_1536_active ON atlas_knowledge_points
    USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 1536
      AND embedding_profile_id IS NOT NULL
      AND deleted = false
      AND archived = false;

-- 3072 维（text-embedding-3-large）超过 vector HNSW 2000 维限制，走 halfvec。
CREATE INDEX IF NOT EXISTS idx_atlas_kp_emb_3072_active ON atlas_knowledge_points
    USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 3072
      AND embedding_profile_id IS NOT NULL
      AND deleted = false
      AND archived = false;

-- 1024 / 768 维覆盖常见 bge / E5 / MiniLM 系列模型。
CREATE INDEX IF NOT EXISTS idx_atlas_kp_emb_1024_active ON atlas_knowledge_points
    USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 1024
      AND embedding_profile_id IS NOT NULL
      AND deleted = false
      AND archived = false;

CREATE INDEX IF NOT EXISTS idx_atlas_kp_emb_768_active ON atlas_knowledge_points
    USING hnsw ((embedding::vector(768)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 768
      AND embedding_profile_id IS NOT NULL
      AND deleted = false
      AND archived = false;

COMMENT ON COLUMN atlas_knowledge_points.embedding_profile_id IS
    '生成当前 KP embedding 的 active search profile。Atlas semantic recall 必须按 profile 过滤。';
COMMENT ON COLUMN atlas_knowledge_points.embedding_model_id IS
    '生成当前 KP embedding 的模型 ID 快照，用于审计与 profile 切换排障。';
COMMENT ON COLUMN atlas_knowledge_points.embedding_indexed_at IS
    '当前 KP embedding 最后写入时间。';
COMMENT ON INDEX idx_atlas_kp_emb_1536_active IS 'Atlas KP 1536 维 active 向量的 HNSW partial index';
COMMENT ON INDEX idx_atlas_kp_emb_3072_active IS 'Atlas KP 3072 维 active halfvec 向量的 HNSW partial index';
COMMENT ON INDEX idx_atlas_kp_emb_1024_active IS 'Atlas KP 1024 维 active 向量的 HNSW partial index';
COMMENT ON INDEX idx_atlas_kp_emb_768_active IS 'Atlas KP 768 维 active 向量的 HNSW partial index';
