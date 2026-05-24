-- 000056: 为「文章索引库」(SYSTEM_POSTS) seed 默认 active profile。
--
-- 背景：000055 创建了 knowledge_bases 的 SYSTEM_POSTS 行，但 active_profile_id
-- 留空 —— 灵境对话需要一个可用 profile 才能召回。本 migration 给该库挂一条
-- active profile，参数与 search_profiles seed 同策略（递归 Markdown 切片）。
--
-- model_id 推导优先级（与 000041 search_profiles seed 一致，复用 site_settings
-- 与 ai_task_routing 的现有指针）：
--   1) site_settings.search.active_embedding_model
--   2) ai_task_routing.embedding 显式路由
--   3) text-embedding-3-large（兜底）
--
-- CUSTOM 库的默认 profile 不在 SQL 中处理 —— 创建 KB 时由 KBService 在事务里
-- 同时创建（应用层逻辑更灵活，能根据用户传入的偏好覆盖默认值）。

DO $$
DECLARE
    posts_kb_id BIGINT;
    new_profile_id BIGINT;
    target_model VARCHAR(120);
BEGIN
    SELECT id INTO posts_kb_id FROM knowledge_bases WHERE slug = 'posts' LIMIT 1;
    IF posts_kb_id IS NULL THEN
        RAISE NOTICE 'knowledge_bases.posts row missing, skip seeding default profile';
        RETURN;
    END IF;

    -- 模型解析（同 000041 search_profiles seed）
    SELECT COALESCE(
        NULLIF((SELECT setting_value FROM site_settings
                WHERE setting_key = 'search.active_embedding_model'), ''),
        (SELECT m.model_id FROM ai_task_routing r
            JOIN ai_models m ON m.id = r.primary_model_id
            JOIN ai_task_types t ON t.id = r.task_type_id
            WHERE t.code = 'embedding' LIMIT 1),
        'text-embedding-3-large'
    ) INTO target_model;

    -- 幂等 insert（uq_kb_profile_code 防重复）
    INSERT INTO kb_profiles (
        kb_id, code, name, description, model_id, chunker_kind,
        chunk_size_tokens, chunk_overlap_tokens, top_k, score_threshold, status
    )
    VALUES (
        posts_kb_id,
        'default',
        '默认 · 递归 Markdown 切片',
        '按 H1/H2 标题 → 段落 → 句子递归切分；超过 chunk_size_tokens 回退到 token 级硬切。'
        '相邻 chunk 之间保留 chunk_overlap_tokens token 重叠以防边界丢失上下文。'
        'chunk_size=512, overlap=64，对 Markdown 友好。',
        target_model,
        'recursive', 512, 64,
        6, 0.200,
        'active'
    )
    ON CONFLICT (kb_id, code) DO UPDATE SET status = 'active'
    RETURNING id INTO new_profile_id;

    IF new_profile_id IS NOT NULL THEN
        UPDATE knowledge_bases SET active_profile_id = new_profile_id WHERE id = posts_kb_id;
    END IF;
END $$;
