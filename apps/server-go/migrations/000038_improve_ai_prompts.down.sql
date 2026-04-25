-- 回滚到 000019 / 000017 的原始 seed prompt.
--
-- 注: 这只是把 prompt_template 还原到 seed 默认值, 不会还原管理员通过
--   PUT /v1/admin/ai/prompts/:taskType 自定义过的 prompt (那些存放在
--   ai_task_routing.prompt_template, 该列不在本 down migration 范围内).

UPDATE ai_task_types SET prompt_template =
    '请为以下内容生成摘要（{max_length}字以内）：' || E'\n' || '{content}'
WHERE code = 'summary';

UPDATE ai_task_types SET prompt_template =
    '请为以下内容推荐{max_tags}个标签，逗号分隔：' || E'\n' || '{content}'
WHERE code = 'tags';

UPDATE ai_task_types SET prompt_template =
    '请为以下内容生成{max_titles}个标题建议，逗号分隔：' || E'\n' || '{content}'
WHERE code = 'titles';

UPDATE ai_task_types SET prompt_template =
    '请根据【{tone}】的语气润色以下内容：' || E'\n' || '{content}'
WHERE code = 'polish';

UPDATE ai_task_types SET prompt_template =
    '请为主题【{topic}】生成层级深度为{depth}的{style}风格大纲。{context}'
WHERE code = 'outline';

UPDATE ai_task_types SET prompt_template =
    '请将以下内容翻译成{target_language}：' || E'\n' || '{content}'
WHERE code = 'translate';

UPDATE ai_task_types SET prompt_template =
    '你是一个博客助手，请基于以下参考内容回答用户问题：' || E'\n\n' ||
    '参考内容：' || E'\n' || '{context}' || E'\n\n' ||
    '用户问题：{query}'
WHERE code = 'qa';

ALTER TABLE posts ALTER COLUMN summary TYPE VARCHAR(500);
