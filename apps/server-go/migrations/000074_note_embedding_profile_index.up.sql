-- Intelligent Notes embedding profile metadata + pgvector HNSW buckets.
--
-- note_embeddings existed from 000054 but only stored an untyped vector. This
-- migration aligns note chunks with search_profiles so Markdown carriers can
-- reuse note embeddings without mixing profile/model/dimension generations.

ALTER TABLE note_embeddings
    ADD COLUMN IF NOT EXISTS embedding_dim INT,
    ADD COLUMN IF NOT EXISTS model_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS token_count INT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_note_emb_note_profile_chunk
    ON note_embeddings (note_id, profile_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_note_emb_profile_dim_status
    ON note_embeddings (profile_id, embedding_dim, status, updated_at DESC)
    WHERE status = 'INDEXED' AND embedding IS NOT NULL;

-- 1536 维（text-embedding-3-small / ada-002）
CREATE INDEX IF NOT EXISTS idx_note_emb_1536_active ON note_embeddings
    USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 1536
      AND profile_id IS NOT NULL
      AND status = 'INDEXED';

-- 3072 维（text-embedding-3-large）超过 vector HNSW 2000 维限制，走 halfvec。
CREATE INDEX IF NOT EXISTS idx_note_emb_3072_active ON note_embeddings
    USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 3072
      AND profile_id IS NOT NULL
      AND status = 'INDEXED';

-- 1024 / 768 维覆盖常见 bge / E5 / MiniLM 系列模型。
CREATE INDEX IF NOT EXISTS idx_note_emb_1024_active ON note_embeddings
    USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 1024
      AND profile_id IS NOT NULL
      AND status = 'INDEXED';

CREATE INDEX IF NOT EXISTS idx_note_emb_768_active ON note_embeddings
    USING hnsw ((embedding::vector(768)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 768
      AND profile_id IS NOT NULL
      AND status = 'INDEXED';

COMMENT ON COLUMN note_embeddings.embedding_dim IS
    '当前 note chunk embedding 的维度；Atlas note carrier recall 必须按 profile + dim 过滤。';
COMMENT ON COLUMN note_embeddings.model_id IS
    '生成当前 note chunk embedding 的模型 ID 快照，用于审计与 profile 切换排障。';
COMMENT ON COLUMN note_embeddings.token_count IS
    'chunk 的估算 token 数，用于索引审计与召回成本估算。';
COMMENT ON INDEX idx_note_emb_1536_active IS 'Note chunk 1536 维 active 向量的 HNSW partial index';
COMMENT ON INDEX idx_note_emb_3072_active IS 'Note chunk 3072 维 active halfvec 向量的 HNSW partial index';
COMMENT ON INDEX idx_note_emb_1024_active IS 'Note chunk 1024 维 active 向量的 HNSW partial index';
COMMENT ON INDEX idx_note_emb_768_active IS 'Note chunk 768 维 active 向量的 HNSW partial index';
