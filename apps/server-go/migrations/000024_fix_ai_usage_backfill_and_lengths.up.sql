-- 修复 AI 使用日志历史回填与字段长度问题

-- 1) 扩容字段，避免长模型名/错误码写入失败
ALTER TABLE ai_usage_logs
    ALTER COLUMN model TYPE VARCHAR(128);

ALTER TABLE ai_usage_logs
    ALTER COLUMN error_code TYPE VARCHAR(128);

-- 2) 修正 provider_code：历史数据可能被错误回填为 model 字符串
UPDATE ai_usage_logs l
SET provider_code = NULL
WHERE l.provider_code IS NOT NULL
  AND l.provider_code <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM ai_providers p
    WHERE p.code = l.provider_code
);

-- 3) 若 model_id 仅映射到唯一 provider，则回填 provider_code
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

-- 4) 补齐 total_tokens（防止旧记录为空/为0）
UPDATE ai_usage_logs
SET total_tokens = COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)
WHERE total_tokens IS NULL OR total_tokens = 0;

-- 5) 回填缺失 cost（优先 provider 精确匹配，次选 model 匹配）
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
WHERE l.estimated_cost IS NULL OR l.estimated_cost = 0;
