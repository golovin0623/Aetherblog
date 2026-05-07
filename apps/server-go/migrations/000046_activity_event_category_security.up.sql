-- ============================================================
-- 扩展 activity_events.event_category CHECK 约束
-- ============================================================
-- 背景：
--   1) 000022_activity_events 创建表时只允许 7 类
--      (post/comment/user/system/friend/media/ai)；
--   2) 后续 auth_handler.go RotateJWTSecret 直接写入
--      event_category='security'（前端 ActivitiesPage 也已展示「安全」分类），
--      在生产环境会被原约束静默拒绝 → 这条审计落不进 DB；
--   3) 同时为 AI 模块新增的 `ai.generation` / `ai.prompt_update` /
--      `ai.task_*` / `ai.agent_chat` 事件做兜底 —— 它们仍归类 'ai'，
--      不需要新增分类，只是确认 'ai' 仍在白名单里。
--
-- 本迁移仅放宽分类白名单 (新增 'security')，不动 status 约束。
-- 若行内已存在脏数据 (理论上不会，因为 CHECK 一直把 'security' 拦在外面)，
-- 重建 CHECK 时会立刻报错；这是期望行为。
-- ============================================================

ALTER TABLE activity_events DROP CONSTRAINT IF EXISTS chk_activity_event_category;

ALTER TABLE activity_events
    ADD CONSTRAINT chk_activity_event_category
    CHECK (event_category IN ('post', 'comment', 'user', 'system', 'friend', 'media', 'ai', 'security'));

COMMENT ON COLUMN activity_events.event_category IS '事件分类：post/comment/user/system/friend/media/ai/security';
