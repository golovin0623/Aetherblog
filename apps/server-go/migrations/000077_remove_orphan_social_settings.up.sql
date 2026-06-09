-- ============================================================
-- AetherBlog - 清理遗留孤儿社交设置键
-- ============================================================
-- 背景：早期版本(000002 / 000013)曾 seed 一组「单字段社交链接」键,后被
-- author 分组下的 social_links(JSON 数组,000014)完全取代。这些旧键在后台
-- 没有任何 UI 入口、博客前台也零消费,属于纯遗留孤儿数据,并会出现在公开
-- /site/info 响应里造成噪音。此处统一删除,白名单已同步移除其可写权限。
--
-- 仅删除确认零消费的 6 个孤儿键;不触碰 social_links(真实生效)。
-- 数据安全(PR 评审「Preserve legacy social link values during migration」):只删除
-- 空值/NULL 行——这些键此前可写,若某实例曾通过旧 API 写入过真实地址,则保留不删,
-- 避免一次性迁移造成数据丢失。绝大多数实例为默认空值,正常会被清理。
-- 幂等:DELETE ... IN (...) 重跑安全。
DELETE FROM site_settings
WHERE setting_key IN (
    'author_github',
    'author_twitter',
    'social_github',
    'social_twitter',
    'social_linkedin',
    'social_weibo'
)
  AND (setting_value IS NULL OR setting_value = '');
