-- 统一 ai_usage_logs 历史数据口径：空值、总 token 与成本回填，确保迁移幂等

-- 1) 清理空字符串，避免空值与空串混用
UPDATE ai_usage_logs
SET task_type = NULLIF(TRIM(task_type), ''),
    provider_code = NULLIF(TRIM(provider_code), ''),
    model_id = NULLIF(TRIM(model_id), '')
WHERE task_type IS NOT NULL
   OR provider_code IS NOT NULL
   OR model_id IS NOT NULL;

-- 2) 关键数值字段兜底，防止非法 NULL
UPDATE ai_usage_logs
SET request_chars = COALESCE(request_chars, 0),
    response_chars = COALESCE(response_chars, 0),
    tokens_in = COALESCE(tokens_in, 0),
    tokens_out = COALESCE(tokens_out, 0),
    latency_ms = COALESCE(latency_ms, 0),
    success = COALESCE(success, TRUE),
    cached = COALESCE(cached, FALSE),
    estimated_cost = COALESCE(estimated_cost, 0)
WHERE request_chars IS NULL
   OR response_chars IS NULL
   OR tokens_in IS NULL
   OR tokens_out IS NULL
   OR latency_ms IS NULL
   OR success IS NULL
   OR cached IS NULL
   OR estimated_cost IS NULL;

-- 3) 补齐 model_id，优先使用显式字段，回退 model 拆分
UPDATE ai_usage_logs
SET model_id = CASE
                   WHEN POSITION('/' IN model) > 0 THEN SPLIT_PART(model, '/', 2)
                   ELSE model
               END
WHERE (model_id IS NULL OR model_id = '')
  AND model IS NOT NULL
  AND model <> '';

-- 4) 按 model_id 推断唯一 provider_code
WITH model_provider AS (
    SELECT m.model_id,
           MIN(p.code) AS provider_code,
           COUNT(DISTINCT p.code) AS provider_count
    FROM ai_models m
             JOIN ai_providers p ON p.id = m.provider_id
    GROUP BY m.model_id
)
UPDATE ai_usage_logs l
SET provider_code = mp.provider_code
FROM model_provider mp
WHERE (l.provider_code IS NULL OR l.provider_code = '')
  AND l.model_id = mp.model_id
  AND mp.provider_count = 1;

-- 5) 补齐 total_tokens（优先使用显式值，否则回退 tokens_in + tokens_out）
UPDATE ai_usage_logs
SET total_tokens = COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)
WHERE total_tokens IS NULL
   OR (total_tokens = 0 AND (COALESCE(tokens_in, 0) > 0 OR COALESCE(tokens_out, 0) > 0));

-- 6) 回填 estimated_cost（优先 provider 精确匹配，次选 model 匹配）
UPDATE ai_usage_logs l
SET estimated_cost = COALESCE((
                                  SELECT ROUND(
                                                 (COALESCE(l.tokens_in, 0) / 1000.0) * COALESCE(m.input_cost_per_1k, 0)
                                                     + (COALESCE(l.tokens_out, 0) / 1000.0) * COALESCE(m.output_cost_per_1k, 0),
                                                 8
                                         )
                                  FROM ai_models m
                                           JOIN ai_providers p ON p.id = m.provider_id
                                  WHERE m.model_id = COALESCE(
                                          NULLIF(l.model_id, ''),
                                          CASE
                                              WHEN POSITION('/' IN l.model) > 0 THEN SPLIT_PART(l.model, '/', 2)
                                              ELSE l.model
                                              END
                                                    )
                                    AND (l.provider_code IS NULL OR l.provider_code = '' OR p.code = l.provider_code)
                                  ORDER BY CASE WHEN p.code = l.provider_code THEN 0 ELSE 1 END
                                  LIMIT 1
                              ), 0)
WHERE l.estimated_cost IS NULL OR l.estimated_cost = 0;

-- 7) 固化默认值与非空约束，确保后续写入一致性
ALTER TABLE ai_usage_logs
    ALTER COLUMN request_chars SET DEFAULT 0,
    ALTER COLUMN response_chars SET DEFAULT 0,
    ALTER COLUMN tokens_in SET DEFAULT 0,
    ALTER COLUMN tokens_out SET DEFAULT 0,
    ALTER COLUMN total_tokens SET DEFAULT 0,
    ALTER COLUMN latency_ms SET DEFAULT 0,
    ALTER COLUMN estimated_cost SET DEFAULT 0,
    ALTER COLUMN success SET DEFAULT TRUE,
    ALTER COLUMN cached SET DEFAULT FALSE;

ALTER TABLE ai_usage_logs
    ALTER COLUMN request_chars SET NOT NULL,
    ALTER COLUMN response_chars SET NOT NULL,
    ALTER COLUMN tokens_in SET NOT NULL,
    ALTER COLUMN tokens_out SET NOT NULL,
    ALTER COLUMN total_tokens SET NOT NULL,
    ALTER COLUMN latency_ms SET NOT NULL,
    ALTER COLUMN estimated_cost SET NOT NULL,
    ALTER COLUMN success SET NOT NULL,
    ALTER COLUMN cached SET NOT NULL;

-- 8) 统计查询常用索引
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_success_created ON ai_usage_logs(success, created_at DESC);
