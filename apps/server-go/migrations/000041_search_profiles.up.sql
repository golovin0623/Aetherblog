-- ref: search profiles —— 把 chunking 策略 + 模型 + 切片参数绑成一个完整配置单元，
-- 多组并存，靠 active 指针决定当前用哪组检索。
--
-- 思路对齐：Pinecone namespace / Weaviate class / OpenAI vector store。
-- 这是 000034 蓝绿模型版本化的自然延伸 —— 把版本化维度从单一 model_id
-- 推广到 (model + chunker + chunk_size + overlap) 整组，让换 chunking
-- 策略也享受蓝绿切换、零切换窗口、随时回滚的能力。
--
-- 切换流程：
--   1. 新建 profile（status='shadow'），按新策略全站 reindex 写入 shadow 行
--   2. 全部成功后 -> 一条事务里 (a) shadow→active (b) 旧 active→deprecated
--      (c) site_settings.search.active_profile_code 翻转
--   3. 任一篇失败 -> 不翻转，shadow 行保留供修复后再触发
--
-- 与 000034 协同：post_embeddings.status 仍存在但语义并未失效；
-- 蓝绿翻转时同时按 profile_id 维度更新 status，保证 partial HNSW 索引
-- (dim x status='active') 始终选中"当前 profile 的全部 chunks"。
--
-- 兼容性：截至本 migration，post_embeddings 已在 000034 中存在 1:1
-- (post_id, model_id) 行；本 migration 把这些行整体归到默认 profile，
-- chunk_index=0、chunk_text=NULL（语义粒度仍是文档级，但能继续被搜到）；
-- admin UI 展示提示"建议 reindex 以应用新切片策略"。

-- ============================================================
-- 1. search_profiles 表
-- ============================================================

CREATE TABLE IF NOT EXISTS search_profiles (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    model_id VARCHAR(120) NOT NULL,
    chunker_kind VARCHAR(32) NOT NULL
        CHECK (chunker_kind IN ('recursive', 'fixed', 'markdown', 'qa', 'parent_child')),
    chunk_size_tokens INT NOT NULL DEFAULT 512
        CHECK (chunk_size_tokens > 0 AND chunk_size_tokens <= 8192),
    chunk_overlap_tokens INT NOT NULL DEFAULT 64
        CHECK (chunk_overlap_tokens >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'shadow'
        CHECK (status IN ('active', 'shadow', 'deprecated')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (chunk_overlap_tokens < chunk_size_tokens)
);

CREATE INDEX IF NOT EXISTS idx_search_profiles_status ON search_profiles (status);

-- 同一时刻只允许一行 status='active'。partial unique 索引比 trigger 实现简洁，
-- 后续 activate 操作必须先把旧 active 翻成 deprecated 才能写入新 active。
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_profiles_one_active
    ON search_profiles ((1)) WHERE status = 'active';

COMMENT ON TABLE search_profiles IS
    'Search Profile：完整的检索索引配置单元（model + chunker + chunk_size + overlap）。'
    '多 profile 并存，搜索流量按 site_settings.search.active_profile_code 指向当前 active profile。'
    '新策略试错不需要拆毁旧数据。';

-- ============================================================
-- 2. seed 默认 profile（递归 Markdown 切片，对齐用户 ack 的策略）
-- ============================================================
--
-- model_id 来源优先级：
--   1) 当前活跃模型指针（兼容 000034 部署）
--   2) ai_task_routing.embedding 显式路由（活跃 credential 的 model_id）
--   3) text-embedding-3-large（.env.example 默认值）
--
-- 这样存量部署在 000041 后立刻有一个 active profile，无需手工配置。

INSERT INTO search_profiles (
    code, name, description, model_id, chunker_kind,
    chunk_size_tokens, chunk_overlap_tokens, status
)
VALUES (
    'default',
    '默认 · 递归 Markdown 切片',
    '按 H1/H2 标题 → 段落 → 句子递归切分；超过 chunk_size_tokens 回退到 token 级硬切。'
    '相邻 chunk 之间保留 chunk_overlap_tokens token 重叠以防边界丢失上下文。'
    'chunk_size=512, overlap=64，对 Markdown 友好。',
    COALESCE(
        NULLIF((SELECT setting_value FROM site_settings
                WHERE setting_key = 'search.active_embedding_model'), ''),
        (SELECT m.model_id FROM ai_task_routing r
            JOIN ai_models m ON m.id = r.primary_model_id
            JOIN ai_task_types t ON t.id = r.task_type_id
            WHERE t.code = 'embedding' LIMIT 1),
        'text-embedding-3-large'
    ),
    'recursive',
    512,
    64,
    'active'
)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 3. post_embeddings 加 profile_id / chunk_index / chunk_text
-- ============================================================

ALTER TABLE post_embeddings
    ADD COLUMN IF NOT EXISTS profile_id BIGINT REFERENCES search_profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS chunk_index INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS chunk_text TEXT;

-- ============================================================
-- 4. 存量行 backfill 到默认 profile（保留各自原 status 不变）
-- ============================================================
--
-- 关键设计（用户 ack 方案 A）：
--   - 旧行整体挂到默认 profile（chunk_index=0, chunk_text=NULL）
--   - 语义粒度仍是文档级，但搜索继续可用，避免功能切断
--   - admin UI 会显示提示"建议 reindex 以应用新切片策略"

UPDATE post_embeddings pe
SET profile_id = (SELECT id FROM search_profiles WHERE code = 'default')
WHERE pe.profile_id IS NULL;

-- backfill 完成后让 profile_id NOT NULL，且 chunk_index 也加约束
ALTER TABLE post_embeddings
    ALTER COLUMN profile_id SET NOT NULL;

-- ============================================================
-- 5. 替换 UNIQUE 约束：(post_id, model_id) → (post_id, profile_id, chunk_index)
-- ============================================================
--
-- 旧约束在 000034 由列 UNIQUE 定义自动起名 post_embeddings_post_id_model_id_key。
-- 多 chunk 并存后这个约束必须删，否则 INSERT 第二个 chunk 直接 23505。

ALTER TABLE post_embeddings
    DROP CONSTRAINT IF EXISTS post_embeddings_post_id_model_id_key;

-- 新唯一键：同一 (post_id, profile_id) 下 chunk_index 不重复
ALTER TABLE post_embeddings
    DROP CONSTRAINT IF EXISTS post_embeddings_unique;

ALTER TABLE post_embeddings
    ADD CONSTRAINT post_embeddings_unique
    UNIQUE (post_id, profile_id, chunk_index);

-- 新增索引：按 profile + status 反查 active chunks（语义搜索的 WHERE 主键）
CREATE INDEX IF NOT EXISTS idx_post_emb_profile_status
    ON post_embeddings (profile_id, status);

-- ============================================================
-- 6. 新指针：active_profile_code（与旧 active_embedding_model 共存）
-- ============================================================
--
-- 旧指针 active_embedding_model 保留，作为 ai-service / Go backend 的回滚兜底；
-- 应用层先按 active_profile_code 解析，未配则回退旧指针。两者在 90 天兼容期内
-- 同步写（profile activate 时同时更新两个 key）。

INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES (
    'search.active_profile_code',
    'default',
    'STRING',
    'search',
    '当前活跃的 search profile 代码（每个 profile 是一组完整的 chunking + embedding 配置）。'
    '切换 profile = 触发该 profile 的 reindex 后翻转此指针。'
    '与 search.active_embedding_model 共存：profile activate 时同步更新两者。'
)
ON CONFLICT (setting_key) DO NOTHING;

COMMENT ON COLUMN post_embeddings.profile_id IS
    '隶属于哪个 search profile。蓝绿切换 = 新 profile 写 shadow → 全成功后翻转指针。';
COMMENT ON COLUMN post_embeddings.chunk_index IS
    '同一 (post_id, profile_id) 下的 chunk 序号，从 0 开始连续分配。';
COMMENT ON COLUMN post_embeddings.chunk_text IS
    'chunk 对应的原文片段（chunker 切出来后回写），用于召回时返回 snippet 给前端，'
    '避免再读 posts.content_markdown。'
    '存量行 chunk_index=0 时该列为 NULL（旧的全文向量未保存原文片段），admin 会提示建议 reindex。';
