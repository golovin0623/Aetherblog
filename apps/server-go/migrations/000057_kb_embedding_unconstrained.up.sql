-- 000057: 把 kb_embeddings.embedding 改为不锁维度的 vector 列。
--
-- 背景：000055 把 embedding 列定义为 vector(3072)，对齐 text-embedding-3-large
-- 的最大维度。但实际环境用户的活跃模型可能是 4096 dim（bge-m3 / Qwen 等），
-- 这会让 pgvector 抛 DataError: expected 3072 dimensions, not 4096，导致 KB
-- 向量化全失败。
--
-- 修复对齐 post_embeddings（000034 起就用不锁维度 `vector`，按 dim 列分桶 +
-- partial HNSW 索引）。本 migration 复用同一策略。
--
-- 兼容性：表当前没有任何已成功插入的行（首次部署即失败），所以可以直接 ALTER。
-- 若历史已有数据（部分维度匹配的行），ALTER 仍然安全（pgvector 支持不锁维度的 vector 列）。

ALTER TABLE kb_embeddings
    ALTER COLUMN embedding TYPE vector USING embedding::vector;

COMMENT ON COLUMN kb_embeddings.embedding IS
    '不锁维度的 vector 列，实际维度记录在 embedding_dim 列。'
    '与 post_embeddings 同模式，按 dim 桶维护 partial HNSW 索引。';
