-- ============================================================
-- AetherBlog V1.1.0 种子数据
-- ============================================================
-- Flyway Migration: V1_1__seed_data.sql
-- 说明：初始化站点设置与默认管理员账户
-- ============================================================

-- ============================================================
-- 默认管理员账户
-- 密码：admin123（BCrypt 加密）
-- 首次登录必须修改密码
-- ============================================================
INSERT INTO users (username, email, password_hash, nickname, role, status, must_change_password) 
VALUES (
    'admin',
    'admin@aetherblog.local',
    '$2a$10$1B6fti5pzyTwI58rszwobe/Lpbe2GUzhUk7xVlkGe8kpTckIPsdHe',
    '管理员',
    'ADMIN',
    'ACTIVE',
    TRUE
) ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- 站点设置
-- ============================================================

-- 通用设置
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

-- 作者设置
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('author_name', 'AetherBlog 博主', 'STRING', 'author', '博主名称'),
    ('author_avatar', '', 'STRING', 'author', '博主头像'),
    ('author_bio', '热爱技术，热爱生活', 'TEXT', 'author', '博主简介'),
    ('author_github', '', 'STRING', 'author', 'GitHub地址'),
    ('author_twitter', '', 'STRING', 'author', 'Twitter地址'),
    ('author_email', '', 'STRING', 'author', '联系邮箱')
ON CONFLICT (setting_key) DO NOTHING;

-- 评论设置
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('comment_enabled', 'true', 'BOOLEAN', 'comment', '是否启用评论'),
    ('comment_audit', 'true', 'BOOLEAN', 'comment', '评论是否需要审核')
ON CONFLICT (setting_key) DO NOTHING;

-- 存储设置
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('storage_type', 'LOCAL', 'STRING', 'storage', '存储类型: LOCAL, MINIO, COS')
ON CONFLICT (setting_key) DO NOTHING;

-- AI 设置
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('ai_enabled', 'true', 'BOOLEAN', 'ai', '是否启用AI功能'),
    ('ai_provider', 'openai', 'STRING', 'ai', 'AI服务提供商')
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================
-- 默认分类
-- ============================================================
INSERT INTO categories (name, slug, description, sort_order)
VALUES ('默认分类', 'default', '默认分类，存放未归档文章', 0)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 默认标签
-- ============================================================
INSERT INTO tags (name, slug, color, post_count)
VALUES ('Hello World', 'hello-world', 'blue', 1)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Hello World 文章
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

-- 关联文章与标签
INSERT INTO post_tags (post_id, tag_id)
SELECT p.id, t.id
FROM posts p, tags t
WHERE p.slug = 'hello-world' AND t.slug = 'hello-world'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 友情链接
-- ============================================================
INSERT INTO friend_links (name, url, logo, description, theme_color, sort_order, visible) VALUES
    ('Google', 'https://www.google.com', 'https://www.gstatic.com/images/branding/product/2x/googleg_48dp.png', '全球最大的搜索引擎，提供网页、图片、视频等多种搜索服务', '#4285F4', 1, TRUE),
    ('GitHub', 'https://github.com', 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png', '全球最大的代码托管平台，开源社区的家园', '#24292e', 2, TRUE),
    ('OpenAI', 'https://openai.com', 'https://cdn.oaistatic.com/assets/favicon-o20kmmos.svg', 'AI 研究实验室，ChatGPT、GPT-4、DALL·E 的创造者', '#10A37F', 3, TRUE),
    ('Apple', 'https://www.apple.com', 'https://upload.wikimedia.org/wikipedia/commons/1/1b/Apple_logo_grey.svg', '创新科技公司，iPhone、Mac、iPad 的缔造者', '#555555', 4, TRUE),
    ('Microsoft', 'https://www.microsoft.com', 'https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg', '全球领先的软件公司，Windows、Office、Azure 的开发者', '#00A4EF', 5, TRUE),
    ('百度', 'https://www.baidu.com', 'https://www.baidu.com/favicon.ico', '中国最大的搜索引擎，提供搜索、AI、云服务等', '#2932E1', 6, TRUE)
ON CONFLICT DO NOTHING;
