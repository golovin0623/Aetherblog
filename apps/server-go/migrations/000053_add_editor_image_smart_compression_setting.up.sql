INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES ('editor_image_smart_compression_enabled', 'false', 'BOOLEAN', 'advanced', '文章编辑器图片上传超过 5MB 时自动智能压缩')
ON CONFLICT (setting_key) DO NOTHING;
