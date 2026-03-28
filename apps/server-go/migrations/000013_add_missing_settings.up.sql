-- ============================================================
-- AetherBlog V1.2.0 - Add Missing Site Settings
-- ============================================================
-- Flyway Migration: V1_2__add_missing_settings.sql
-- Description: Add missing settings for frontend SettingsPage
-- ============================================================

-- General Settings (missing)
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('site_url', '', 'STRING', 'general', '站点URL')
ON CONFLICT (setting_key) DO NOTHING;

-- Appearance Settings
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('theme_primary_color', '#6366f1', 'STRING', 'appearance', '主色调'),
    ('enable_dark_mode', 'true', 'BOOLEAN', 'appearance', '强制暗黑模式'),
    ('show_banner', 'true', 'BOOLEAN', 'appearance', '显示首页Banner'),
    ('post_page_size', '10', 'NUMBER', 'appearance', '每页文章数'),
    ('custom_css', '', 'TEXT', 'appearance', '自定义CSS')
ON CONFLICT (setting_key) DO NOTHING;

-- SEO Settings
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('seo_robots', 'User-agent: *\nAllow: /', 'TEXT', 'seo', 'Robots.txt内容'),
    ('enable_sitemap', 'true', 'BOOLEAN', 'seo', '启用Sitemap'),
    ('baidu_analytics_id', '', 'STRING', 'seo', '百度统计ID'),
    ('google_analytics_id', '', 'STRING', 'seo', 'Google Analytics ID')
ON CONFLICT (setting_key) DO NOTHING;

-- Social Settings
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('social_github', '', 'STRING', 'social', 'GitHub地址'),
    ('social_twitter', '', 'STRING', 'social', 'Twitter地址'),
    ('social_linkedin', '', 'STRING', 'social', 'LinkedIn地址'),
    ('social_weibo', '', 'STRING', 'social', '微博地址')
ON CONFLICT (setting_key) DO NOTHING;

-- Advanced Settings (missing)
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('enable_registrations', 'false', 'BOOLEAN', 'advanced', '允许用户注册'),
    ('upload_max_size', '10', 'NUMBER', 'advanced', '最大上传大小(MB)')
ON CONFLICT (setting_key) DO NOTHING;
