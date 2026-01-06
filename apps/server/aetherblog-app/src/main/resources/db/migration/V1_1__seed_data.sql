-- ============================================================
-- AetherBlog V1.1.0 Seed Data
-- ============================================================
-- Flyway Migration: V1_1__seed_data.sql
-- Description: Initial site settings and default admin user
-- ============================================================

-- ============================================================
-- DEFAULT ADMIN USER
-- Password: admin123 (BCrypt encoded)
-- MUST CHANGE PASSWORD ON FIRST LOGIN
-- ============================================================
INSERT INTO users (username, email, password_hash, nickname, role, status, must_change_password) 
VALUES (
    'admin',
    'admin@aetherblog.local',
    '$2a$10$N.zmdr9k7uOCQb376NoUnuTJ8iAt6Z5EHsM8lE9o3DLPe4YpLwqKi',
    '管理员',
    'ADMIN',
    'ACTIVE',
    TRUE
) ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- SITE SETTINGS
-- ============================================================

-- General Settings
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('site_name', 'AetherBlog', 'STRING', 'general', '站点名称'),
    ('site_description', '一个优雅的技术博客', 'STRING', 'general', '站点描述'),
    ('site_keywords', '技术博客,编程,开发,Java,Spring', 'STRING', 'general', '站点关键词'),
    ('site_logo', '', 'STRING', 'general', '站点Logo'),
    ('site_favicon', '', 'STRING', 'general', '站点Favicon'),
    ('footer_text', '© 2026 AetherBlog. All rights reserved.', 'TEXT', 'general', '页脚文字'),
    ('footer_signature', '记录技术，分享生活', 'STRING', 'general', '个性签名'),
    ('icp_number', '', 'STRING', 'general', 'ICP备案号'),
    ('welcome_enabled', 'true', 'BOOLEAN', 'general', '是否启用欢迎页'),
    ('welcome_title', '欢迎来到我的博客', 'STRING', 'general', '欢迎页标题'),
    ('welcome_subtitle', '记录技术，分享生活', 'STRING', 'general', '欢迎页副标题')
ON CONFLICT (setting_key) DO NOTHING;

-- Author Settings
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('author_name', 'AetherBlog 博主', 'STRING', 'author', '博主名称'),
    ('author_avatar', '', 'STRING', 'author', '博主头像'),
    ('author_bio', '热爱技术，热爱生活', 'TEXT', 'author', '博主简介'),
    ('author_github', '', 'STRING', 'author', 'GitHub地址'),
    ('author_twitter', '', 'STRING', 'author', 'Twitter地址'),
    ('author_email', '', 'STRING', 'author', '联系邮箱')
ON CONFLICT (setting_key) DO NOTHING;

-- Comment Settings
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('comment_enabled', 'true', 'BOOLEAN', 'comment', '是否启用评论'),
    ('comment_audit', 'true', 'BOOLEAN', 'comment', '评论是否需要审核')
ON CONFLICT (setting_key) DO NOTHING;

-- Storage Settings
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('storage_type', 'LOCAL', 'STRING', 'storage', '存储类型: LOCAL, MINIO, COS')
ON CONFLICT (setting_key) DO NOTHING;

-- AI Settings
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('ai_enabled', 'true', 'BOOLEAN', 'ai', '是否启用AI功能'),
    ('ai_provider', 'openai', 'STRING', 'ai', 'AI服务提供商')
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================
-- DEFAULT CATEGORY
-- ============================================================
INSERT INTO categories (name, slug, description, sort_order)
VALUES ('默认分类', 'default', '默认分类，存放未归档文章', 0)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- DEFAULT TAG
-- ============================================================
INSERT INTO tags (name, slug, color, post_count)
VALUES ('Hello World', 'hello-world', 'blue', 1)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- HELLO WORLD POST
-- ============================================================
INSERT INTO posts (title, slug, content_markdown, summary, status, view_count, comment_count, like_count, published_at, category_id, author_id)
SELECT 
    'Hello World', 
    'hello-world', 
    E'# Hello World\n\n欢迎使用 **AetherBlog**！\n\n这是系统自动生成的第一篇文章。\n\n您可以在后台编辑或删除它，开始您的写作之旅吧！\n\n## 功能特性\n\n- ✨ **现代化设计**: 采用最新的设计语言\n- 🚀 **高性能**: 基于 Spring Boot 3.4 和 React 19\n- 🤖 **AI 驱动**: 集成智能写作助手\n\n祝您使用愉快！', 
    'AetherBlog 的第一篇文章', 
    'PUBLISHED', 
    0, 0, 0, 
    CURRENT_TIMESTAMP, 
    c.id,
    u.id
FROM categories c, users u
WHERE c.slug = 'default' AND u.username = 'admin'
ON CONFLICT (slug) DO NOTHING;

-- Link post to tag
INSERT INTO post_tags (post_id, tag_id)
SELECT p.id, t.id
FROM posts p, tags t
WHERE p.slug = 'hello-world' AND t.slug = 'hello-world'
ON CONFLICT DO NOTHING;
