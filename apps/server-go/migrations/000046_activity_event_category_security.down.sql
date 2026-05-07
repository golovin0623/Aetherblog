-- 回滚：把 event_category 白名单恢复到 000022 的 7 类。
-- 注意：若线上已有 event_category='security' 的行，回滚会因 CHECK 失败。
-- 回滚前需先：
--   DELETE FROM activity_events WHERE event_category = 'security';
-- 或者把这些行的 category 改成 'system'。

ALTER TABLE activity_events DROP CONSTRAINT IF EXISTS chk_activity_event_category;

ALTER TABLE activity_events
    ADD CONSTRAINT chk_activity_event_category
    CHECK (event_category IN ('post', 'comment', 'user', 'system', 'friend', 'media', 'ai'));

COMMENT ON COLUMN activity_events.event_category IS '事件分类：post/comment/user/system/friend/media/ai';
