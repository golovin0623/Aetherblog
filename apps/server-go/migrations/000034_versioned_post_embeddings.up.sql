-- ref: Plan V3 — 版本化 embedding 存储
--
-- 动机：旧 post_vectors 把 dim 写死在 vector(1536) 列上，换 embedding 模型
-- 只要维度不同就 500（3072d 的 text-embedding-3-large 直接炸），用户必须跑
-- ALTER + 重建索引 + 全量重跑。这是 2010 年的做法。
--
-- V3 模式（Supabase Automatic Embeddings / Pinecone alias flip / dbi-services
-- RAG versioning 的共同模式）：
--   - model_id 和 dim 作为一等公民存入表
--   - embedding 列不锁 dim（pgvector 0.7+ 支持变长 vector）
--   - HNSW 通过 partial expression 索引按 dim × status 分桶
--   - site_settings.search.active_embedding_model 作为"当前活跃模型"指针
--   - 换模型 = INSERT 新行 + 原子翻转指针，旧行留作 rollback

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. 版本化向量表
CREATE TABLE IF NOT EXISTS post_embeddings (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    model_id VARCHAR(120) NOT NULL,
    dim INT NOT NULL CHECK (dim > 0 AND dim <= 4096),
    embedding vector NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'shadow', 'deprecated')),
    indexed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (post_id, model_id)
);

-- 2. 按 dim × status='active' 的 partial HNSW 索引
--    未来出现新维度（例如 8192）只需追加一条 partial 索引，不动主表。
CREATE INDEX IF NOT EXISTS idx_post_emb_1536_active ON post_embeddings
    USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE dim = 1536 AND status = 'active';

-- pgvector HNSW vector 上限 2000 维；3072 维（text-embedding-3-large 默认输出）
-- 必须走 halfvec (上限 4000)。查询端 cast 到 halfvec(3072) 才能走这条索引。
CREATE INDEX IF NOT EXISTS idx_post_emb_3072_active ON post_embeddings
    USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE dim = 3072 AND status = 'active';

-- 用于按文章反查当前 active/shadow 行
CREATE INDEX IF NOT EXISTS idx_post_emb_post_status ON post_embeddings (post_id, status);
CREATE INDEX IF NOT EXISTS idx_post_emb_model_status ON post_embeddings (model_id, status);

-- 3. active embedding 模型指针（换模型只改此行，不动 schema）
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES (
    'search.active_embedding_model',
    COALESCE(
        (SELECT model FROM post_vectors WHERE model IS NOT NULL LIMIT 1),
        'text-embedding-3-small'
    ),
    'STRING',
    'search',
    '当前活跃的 embedding 模型 ID（与 ai_task_routing 的 embedding 激活路由应一致）。切换此值会把旧 model_id 对应行标记为 deprecated，并触发全量 reindex 到新模型。'
)
ON CONFLICT (setting_key) DO NOTHING;

-- 4. 数据迁移：把既有 post_vectors 平移到 post_embeddings（dim=1536, status=active）
INSERT INTO post_embeddings (post_id, model_id, dim, embedding, status, indexed_at)
SELECT
    pv.post_id,
    COALESCE(pv.model, 'text-embedding-3-small'),
    1536,
    pv.embedding::vector,
    'active',
    COALESCE(pv.updated_at, pv.created_at, NOW())
FROM post_vectors pv
WHERE pv.embedding IS NOT NULL
ON CONFLICT (post_id, model_id) DO NOTHING;

-- 5. 废弃旧表 & 旧函数（ai-service 改为直接查 post_embeddings）
DROP FUNCTION IF EXISTS search_similar_posts(vector, float, int);
DROP FUNCTION IF EXISTS search_similar_posts(vector, float, int, varchar);
DROP FUNCTION IF EXISTS search_similar_posts(vector, float, int, text);
DROP TABLE IF EXISTS post_vectors CASCADE;

COMMENT ON TABLE post_embeddings IS '版本化向量存储。每 (post_id, model_id) 一行，支持多模型共存。status: active=查询 / shadow=新模型预热中 / deprecated=旧模型待 GC';
COMMENT ON COLUMN post_embeddings.embedding IS 'pgvector 0.7+ 变长 vector。HNSW 通过 partial 表达式索引按 dim 分桶。';
COMMENT ON COLUMN post_embeddings.model_id IS '模型标识符，格式建议 "<provider>/<model>"，例如 openai/text-embedding-3-large';
