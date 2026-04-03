-- 添加字体选择设置
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES ('font_family', 'system', 'STRING', 'appearance', '全局字体：system(默认) | serif-elegant(优雅衬线) | lora | merriweather')
ON CONFLICT (setting_key) DO NOTHING;
