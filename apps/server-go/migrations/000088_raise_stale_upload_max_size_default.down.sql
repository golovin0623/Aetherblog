-- 回滚：把 upload_max_size 从 '100' 放回旧种子 '10'。
--
-- ⚠️ 无法区分"本迁移抬上去的 100"与"管理员自己填的 100"，回滚会把两者一起压回 10。
-- 这是 up 方向做数据收敛的固有代价；生产环境回滚前请先确认当前值是否被人工改过。
UPDATE site_settings
SET setting_value = '10', updated_at = NOW()
WHERE setting_key = 'upload_max_size'
  AND setting_value = '100';
