-- ref: fix/search-status-column-2026-04-19 · 彻底修复"post_embeddings 缺 status 列"
--
-- 背景（为什么 000035 已经在 main 上, 还需要 000036）:
--   000001 建了一张 chunk-版 post_embeddings (id, post_id, chunk_content,
--   chunk_index, embedding vector(1536), created_at). 该表在 000015 引入
--   post_vectors 后就没有再被实际使用.
--
--   000034 想把 post_vectors 替换为版本化的 post_embeddings, 但使用了
--       CREATE TABLE IF NOT EXISTS post_embeddings (..., status VARCHAR(20), ...);
--   存量部署上这条语句因为同名旧表存在而**静默跳过**, 紧随其后的
--       CREATE INDEX ... WHERE dim = 1536 AND status = 'active';
--   因为引用了旧表不存在的 dim/status 列直接失败. golang-migrate 把 000034
--   标记为 dirty, 迁移链停在 v34, 从此 000035 再也进不来.
--
--   000035 的修复逻辑本身没问题, 但前提是它能被执行. dirty 锁阻止了这一点.
--
-- 本迁移的定位:
--   "无论历史状态如何, 只要 post_embeddings 缺 status 列就把它修掉." 与 000035
--   在语义上等价, 但放在一个**独立的新版本号**里, 配合 deploy.sh 里新增的
--   "v34 dirty → force 35" 一键解锁, 让陷在旧节点的生产也能自愈.
--
--   正常部署(000034 + 000035 均已跑通): post_embeddings 已具备 status 列, 本迁移
--   为 no-op. 对任何新环境都安全.

CREATE EXTENSION IF NOT EXISTS vector;

DO $$
DECLARE
    has_status_col BOOLEAN;
    has_post_vectors BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'post_embeddings'
          AND column_name = 'status'
    ) INTO has_status_col;

    IF has_status_col THEN
        RAISE NOTICE '[000036] post_embeddings 已具备 status 列, 跳过重建.';
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'post_vectors'
    ) INTO has_post_vectors;

    RAISE NOTICE '[000036] post_embeddings 缺 status 列, 执行重建. post_vectors=%', has_post_vectors;

    -- chunk 版 post_embeddings 从未承载生产数据, 生产向量在 post_vectors (若还在)
    DROP TABLE IF EXISTS post_embeddings CASCADE;

    CREATE TABLE post_embeddings (
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

    CREATE INDEX IF NOT EXISTS idx_post_emb_1536_active ON post_embeddings
        USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE dim = 1536 AND status = 'active';

    CREATE INDEX IF NOT EXISTS idx_post_emb_3072_active ON post_embeddings
        USING hnsw ((embedding::vector(3072)) vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE dim = 3072 AND status = 'active';

    CREATE INDEX IF NOT EXISTS idx_post_emb_post_status
        ON post_embeddings (post_id, status);
    CREATE INDEX IF NOT EXISTS idx_post_emb_model_status
        ON post_embeddings (model_id, status);

    COMMENT ON TABLE post_embeddings IS '版本化向量存储 (000034+ V3). 每 (post_id, model_id) 一行; status: active=查询 / shadow=预热 / deprecated=旧模型待 GC';
    COMMENT ON COLUMN post_embeddings.embedding IS 'pgvector 0.7+ 变长 vector; HNSW 通过 partial 表达式索引按 dim 分桶';
    COMMENT ON COLUMN post_embeddings.model_id IS '模型标识符 (格式建议 "<provider>/<model>")';

    IF has_post_vectors THEN
        RAISE NOTICE '[000036] 从 post_vectors 回灌活跃向量.';
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

        -- 同样照 000034 step 5 收尾: 丢旧函数 + 旧表
        DROP FUNCTION IF EXISTS search_similar_posts(vector, float, int);
        DROP FUNCTION IF EXISTS search_similar_posts(vector, float, int, varchar);
        DROP FUNCTION IF EXISTS search_similar_posts(vector, float, int, text);
        DROP TABLE IF EXISTS post_vectors CASCADE;
    END IF;
END $$;

-- active_embedding_model 指针兜底 (000034 / 000035 如果没跑到这一步也保证一个默认值).
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES (
    'search.active_embedding_model',
    COALESCE(
        (SELECT model_id FROM post_embeddings WHERE status = 'active' LIMIT 1),
        'text-embedding-3-small'
    ),
    'STRING',
    'search',
    '当前活跃的 embedding 模型 ID (与 ai_task_routing 的 embedding 激活路由应一致). 切换此值会把旧 model_id 对应行标记为 deprecated, 并触发全量 reindex 到新模型.'
)
ON CONFLICT (setting_key) DO NOTHING;
