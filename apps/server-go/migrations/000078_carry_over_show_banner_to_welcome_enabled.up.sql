-- ============================================================
-- AetherBlog - 将 show_banner 隐藏意图迁移到 welcome_enabled
-- ============================================================
-- 背景：show_banner 已从后台 UI 收敛到 welcome_enabled（见同 PR 的 SettingsPage / page.tsx /
-- SiteSettingsProvider 改动，博客前台不再读取 show_banner）。为不让历史上通过
-- show_banner=false 隐藏欢迎页的站点在升级后欢迎页"复活"，这里把该意图一次性迁移过去：
-- 仅当 welcome_enabled 仍为开启('true') 且 show_banner 明确为 'false' 时，收敛为 'false'。
--
-- 一次性数据迁移（golang-migrate 仅执行一次）。默认安装 show_banner='true'，EXISTS 不命中即 no-op，
-- 全新实例与未改过 show_banner 的实例完全不受影响。
UPDATE site_settings
SET setting_value = 'false', updated_at = NOW()
WHERE setting_key = 'welcome_enabled'
  AND setting_value = 'true'
  AND EXISTS (
    SELECT 1 FROM site_settings sb
    WHERE sb.setting_key = 'show_banner' AND sb.setting_value = 'false'
  );
