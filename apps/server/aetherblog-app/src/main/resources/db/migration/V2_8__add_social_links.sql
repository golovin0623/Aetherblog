-- ============================================================
-- AetherBlog V2.8.0 - Add Social Links JSON Setting
-- ============================================================
-- Flyway Migration: V2_8__add_social_links.sql
-- Description: Add social_links JSON field for dynamic social links
-- ============================================================

-- Author Settings - Social Links (JSON array)
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('social_links', '[]', 'JSON', 'author', '社交链接列表')
ON CONFLICT (setting_key) DO NOTHING;
