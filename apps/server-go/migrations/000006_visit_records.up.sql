-- 访客统计系统数据表
-- 用于记录博客访问数据，支持独立访客统计和访问趋势分析

-- 访问记录表已在 V1__init_schema.sql 中创建
-- 这里只添加缺少的字段

-- 添加 is_bot 字段（标记爬虫/机器人访问）
ALTER TABLE visit_records ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE;

-- 日统计汇总表（长期保留，用于趋势图）
CREATE TABLE IF NOT EXISTS visit_daily_stats (
    id BIGSERIAL PRIMARY KEY,
    stat_date DATE NOT NULL,
    pv INT DEFAULT 0,                        -- 页面浏览量 (Page Views)
    uv INT DEFAULT 0,                        -- 独立访客数 (Unique Visitors)
    new_visitors INT DEFAULT 0,              -- 新访客数
    bot_visits INT DEFAULT 0,                -- 爬虫访问数
    country_stats JSONB,                     -- 国家/地区分布统计
    UNIQUE(stat_date)
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_visit_daily_stats_date ON visit_daily_stats(stat_date);

-- 注释
COMMENT ON TABLE visit_daily_stats IS '日统计汇总表，用于趋势图展示，长期保留';
COMMENT ON COLUMN visit_records.is_bot IS '是否为爬虫/机器人访问';
