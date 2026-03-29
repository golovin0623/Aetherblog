-- ============================================================
-- Activity Events Table
-- ============================================================
-- Flyway Migration: V2_17__activity_events.sql
-- Author: AetherBlog Team
-- Date: 2026-02-09
-- Description: 活动事件记录表，用于仪表盘"最近动态"展示
-- ============================================================

-- 活动事件表
CREATE TABLE IF NOT EXISTS activity_events (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,           -- 事件类型代码 (如 POST_PUBLISH, COMMENT_NEW)
    event_category VARCHAR(20) NOT NULL,       -- 事件分类: post/comment/user/system/friend/media/ai
    title VARCHAR(200) NOT NULL,               -- 事件标题 (展示用)
    description TEXT,                          -- 事件描述/详情
    metadata JSONB,                            -- 扩展元数据 (如 postId, commentId, fileName 等)
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, -- 触发用户 (可为空，系统事件无用户)
    ip VARCHAR(50),                            -- IP 地址
    status VARCHAR(20) NOT NULL DEFAULT 'INFO', -- 状态: INFO/SUCCESS/WARNING/ERROR
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_activity_event_category CHECK (event_category IN ('post', 'comment', 'user', 'system', 'friend', 'media', 'ai')),
    CONSTRAINT chk_activity_event_status CHECK (status IN ('INFO', 'SUCCESS', 'WARNING', 'ERROR'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_activity_events_type ON activity_events(event_type);
CREATE INDEX IF NOT EXISTS idx_activity_events_category ON activity_events(event_category);
CREATE INDEX IF NOT EXISTS idx_activity_events_created ON activity_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_user ON activity_events(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_status ON activity_events(status);

-- 添加注释
COMMENT ON TABLE activity_events IS '系统活动事件记录表';
COMMENT ON COLUMN activity_events.event_type IS '事件类型代码，如 POST_PUBLISH, COMMENT_NEW, USER_LOGIN';
COMMENT ON COLUMN activity_events.event_category IS '事件分类：post/comment/user/system/friend/media/ai';
COMMENT ON COLUMN activity_events.title IS '事件标题，用于前端展示';
COMMENT ON COLUMN activity_events.description IS '事件详细描述';
COMMENT ON COLUMN activity_events.metadata IS 'JSON格式扩展数据，存储 postId, commentId 等关联信息';
COMMENT ON COLUMN activity_events.status IS '事件状态：INFO(信息)/SUCCESS(成功)/WARNING(警告)/ERROR(错误)';
