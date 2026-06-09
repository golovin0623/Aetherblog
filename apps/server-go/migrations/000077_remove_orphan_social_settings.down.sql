-- 回滚：按原始分组重新 seed 这些遗留社交键（空值），仅用于恢复到删除前的结构。
-- 与历史 seed(000002/000013)保持一致的 group_name/setting_type。
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('author_github', '', 'STRING', 'author', 'GitHub地址'),
    ('author_twitter', '', 'STRING', 'author', 'Twitter地址'),
    ('social_github', '', 'STRING', 'social', 'GitHub地址'),
    ('social_twitter', '', 'STRING', 'social', 'Twitter地址'),
    ('social_linkedin', '', 'STRING', 'social', 'LinkedIn地址'),
    ('social_weibo', '', 'STRING', 'social', '微博地址')
ON CONFLICT (setting_key) DO NOTHING;
