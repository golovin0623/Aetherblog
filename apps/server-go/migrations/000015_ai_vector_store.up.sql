-- ref: §4.4
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

CREATE TRIGGER update_post_vectors_updated_at
BEFORE UPDATE ON post_vectors
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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

COMMENT ON TABLE post_vectors IS '文章向量表，用于语义搜索和相关推荐';
COMMENT ON COLUMN post_vectors.embedding IS '1536维向量嵌入';
COMMENT ON FUNCTION search_similar_posts IS '基于向量相似度搜索相关文章';
