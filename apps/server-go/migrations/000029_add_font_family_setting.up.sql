-- 添加字体选择设置
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES ('font_family', 'system', 'STRING', 'appearance', '全局字体：system(默认) | serif-elegant(优雅衬线) | lora | merriweather')
ON CONFLICT (setting_key) DO NOTHING;

-- 将主色调拆分为亮色/暗色两个独立配置
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES ('theme_primary_color_light', '#18181b', 'STRING', 'appearance', '亮色主题主色调')
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES ('theme_primary_color_dark', '#818cf8', 'STRING', 'appearance', '暗色主题主色调')
ON CONFLICT (setting_key) DO NOTHING;
