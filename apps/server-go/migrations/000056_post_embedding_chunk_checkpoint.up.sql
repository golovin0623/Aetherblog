-- 为 profile reindex 增加 chunk 级断点续跑元数据。
--
-- 现有 post_embeddings 已经以 (post_id, profile_id, chunk_index) 唯一约束存储
-- 多 chunk 向量；这里补充：
--   - chunk_hash: 当前 chunk 文本/parent_text 的稳定指纹，用于重试时识别可复用 chunk
--   - chunk_count: 同一篇文章在本次切分下的总 chunk 数，用于判断某篇文章是否完整
--
-- 旧数据没有 chunk_hash，仍可继续搜索；chunk_count 通过窗口函数按现有行数回填，
-- 避免已完整的历史 profile 被误判为不完整。

ALTER TABLE post_embeddings
    ADD COLUMN IF NOT EXISTS chunk_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS chunk_count INT;

WITH counts AS (
    SELECT
        id,
        COUNT(*) OVER (PARTITION BY post_id, profile_id) AS cnt
    FROM post_embeddings
)
UPDATE post_embeddings pe
SET chunk_count = counts.cnt
FROM counts
WHERE pe.id = counts.id
  AND pe.chunk_count IS NULL;

ALTER TABLE post_embeddings
    ALTER COLUMN chunk_count SET DEFAULT 1;

ALTER TABLE post_embeddings
    ADD CONSTRAINT chk_post_embeddings_chunk_count
    CHECK (chunk_count IS NULL OR chunk_count > 0);

CREATE INDEX IF NOT EXISTS idx_post_emb_profile_post_status
    ON post_embeddings (profile_id, post_id, status);

COMMENT ON COLUMN post_embeddings.chunk_hash IS
    'chunk_text + parent_text 的 SHA-256 指纹，用于 profile reindex chunk 级断点复用。';

COMMENT ON COLUMN post_embeddings.chunk_count IS
    '同一 (post_id, profile_id) 在当前切分配置下的总 chunk 数，用于判断文章级向量是否完整。';
