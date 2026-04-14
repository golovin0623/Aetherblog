-- 搜索配置：新增单篇索引超时可调项（秒）
-- Go 后端每次批次开始时读取最新值，保存后立即生效。

INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES
    ('search.index_post_timeout_sec', '180', 'NUMBER', 'search', '单篇文章索引超时（秒），Go/AI service 两端共用')
ON CONFLICT (setting_key) DO NOTHING;
