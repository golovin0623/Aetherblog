INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES
  ('theme_visual_color_mode', 'preset', 'STRING', 'appearance', '主题配色方案：preset | auto | follow | custom'),
  ('theme_visual_color_light', '', 'STRING', 'appearance', '亮色主题视觉光源，自定义模式下生效'),
  ('theme_visual_color_dark', '', 'STRING', 'appearance', '暗色主题视觉光源，自定义模式下生效')
ON CONFLICT (setting_key) DO NOTHING;
