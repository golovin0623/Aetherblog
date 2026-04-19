-- ref: Plan V3 · 修复 000034 在已有 000001 部署上的静默失败
--
-- 背景:
--   migration 000001 在早期 init schema 里曾创建过一张"chunk 版" post_embeddings
--       (id, post_id, chunk_content, chunk_index, embedding vector(1536), created_at)
--   实际生产向量一直落在 000015 的 post_vectors 表, 旧 post_embeddings 表从未被使用.
--
--   migration 000034 想用"版本化 post_embeddings"替代 post_vectors, 但使用了
--       CREATE TABLE IF NOT EXISTS post_embeddings (...);
--   在存量部署上, 这条语句被跳过 —— 同名旧表依然在位, 没有 status / model_id /
--   dim / indexed_at 列. 紧随其后的 INSERT INTO post_embeddings (post_id,
--   model_id, dim, ...) 应当 prepare 失败, 但 golang-migrate 会把整个脚本
--   打包在单事务里, 失败后 schema_migrations 会被标脏. 现场的 ai-service
--   日志显示 runtime SELECT status/model_id 直接抛 UndefinedColumnError,
--   说明历史上要么 dirty flag 被 force unlock 后该脚本只执行了前半段, 要么
--   同步走了某个 branch 导致 000034 记为已应用但表结构未升级.
--
-- 修复策略 (幂等):
--   1. 若 post_embeddings 表已具备新 schema (有 status / model_id / dim 列) → 不动
--   2. 若缺列 → 视为"废弃 chunk 表"或"半成品新表": 把表整体重建
--      - 生产数据在 post_vectors (如果 000034 数据迁移一步没跑到就还在), 或已经
--        丢失 (在新表上向量的 dim 映射到 (post_id, model_id) 重跑即可恢复)
--      - 所以安全做法: DROP + CREATE, 再把 post_vectors 数据平移回来
--   3. 重新跑 000034 step 4 的数据迁移 + step 5 的旧函数/旧表 drop
--
-- 兼容性:
--   - 新部署 (fresh install after 000034): post_embeddings 已经有 status 列, 此脚本为 no-op
--   - 损坏部署 (000034 partial apply): 此脚本把 schema 复位 + 数据尽力恢复
--   - 正常部署 (000034 完整 apply): post_embeddings 合规, 此脚本为 no-op

CREATE EXTENSION IF NOT EXISTS vector;

DO $$
DECLARE
    has_status_col BOOLEAN;
    has_legacy_chunk BOOLEAN;
    has_post_vectors BOOLEAN;
BEGIN
    -- 判定当前 post_embeddings 是否已是版本化新 schema
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'post_embeddings'
          AND column_name = 'status'
    ) INTO has_status_col;

    IF has_status_col THEN
        -- 已经是新 schema —— 什么都不做. 让后面的 CREATE INDEX IF NOT EXISTS
        -- 兜底一下遗留索引, 不影响正常部署.
        RAISE NOTICE 'post_embeddings 已具备 status 列, 跳过重建.';
        RETURN;
    END IF;

    -- 进入修复分支: 判断是否存在旧版 chunk_content 列以及 post_vectors 数据源
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'post_embeddings'
          AND column_name = 'chunk_content'
    ) INTO has_legacy_chunk;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'post_vectors'
    ) INTO has_post_vectors;

    RAISE NOTICE 'post_embeddings 缺 status 列, 执行重建. legacy_chunk=% post_vectors=%',
        has_legacy_chunk, has_post_vectors;

    -- 旧 chunk 表从未承载生产数据 (生产向量在 post_vectors), 直接 DROP 安全.
    DROP TABLE IF EXISTS post_embeddings CASCADE;

    -- 按 000034 的定义重建 (保持完全一致)
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

    -- partial HNSW 索引按 dim × status='active' 分桶
    CREATE INDEX IF NOT EXISTS idx_post_emb_1536_active ON post_embeddings
        USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE dim = 1536 AND status = 'active';

    -- pgvector HNSW vector 上限 2000 维；3072 维必须走 halfvec (上限 4000)。
    CREATE INDEX IF NOT EXISTS idx_post_emb_3072_active ON post_embeddings
        USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE dim = 3072 AND status = 'active';

    CREATE INDEX IF NOT EXISTS idx_post_emb_post_status
        ON post_embeddings (post_id, status);
    CREATE INDEX IF NOT EXISTS idx_post_emb_model_status
        ON post_embeddings (model_id, status);

    COMMENT ON TABLE post_embeddings IS '版本化向量存储. 每 (post_id, model_id) 一行, 支持多模型共存. status: active=查询 / shadow=新模型预热中 / deprecated=旧模型待 GC';
    COMMENT ON COLUMN post_embeddings.embedding IS 'pgvector 0.7+ 变长 vector. HNSW 通过 partial 表达式索引按 dim 分桶.';
    COMMENT ON COLUMN post_embeddings.model_id IS '模型标识符, 格式建议 "<provider>/<model>", 例如 openai/text-embedding-3-large';

    -- 把 post_vectors 数据尽力平移进来 (如果还在)
    IF has_post_vectors THEN
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

        -- 丢掉旧函数 + 旧表 (000034 step 5 的内容, 同样需要在修复分支里补一次)
        DROP FUNCTION IF EXISTS search_similar_posts(vector, float, int);
        DROP FUNCTION IF EXISTS search_similar_posts(vector, float, int, varchar);
        DROP FUNCTION IF EXISTS search_similar_posts(vector, float, int, text);
        DROP TABLE IF EXISTS post_vectors CASCADE;
    END IF;
END $$;

-- site_settings.search.active_embedding_model 指针 —— 若 000034 没写入过也补上,
-- 否则 ai-service _get_active_embedding_model 会 fallback 到 llm_router, 导致
-- stats 里 "活跃 embedding" 显示的模型和历史向量对不上.
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
