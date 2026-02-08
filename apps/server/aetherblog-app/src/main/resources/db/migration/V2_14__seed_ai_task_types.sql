-- ============================================================
-- Seeding AI Task Types with Default Prompts
-- ============================================================

INSERT INTO ai_task_types (code, name, description, default_model_type, default_temperature, default_max_tokens, prompt_template) VALUES
    ('summary', '文章摘要', '自动生成文章摘要', 'chat', 0.3, 500, '请为以下内容生成摘要（{max_length}字以内）：\n{content}'),
    ('tags', '标签推荐', '智能推荐文章标签', 'chat', 0.2, 200, '请为以下内容推荐{max_tags}个标签，逗号分隔：\n{content}'),
    ('titles', '标题生成', '生成文章标题建议', 'chat', 0.7, 300, '请为以下内容生成{max_titles}个标题建议，逗号分隔：\n{content}'),
    ('polish', '文章润色', '优化文章内容表达', 'chat', 0.5, 4000, '请根据【{tone}】的语气润色以下内容：\n{content}'),
    ('outline', '大纲生成', '生成文章大纲', 'chat', 0.5, 2000, '请为主题【{topic}】生成层级深度为{depth}的{style}风格大纲。{context}'),
    ('embedding', '向量嵌入', '生成文本向量用于语义搜索', 'embedding', 0, NULL, NULL),
    ('qa', '智能问答', '基于博客内容的问答', 'chat', 0.3, 2000, '你是一个博客助手，请基于以下参考内容回答用户问题：\n\n参考内容：\n{context}\n\n用户问题：{query}')
ON CONFLICT (code) DO UPDATE SET 
    prompt_template = EXCLUDED.prompt_template,
    description = EXCLUDED.description,
    name = EXCLUDED.name;

-- ============================================================
-- Seeding System Default Routing
-- ============================================================

-- Insert system default routing (user_id = NULL means system default)
INSERT INTO ai_task_routing (user_id, task_type_id, primary_model_id, fallback_model_id, config_override)
WITH target_models AS (
    SELECT 
        m.id, 
        m.model_id,
        ROW_NUMBER() OVER (PARTITION BY m.model_id ORDER BY p.priority DESC, m.id ASC) as rn
    FROM ai_models m
    JOIN ai_providers p ON m.provider_id = p.id
    WHERE m.model_id IN (
        'gpt-5-mini', 
        'deepseek-chat', 
        'text-embedding-3-small'
    )
)
SELECT 
    NULL,
    tt.id,
    pm.id,
    fm.id,
    cfg::jsonb
FROM (VALUES
    ('summary', 'gpt-5-mini', 'deepseek-chat', '{"temperature": 0.3}'),
    ('tags', 'gpt-5-mini', 'deepseek-chat', '{"temperature": 0.2}'),
    ('titles', 'gpt-5-mini', 'deepseek-chat', '{"temperature": 0.7}'),
    ('polish', 'gpt-5-mini', 'deepseek-chat', '{"temperature": 0.5}'),
    ('outline', 'gpt-5-mini', 'deepseek-chat', '{"temperature": 0.5}'),
    ('embedding', 'text-embedding-3-small', NULL, '{}'),
    ('qa', 'gpt-5-mini', 'deepseek-chat', '{"temperature": 0.3}')
) AS v(task_code, primary_model, fallback_model, cfg)
JOIN ai_task_types tt ON tt.code = v.task_code
LEFT JOIN target_models pm ON pm.model_id = v.primary_model AND pm.rn = 1
LEFT JOIN target_models fm ON fm.model_id = v.fallback_model AND fm.rn = 1
ON CONFLICT ON CONSTRAINT uq_ai_task_routing_user_task
DO NOTHING;
