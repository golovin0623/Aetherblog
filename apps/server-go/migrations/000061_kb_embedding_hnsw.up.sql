-- 000058: 为 kb_embeddings 按 dim × status='active' 创建 partial HNSW 索引。
--
-- 与 post_embeddings 同策略（migration 000034）：
--   * pgvector HNSW vector 列上限 2000 维 → 1536 模型走 vector 索引
--   * pgvector HNSW halfvec 列上限 4000 维 → 2001..4000 维走 halfvec 索引
--   * > 4000 维（例如某些自研 4096 模型）当前 pgvector 不支持 HNSW，召回退化到顺序扫描；
--     大库时建议改用 1536 / 3072 模型，或等待 pgvector 提升上限。
--
-- 查询端 cast 必须严格匹配索引表达式才会被 planner 选中（ai-service
-- kb_recall.py 已按 dim 决定 cast_type，与本 migration 对齐）。
--
-- 添加 IF NOT EXISTS 兼容已经手工创建过索引的环境。

-- 1536 维（text-embedding-3-small / openai/ada-002）
CREATE INDEX IF NOT EXISTS idx_kb_emb_1536_active ON kb_embeddings
    USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 1536 AND status = 'active';

-- 3072 维（text-embedding-3-large）
CREATE INDEX IF NOT EXISTS idx_kb_emb_3072_active ON kb_embeddings
    USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 3072 AND status = 'active';

-- 1024 维（bge / E5 等本地模型常见维度）
CREATE INDEX IF NOT EXISTS idx_kb_emb_1024_active ON kb_embeddings
    USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 1024 AND status = 'active';

-- 768 维（all-MiniLM / bge-small）
CREATE INDEX IF NOT EXISTS idx_kb_emb_768_active ON kb_embeddings
    USING hnsw ((embedding::vector(768)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 768 AND status = 'active';

COMMENT ON INDEX idx_kb_emb_1536_active IS 'KB 1536 维 active 向量的 HNSW 索引（partial）';
COMMENT ON INDEX idx_kb_emb_3072_active IS 'KB 3072 维 active 向量的 halfvec HNSW 索引（partial）';
COMMENT ON INDEX idx_kb_emb_1024_active IS 'KB 1024 维 active 向量的 HNSW 索引（partial）';
COMMENT ON INDEX idx_kb_emb_768_active IS 'KB 768 维 active 向量的 HNSW 索引（partial）';
