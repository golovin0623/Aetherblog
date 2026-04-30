-- 回滚到 000038 假定成功的状态: posts.summary 回到 VARCHAR(500), view 重建.
-- prompt_template 不在 down 范围内 —— down migration 不撤销数据修改 (这是
-- 跟 000038.down.sql 风格冲突, 但回滚 prompt 没意义: 旧 prompt 让 AI 输出
-- 冗长问答是用户当初要修复的问题, 没人会真心想 down 回去).

DROP VIEW IF EXISTS v_published_posts;

-- USING SUBSTRING 在数据已经超过 500 字符 (即 up 跑过后写过长摘要) 时,
-- 安全截断而不是 "value too long for type character varying(500)" 直接 FAIL.
-- down migration 的语义是 "尽力回滚", 调用方本来就接受可能的有损操作;
-- 失败比截断更糟 —— 会卡死整个回滚链.
ALTER TABLE posts ALTER COLUMN summary TYPE VARCHAR(500)
    USING SUBSTRING(summary FROM 1 FOR 500);

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
