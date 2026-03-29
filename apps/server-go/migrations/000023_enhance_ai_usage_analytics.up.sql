-- AI 使用埋点增强：支持任务、模型、供应商、成本与聚合分析

ALTER TABLE ai_usage_logs
    ADD COLUMN IF NOT EXISTS task_type VARCHAR(64),
    ADD COLUMN IF NOT EXISTS provider_code VARCHAR(64),
    ADD COLUMN IF NOT EXISTS model_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS total_tokens INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(16, 8) NOT NULL DEFAULT 0;

-- 回填基础字段，兼容历史数据
UPDATE ai_usage_logs
SET task_type = COALESCE(task_type, NULLIF(SPLIT_PART(TRIM(BOTH '/' FROM endpoint), '/', 4), '')),
    provider_code = COALESCE(provider_code, NULLIF(SPLIT_PART(model, '/', 1), '')),
    model_id = COALESCE(
            model_id,
            CASE
                WHEN POSITION('/' IN model) > 0 THEN SPLIT_PART(model, '/', 2)
                ELSE model
                END
               ),
    total_tokens = COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)
WHERE task_type IS NULL
   OR provider_code IS NULL
   OR model_id IS NULL
   OR total_tokens = 0;

-- 按模型单价回填历史成本（存在多个供应商时优先匹配 provider_code）
UPDATE ai_usage_logs l
SET estimated_cost = COALESCE((
                                  SELECT ROUND(
                                                 (COALESCE(l.tokens_in, 0) / 1000.0) * COALESCE(m.input_cost_per_1k, 0)
                                                     + (COALESCE(l.tokens_out, 0) / 1000.0) * COALESCE(m.output_cost_per_1k, 0),
                                                 8
                                         )
                                  FROM ai_models m
                                           JOIN ai_providers p ON p.id = m.provider_id
                                  WHERE m.model_id = l.model_id
                                    AND (l.provider_code IS NULL OR l.provider_code = '' OR p.code = l.provider_code)
                                  ORDER BY CASE WHEN p.code = l.provider_code THEN 0 ELSE 1 END
                                  LIMIT 1
                              ), 0)
WHERE COALESCE(l.estimated_cost, 0) = 0;

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_task_created ON ai_usage_logs(task_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_model_created ON ai_usage_logs(model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_provider_created ON ai_usage_logs(provider_code, created_at DESC);
