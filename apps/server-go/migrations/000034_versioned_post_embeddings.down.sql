-- 回滚 000034：恢复 post_vectors + search_similar_posts，尽力迁回 1536 维 active 数据
-- 注意：非 1536 维的 embedding（例如 text-embedding-3-large 的 3072d）无法迁回
--       旧的 vector(1536) 列，这部分数据会丢失。回滚前务必备份。

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS post_vectors (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
    embedding vector(1536),
    model VARCHAR(50) DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_post_vectors_embedding ON post_vectors
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE OR REPLACE FUNCTION search_similar_posts(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.6,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    post_id BIGINT,
    title VARCHAR,
    slug VARCHAR,
    content TEXT,
    similarity float
)
LANGUAGE sql STABLE AS $$
    SELECT
        pv.post_id,
        p.title,
        p.slug,
        COALESCE(p.content_markdown, '') AS content,
        1 - (pv.embedding <=> query_embedding) AS similarity
    FROM post_vectors pv
    JOIN posts p ON p.id = pv.post_id
    WHERE p.deleted = FALSE
      AND p.status = 'PUBLISHED'
      AND pv.embedding IS NOT NULL
      AND 1 - (pv.embedding <=> query_embedding) >= match_threshold
    ORDER BY pv.embedding <=> query_embedding
    LIMIT match_count;
$$;

-- 尽力迁回：仅迁 dim=1536 的 active 行
INSERT INTO post_vectors (post_id, embedding, model, created_at, updated_at)
SELECT
    post_id,
    embedding::vector(1536),
    model_id,
    indexed_at,
    indexed_at
FROM post_embeddings
WHERE dim = 1536 AND status = 'active'
ON CONFLICT (post_id) DO NOTHING;

DELETE FROM site_settings WHERE setting_key = 'search.active_embedding_model';

DROP TABLE IF EXISTS post_embeddings CASCADE;
