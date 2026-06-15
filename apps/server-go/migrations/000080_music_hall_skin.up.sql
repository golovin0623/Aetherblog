-- ============================================================
-- AetherBlog - 音乐大厅皮肤(站点默认)
-- ============================================================
-- 背景：音乐大厅前台/后台原本把配色写死为暗红,既不跟随明暗主题,也不走设计系统
-- 「一个光源,四色派生」。本次接入作用域皮肤系统(packages/ui/src/styles/music-skin.css):
-- 管理员可设站点默认音乐皮肤(预设 id 或自定义亮/暗光源种子),前台访客可本地临时覆盖。
-- 本 migration 仅给单行 music_settings 表追加皮肤配置列。
--
-- 红线:不修改已冻结的 000079;新增列幂等(ADD COLUMN IF NOT EXISTS),
-- 单事务安全;NOT NULL 列带 DEFAULT,存量行(id=1)自动回填,升级后视觉零变化。
ALTER TABLE music_settings ADD COLUMN IF NOT EXISTS skin_mode VARCHAR(20) NOT NULL DEFAULT 'preset';
ALTER TABLE music_settings ADD COLUMN IF NOT EXISTS skin_preset VARCHAR(40) NOT NULL DEFAULT 'crimson';
ALTER TABLE music_settings ADD COLUMN IF NOT EXISTS skin_color_light VARCHAR(32);
ALTER TABLE music_settings ADD COLUMN IF NOT EXISTS skin_color_dark VARCHAR(32);
