-- 单独配置媒体备份同步目标 provider。
--
-- 000043 初版同步逻辑把 default provider 同时当作"上传主存储"和"备份目标",
-- 导致本地主存储场景下无法把文件备份到已配置的云存储。该设置把两者拆开:
--   - storage_providers.is_default 继续表示新上传文件的主存储
--   - storage.sync.target_provider_id 表示自动/手动备份同步的默认目标

INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES (
    'storage.sync.target_provider_id',
    '',
    'NUMBER',
    'storage',
    '媒体备份同步目标 provider ID; 空表示兼容使用非 LOCAL 默认 provider'
)
ON CONFLICT (setting_key) DO NOTHING;
