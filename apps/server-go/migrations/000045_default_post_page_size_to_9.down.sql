-- 回滚 000045：把 '9' 改回 '10'，仅当当前值是 '9' 时执行。
--
-- ⚠️ 已知不对称（codex review #571 P2）：默认值类 migration 的 down 无法
-- 严格逆 up。考虑这一情况：
--   · 实例 X 在 045 之前就由站长手动设成 '9'
--   · 045 up 跑：WHERE setting_value = '10' 不命中，X 不动 ✓
--   · 后续 rollback 跑 045 down：WHERE setting_value = '9' 命中，
--     X 被改成 '10' —— 但站长本意是 '9'
--
-- 想严格区分"045 改的 9"与"用户原本就有的 9"需要 migration 审计表
-- 或在 site_settings 加 source 字段，成本远高于本 migration 的收益。
--
-- 当前权衡：
--   · 大多数场景（站点未自定义此项）—— 045 up 把 '10' → '9'，
--     down 把 '9' → '10'，对称且符合预期。
--   · 边缘场景（站点本就是 '9'）—— 回滚后会"被退回 '10'"。如有这类
--     部署，rollback 后请手动校对 site_settings.post_page_size 并恢复
--     成 '9'。
--
-- 如果你正在 rollback 出于 emergency，建议事前 dump
-- `SELECT * FROM site_settings WHERE setting_key = 'post_page_size'`
-- 留作 truth source。

UPDATE site_settings
SET setting_value = '10'
WHERE setting_key = 'post_page_size'
  AND setting_value = '9';
