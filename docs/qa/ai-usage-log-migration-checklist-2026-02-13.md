# ai_usage_logs 结构与回填一致性检查（2026-02-13）

## 1. 变更概览
- 新增迁移：`V2_20__normalize_ai_usage_logs_tokens_cost_and_defaults.sql`
- 目标：
  - 清理空字符串与非法 NULL；
  - 回填 `model_id/provider_code/total_tokens/estimated_cost`；
  - 固化关键列默认值与非空约束；
  - 补充 `idx_ai_usage_logs_success_created` 索引。
- 同步调整聚合查询：当 `total_tokens` 为空或 0 时，回退 `tokens_in + tokens_out`，避免统计长期为 0。

## 2. 幂等性说明
- 所有 `UPDATE` 仅作用于空值/异常值；重复执行不会扩大影响。
- 索引使用 `CREATE INDEX IF NOT EXISTS`。
- 列默认值/非空约束重复执行不会破坏已对齐结构。

## 3. 抽样校验 SQL
```sql
-- A. 关键列非法空值应为 0
SELECT
  SUM(CASE WHEN request_chars IS NULL THEN 1 ELSE 0 END) AS request_chars_null,
  SUM(CASE WHEN response_chars IS NULL THEN 1 ELSE 0 END) AS response_chars_null,
  SUM(CASE WHEN tokens_in IS NULL THEN 1 ELSE 0 END) AS tokens_in_null,
  SUM(CASE WHEN tokens_out IS NULL THEN 1 ELSE 0 END) AS tokens_out_null,
  SUM(CASE WHEN total_tokens IS NULL THEN 1 ELSE 0 END) AS total_tokens_null,
  SUM(CASE WHEN estimated_cost IS NULL THEN 1 ELSE 0 END) AS estimated_cost_null
FROM ai_usage_logs;

-- B. total_tokens 回填准确性（抽样）
SELECT id, tokens_in, tokens_out, total_tokens,
       (COALESCE(tokens_in,0) + COALESCE(tokens_out,0)) AS expected_total
FROM ai_usage_logs
WHERE total_tokens <> (COALESCE(tokens_in,0) + COALESCE(tokens_out,0))
  AND (COALESCE(tokens_in,0) > 0 OR COALESCE(tokens_out,0) > 0)
LIMIT 50;

-- C. cost 回填覆盖率
SELECT COUNT(*) AS total_rows,
       SUM(CASE WHEN estimated_cost > 0 THEN 1 ELSE 0 END) AS cost_filled_rows
FROM ai_usage_logs;

-- D. 聚合结果不为长期 0（按最近 7 天）
SELECT date_trunc('day', created_at) AS day,
       COUNT(*) AS calls,
       SUM(CASE WHEN total_tokens = 0 THEN (COALESCE(tokens_in,0)+COALESCE(tokens_out,0)) ELSE total_tokens END) AS tokens,
       SUM(estimated_cost) AS cost
FROM ai_usage_logs
WHERE created_at >= now() - interval '7 days'
GROUP BY 1
ORDER BY 1 DESC;
```

## 4. 回归命令
```bash
cd apps/server
mvn -pl aetherblog-app,aetherblog-service/blog-service -am -DskipTests compile
```
