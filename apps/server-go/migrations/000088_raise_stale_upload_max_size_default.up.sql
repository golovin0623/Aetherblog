-- ============================================================
-- AetherBlog - 抬高陈旧的 upload_max_size 种子默认值 (10MB → 100MB)
-- ============================================================
-- 背景：
--   000013 把 upload_max_size 种子值写成 '10'（单位 MB）。那时媒体库还只放文章配图，
--   10MB 够用。之后媒体库扩成"图片 / 视频 / 音频 / 文档"统一资源工作台：
--     - nginx 上传 location 给到 10G；
--     - 后端 maxUploadHardCeilingBytes 是 100MB；
--     - 后台设置页的说明写的是"绝对硬上限 100MB；留空或填 0 视为 100MB"。
--   只有这个 10 年久失修的种子值仍在默认拦掉一切 >10MB 的文件 —— 任何真实的
--   PPTX / 视频 / 带图 PDF 上传都会被 handler 以
--   "文件大小超过限制 (最大 10 MB)" 拒绝，而几十 KB 的 docx / txt 一切正常。
--   这正是"上传 PPT 失败、上传文本正常"的直接成因。
--
-- 语义：
--   把仍停留在旧种子值 '10' 的行抬到 '100'（与后端硬上限、与"留空视为 100MB"的
--   文案一致）。**只改还是旧种子的行** —— 管理员如果显式调过这个值（5 / 20 / 50 ...），
--   那是他的运维决定，不能被升级脚本覆盖。
--
--   代价是"管理员刚好手动填了 10"的极小概率场景会被一并抬到 100。相比"新装实例
--   默认传不了任何 PPT"，这个取舍是划算的：上限仍受后端 100MB 硬顶与 nginx 约束，
--   且管理员随时可在「设置 → 高级 → 最大上传 (MB)」改回去。
--
-- 幂等：UPDATE ... WHERE setting_value = '10'，重跑第二次已无匹配行，no-op。
UPDATE site_settings
SET setting_value = '100', updated_at = NOW()
WHERE setting_key = 'upload_max_size'
  AND setting_value = '10';

-- 兜底：极老的实例可能压根没有这一行（000013 之前建库又跳过了种子）。
-- 缺失时 handler 会回落到 100MB 硬上限，行为已经正确，但补齐一行能让后台设置页
-- 显示出真实生效值，避免"输入框空着但实际是 100"的困惑。
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description)
VALUES ('upload_max_size', '100', 'NUMBER', 'advanced', '最大上传大小(MB)')
ON CONFLICT (setting_key) DO NOTHING;
