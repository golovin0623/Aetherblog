-- 回滚 000056：清空 SYSTEM_POSTS 库的 active_profile_id 指针并删除 default profile。
-- kb_profiles 表本身在 000055.down 中删除。

DO $$
DECLARE
    posts_kb_id BIGINT;
BEGIN
    SELECT id INTO posts_kb_id FROM knowledge_bases WHERE slug = 'posts' LIMIT 1;
    IF posts_kb_id IS NOT NULL THEN
        UPDATE knowledge_bases SET active_profile_id = NULL WHERE id = posts_kb_id;
        DELETE FROM kb_profiles WHERE kb_id = posts_kb_id AND code = 'default';
    END IF;
END $$;
