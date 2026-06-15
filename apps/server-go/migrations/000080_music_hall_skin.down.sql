-- 回滚音乐大厅皮肤列(幂等)
ALTER TABLE music_settings DROP COLUMN IF EXISTS skin_color_dark;
ALTER TABLE music_settings DROP COLUMN IF EXISTS skin_color_light;
ALTER TABLE music_settings DROP COLUMN IF EXISTS skin_preset;
ALTER TABLE music_settings DROP COLUMN IF EXISTS skin_mode;
