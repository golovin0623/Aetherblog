-- ============================================================
-- 全局模型价格表
-- ref: §5.1 - AI Provider 配置 / 全局价格管理
-- ============================================================
-- 背景：
--   ai_models 中的价格按 (provider_id, model_id) 存储 —— 同一个 model_id
--   (例如 gpt-4o-mini) 在多个供应商下都有一份独立的价格行。
--   维护成本高、容易漂移；本表把价格按 model_id 字符串索引，
--   作为全局基准供「批量回填到所有同名 provider 模型」与
--   「在单条模型详情里一键从全局同步」两个场景使用。
--
--   pricing 字段保留 ai_models.capabilities.pricing 的 units 数组与扩展键，
--   保证高级价格 JSON（audioInput / cachedAudioInput / 自定义 units）也能被
--   全局集中维护。
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_global_pricing (
    id BIGSERIAL PRIMARY KEY,
    model_id VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(200),
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    input_cost_per_1m DECIMAL(14, 6),
    output_cost_per_1m DECIMAL(14, 6),
    cached_input_cost_per_1m DECIMAL(14, 6),
    pricing JSONB DEFAULT '{}'::jsonb,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_global_pricing_model_id ON ai_global_pricing(model_id);

COMMENT ON TABLE ai_global_pricing IS '全局模型价格基准：按 model_id 索引，可批量回填到 ai_models 同名行。';
COMMENT ON COLUMN ai_global_pricing.model_id IS '模型 ID 字符串（与 ai_models.model_id 对齐）。';
COMMENT ON COLUMN ai_global_pricing.pricing IS 'capabilities.pricing 风格的扩展 JSON，包含 units / 自定义键。';
