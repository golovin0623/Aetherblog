DELETE FROM site_settings
WHERE setting_key IN (
  'theme_visual_color_mode',
  'theme_visual_color_light',
  'theme_visual_color_dark'
);
