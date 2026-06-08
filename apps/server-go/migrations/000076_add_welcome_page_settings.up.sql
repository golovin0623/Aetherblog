-- ============================================================
-- AetherBlog - 补齐欢迎页设置项
-- ============================================================
-- 背景：后台「系统设置 → 欢迎页设置」UI 早已提供「欢迎描述」和主/副行动按钮
-- 的文案与链接共 5 个字段，博客前台首页 Hero 区(apps/blog/app/page.tsx)也已读取
-- 这些键。但它们既未在 site_settings 里 seed，也不在后端写入白名单
-- (allowedSettingKeys) 中——导致管理员保存时被静默丢弃，前台永远落回硬编码默认值，
-- 形成「能编辑、能点保存、但永不生效」的纯架子。
--
-- 本 migration 补齐 seed；白名单已在 site_setting_handler.go 同步补齐。
-- 默认值与前台 page.tsx 的 fallback 保持一致，保证升级后视觉零变化。
-- 幂等：ON CONFLICT DO NOTHING，重跑安全；存量已被改过的值不受影响。
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('welcome_description', '智能写作、语义搜索、优雅呈现', 'TEXT', 'general', '欢迎页描述文字'),
    ('welcome_primary_btn_text', '浏览文章', 'STRING', 'general', '欢迎页主按钮文案'),
    ('welcome_primary_btn_link', '/posts', 'STRING', 'general', '欢迎页主按钮链接'),
    ('welcome_secondary_btn_text', '关于我', 'STRING', 'general', '欢迎页副按钮文案'),
    ('welcome_secondary_btn_link', '/about', 'STRING', 'general', '欢迎页副按钮链接')
ON CONFLICT (setting_key) DO NOTHING;
