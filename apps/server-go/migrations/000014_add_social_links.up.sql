-- ============================================================
-- AetherBlog V2.8.0 - 添加社交链接 JSON 设置
-- ============================================================
-- Flyway Migration: V2_8__add_social_links.sql
-- 说明：为动态社交链接添加 social_links JSON 字段
-- ============================================================

-- 作者设置 - 社交链接（JSON 数组）
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('social_links', '[]', 'JSON', 'author', '社交链接列表')
ON CONFLICT (setting_key) DO NOTHING;
