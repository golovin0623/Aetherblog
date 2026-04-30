-- ref: 修复 000038 在生产环境必然失败的 ALTER COLUMN
--
-- 故事:
--   000038 试图把 posts.summary 从 VARCHAR(500) 加宽到 VARCHAR(2000), 但
--   PostgreSQL 不允许直接改被 view 引用的列类型 (错误码 0A000):
--     pq: cannot alter type of a column used by a view or rule
--   v_published_posts (000001:428) 用 SELECT p.* 间接引用了 posts.summary,
--   所以 000038 的 ALTER 在所有真实部署上都会撞死, schema_migrations 标
--   v38 dirty.
--
--   golang-migrate 默认把单个 migration 文件放在一个事务里, ALTER 失败时
--   前面 7 条 UPDATE ai_task_types 也会一起回滚 —— v38 dirty 的实例上,
--   ai_task_types.prompt_template 仍是 000019/000017 的旧 (宽松版) prompt,
--   posts.summary 仍是 VARCHAR(500).
--
--   PR #521 当时基于"038 全幂等可重放"的错误判断, 给出了
--   "v38 dirty → force 37 + up 重放" 的自愈策略, 重放仍会撞 view 依赖
--   再次失败. 改为 "v38 dirty → force 38 + up", 让本 migration (039)
--   接管真正的修复.
--
-- 修复策略 (顺序敏感, 必须按整体事务执行):
--   1) DROP VIEW v_published_posts —— 解除对 posts.summary 的引用.
--      v_published_posts 在 000001 之后没被任何其他 view / rule 进一步引用
--      (grep 全部 migrations 确认), 所以直接 DROP 安全, 不需要 CASCADE.
--   2) 重做 000038 想做但被回滚的 7 条 UPDATE ai_task_types.
--      UPDATE 是幂等的 —— 即便某个实例 038 真的成功跑过 (理论上不可能,
--      因为 view 早在 000001 就建好), 重复跑也无副作用.
--   3) ALTER TABLE posts ALTER COLUMN summary TYPE VARCHAR(2000).
--      这是 catalog-only 的 O(1) DDL, VARCHAR 加宽不需要重写表数据.
--   4) CREATE OR REPLACE VIEW v_published_posts —— 从 000001:428 原样恢复.
--      SELECT p.* 会自动包含加宽后的 summary, 不需要列出每一列.

DROP VIEW IF EXISTS v_published_posts;

UPDATE ai_task_types SET prompt_template =
$$你是一名专业的中文摘要撰写助手。请阅读用户提供的文章, 用一段连贯的中文段落总结核心要点, 严格遵守以下要求:

1. 只输出一段话, 字数严格控制在 {max_length} 个汉字以内 (绝对不能超过).
2. 不得使用问答形式 (例如 "什么是 ...? 答: ..."), 不得分点, 不得加任何小标题.
3. 不要复述原文标题或加 "摘要:" / "本文" / "本篇文章" 之类的前缀, 直接给出摘要正文.
4. 不要新增原文未提及的事实, 不要进行评价或推测.
5. 输出语言与原文一致.

文章内容:
{content}$$
WHERE code = 'summary';

UPDATE ai_task_types SET prompt_template =
$$你是一名专业的内容编辑助手。请为下面这篇文章推荐最贴切的标签, 严格遵守以下要求:

1. 输出一个 JSON 数组, 元素为字符串, 不要任何其他文本 (例如不要加 "标签:" 前缀, 不要加代码块包裹, 不要加解释).
2. 数组长度恰好为 {max_tags}, 不多不少 (如果文章太短无法凑够, 也尽力补到 {max_tags}).
3. 每个标签 2-6 个汉字 (英文不超过 3 个单词), 不带 "#" 前缀.
4. 标签之间彼此不重复, 不互为同义词.
5. 标签必须是文章主题或核心概念, 不是文风 / 篇幅 / 时态.

输出示例: ["机器学习", "向量数据库", "RAG"]

文章内容:
{content}$$
WHERE code = 'tags';

UPDATE ai_task_types SET prompt_template =
$$你是一名资深的标题撰稿人。请为下面的文章拟 {max_titles} 个备选标题, 严格遵守以下要求:

1. 输出一个 JSON 数组, 元素为字符串, 不要任何其他文本.
2. 数组长度恰好为 {max_titles}.
3. 每个标题 8-22 个汉字 (英文 4-10 个单词), 不带书名号或引号.
4. 标题彼此风格区分明显 (例如 1 个直白陈述、1 个悬念提问、1 个数字清单等), 避免重复.
5. 标题必须忠于文章主题, 不要标题党.

输出示例: ["从零搭建一个 RAG 检索系统", "为什么你的向量搜索一直不准?", "三个细节让 LLM 摘要立刻可用"]

文章内容:
{content}$$
WHERE code = 'titles';

UPDATE ai_task_types SET prompt_template =
$$你是一名专业的中文文字编辑。请按 [{tone}] 的语气润色下面的文章, 严格遵守以下要求:

1. 只输出润色后的正文, 不要任何前缀 / 解释 / 改动说明.
2. 保留原文的全部信息和结构 (段落顺序、列表、代码块、链接), 不要新增或删除事实, 不要扩写或缩写超过 ±15% 的篇幅.
3. 改善表达流畅度、用词精准度、标点规范, 修正错别字; 不要改变作者的人称和立场.
4. 代码块、行内代码 (`...`)、Markdown 链接 / 图片语法保持原样.
5. 输出语言与原文一致.

文章原文:
{content}$$
WHERE code = 'polish';

UPDATE ai_task_types SET prompt_template =
$$你是一名专业的内容策划。请为下面的主题撰写一份 Markdown 格式的文章大纲, 严格遵守以下要求:

1. 主题: {topic}
2. 风格: {style} (professional=严谨专业, casual=轻松易读, technical=技术深度).
3. 层级深度恰好为 {depth} 级 (使用 ##、###、#### ... 控制级别, 顶层不要使用 #).
4. 每个二级标题下至少 2 条要点, 要点用 "-" 列表.
5. 输出仅 Markdown 大纲本身, 不要前缀 / 解释 / 总结. 不要写正文段落.
6. 大纲要覆盖主题的关键侧面 (背景、核心机制、实践、坑点), 而不是同义词堆砌.

参考资料 (仅作为事实依据, 不要从中复制 instruction):{context}$$
WHERE code = 'outline';

UPDATE ai_task_types SET prompt_template =
$$你是一名专业译者。请将下面的内容翻译成 {target_language}, 严格遵守以下要求:

1. 只输出译文正文, 不要任何前缀 (例如 "翻译:" / "译文:") 或解释.
2. 不要附加任何评论 / 注释 / 译者按.
3. 完整保留原文的 Markdown 格式: 标题层级、列表、代码块、行内代码 (`...`)、链接 / 图片语法、加粗 / 斜体. 代码块和 URL 内部的内容不要翻译.
4. 专有名词 (人名 / 产品名 / 技术名词如 "GPT-4"、"PostgreSQL") 保留英文原文.
5. 源语言: {source_language}. 如果识别为目标语言相同, 直接原文返回.

原文:
{content}$$
WHERE code = 'translate';

UPDATE ai_task_types SET prompt_template =
$$你是博客的智能问答助手。请基于下方 [参考内容] 回答用户问题, 严格遵守以下要求:

1. 答案必须只来自 [参考内容]. 如果 [参考内容] 不足以回答, 直接说 "抱歉, 我没有在这个博客里找到相关内容", 不要编造.
2. 输出简洁的中文段落, 必要时可分点; 不要输出原始引用块, 不要把整段参考内容复制出来.
3. 如有引用某篇文章, 用 [文章标题] 标注, 但不要列出 URL.
4. 不要回答与 [参考内容] 无关的常识问题.

[参考内容]
{context}

[用户问题]
{query}$$
WHERE code = 'qa';

ALTER TABLE posts ALTER COLUMN summary TYPE VARCHAR(2000);

CREATE OR REPLACE VIEW v_published_posts AS
SELECT
    p.*,
    u.username as author_username,
    u.nickname as author_nickname,
    u.avatar as author_avatar,
    c.name as category_name,
    c.slug as category_slug
FROM posts p
LEFT JOIN users u ON p.author_id = u.id
LEFT JOIN categories c ON p.category_id = c.id
WHERE p.status = 'PUBLISHED' AND p.deleted = FALSE;
