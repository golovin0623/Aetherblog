-- 000037 是纯数据修复 (UPDATE site_settings 一行), 没有 schema 变化.
-- 回滚意味着把指针改回 'text-embedding-3-small' 这个孤儿值, 反而会把部署推回
-- 语义搜索全空的坏状态——没有任何回滚价值. no-op.
SELECT 1;
