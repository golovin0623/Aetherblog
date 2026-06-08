-- 回滚：移除欢迎页补充设置项。
-- 仅删除本 migration 引入的 5 个键，不触碰 000002 早已 seed 的
-- welcome_enabled / welcome_title / welcome_subtitle。
DELETE FROM site_settings WHERE setting_key IN (
    'welcome_description',
    'welcome_primary_btn_text',
    'welcome_primary_btn_link',
    'welcome_secondary_btn_text',
    'welcome_secondary_btn_link'
);
