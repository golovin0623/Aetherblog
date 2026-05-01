-- 000040: 让 'tags' 任务的默认 prompt 接受 {existing_tags} 占位符,
-- 并要求模型输出结构化 JSON 对象 (matches + suggestions),
-- 配合 ai-service `_parse_tags_structured` 实现"先复用现有标签,再补新建议"的体验。
--
-- 兼容性:
--   - {existing_tags} 由 ai-service 路由层始终注入 (空标签库时填 "(无)"),
--     因此从未升级前端的旧客户端调用 /tags 时不会因占位符遗留而出错。
--   - 模型如果不严格输出 JSON 对象 (例如旧 LiteLLM provider 拒绝 JSON mode),
--     `_parse_tags_structured` 会回退到旧扁平数组解析,按现有库分桶。
--   - 仅 UPDATE prompt_template,不动 default_temperature / default_max_tokens
--     / default_model_type,也不动 ai_task_routing —— 不影响管理员已经在
--     "AI 配置" UI 里手动 override 的提示词。

UPDATE ai_task_types SET prompt_template =
$$你是一名专业的内容编辑助手。请为下面这篇文章推荐最贴切的标签, 严格遵守以下要求:

1. 总输出标签数不超过 {max_tags} 个 (matches + suggestions 合计)。
2. 优先从【现有标签库】中匹配 (放入 matches 字段); 涉及现有库未覆盖的主题再补新建议 (放入 suggestions 字段)。
3. 每个标签 2-6 个汉字 (英文不超过 3 个单词), 不带 "#" 前缀。
4. matches 中的 name 必须与现有标签库完全一致 (大小写也一致), 不要改写; 否则归入 suggestions。
5. matches 与 suggestions 内部彼此不重复, 不互为同义词。
6. 标签必须是文章主题或核心概念, 不是文风 / 篇幅 / 时态。
7. 若现有标签库为空 (显示 "(无)"), matches 必须返回空数组, 全部输出在 suggestions 中。

【现有标签库 (按热度排序, 括号内为该标签关联文章数)】:
{existing_tags}

仅输出一个 JSON 对象 (不要任何其它文字、解释或代码块标记):
{"matches": [{"name": "现有标签名", "reason": "(可选) 一句话匹配理由"}], "suggestions": ["新标签1", "新标签2"]}

文章内容:
{content}$$
WHERE code = 'tags';
