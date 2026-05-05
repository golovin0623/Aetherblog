-- 把 post_page_size 默认值从 10 调整为 9。
--
-- 缘由：/posts 文章列表页"最新发布"网格在 lg 断点是 grid-cols-3。
-- 默认 10 → 3+3+3+1 末行单独一张卡，视觉破洞；9 → 3 行整齐。
--
-- 本 migration 是默认值变更的唯一路径，覆盖两类部署：
--   · 全新安装：000013 先 INSERT '10'，本 migration 再 UPDATE 到 '9'，
--     幂等。最终 site_settings.post_page_size = '9'。
--   · 存量部署：仅当当前值仍是初始默认 '10'（用户没在后台改过）时才
--     覆盖。已自定义为 5 / 12 / 其他值的实例完全不动。
--
-- 不修改 000013 line 18 的字面值 —— 严守"已发布 migration 不可变"约定。
-- 本 migration 在两类部署路径上都收敛到同一个 '9'，没有改 000013 的必要。

UPDATE site_settings
SET setting_value = '9'
WHERE setting_key = 'post_page_size'
  AND setting_value = '10';
