package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrAICostArchiveSchemaMissing = errors.New("ai_usage_logs cost archive columns missing")

// AIPricingGap 表示存在调用记录但价格配置缺失的模型聚合结果。
type AIPricingGap struct {
	ProviderCode  string     `db:"provider_code"`
	ModelID       string     `db:"model_id"`
	ModelDBID     *int64     `db:"model_db_id"`
	DisplayName   string     `db:"display_name"`
	MissingFields string     `db:"missing_fields"`
	Calls         int64      `db:"calls"`
	LatestUsedAt  *time.Time `db:"latest_used_at"`
}

// AICostArchiveResult 表示一次费用归档操作的统计结果。
type AICostArchiveResult struct {
	Total    int64 `db:"total"`
	Archived int64 `db:"archived"`
	Failed   int64 `db:"failed"`
}

func qualifyColumn(alias, column string) string {
	if alias == "" {
		return column
	}
	return alias + "." + column
}

func buildAIDashboardWhereWithAlias(f AIDashboardFilter, alias string) (string, []any) {
	where := "WHERE 1=1"
	args := make([]any, 0, 4)
	argIdx := 1

	if f.Days > 0 {
		where += fmt.Sprintf(" AND %s >= NOW() - INTERVAL '%d days'", qualifyColumn(alias, "created_at"), f.Days)
	}
	if f.TaskType != "" {
		where += fmt.Sprintf(" AND COALESCE(NULLIF(%s, ''), 'unknown') = $%d", qualifyColumn(alias, "task_type"), argIdx)
		args = append(args, f.TaskType)
		argIdx++
	}
	if f.ModelID != "" {
		where += fmt.Sprintf(" AND COALESCE(NULLIF(%s, ''), NULLIF(%s, ''), 'unknown') = $%d",
			qualifyColumn(alias, "model_id"),
			qualifyColumn(alias, "model"),
			argIdx,
		)
		args = append(args, f.ModelID)
		argIdx++
	}
	if f.Success != nil {
		where += fmt.Sprintf(" AND %s = $%d", qualifyColumn(alias, "success"), argIdx)
		args = append(args, *f.Success)
		argIdx++
	}
	if f.Keyword != "" {
		where += fmt.Sprintf(
			" AND ("+
				"COALESCE(%s, '') ILIKE $%d OR "+
				"COALESCE(%s, '') ILIKE $%d OR "+
				"COALESCE(%s, '') ILIKE $%d OR "+
				"COALESCE(%s, '') ILIKE $%d OR "+
				"COALESCE(%s, '') ILIKE $%d)",
			qualifyColumn(alias, "task_type"), argIdx,
			qualifyColumn(alias, "model_id"), argIdx,
			qualifyColumn(alias, "model"), argIdx,
			qualifyColumn(alias, "provider_code"), argIdx,
			qualifyColumn(alias, "error_code"), argIdx,
		)
		args = append(args, "%"+f.Keyword+"%")
	}

	return where, args
}

func (r *AnalyticsRepo) hasAICostArchiveColumns(ctx context.Context) (bool, error) {
	var count int
	if err := r.db.GetContext(ctx, &count, `
SELECT COUNT(*)
FROM information_schema.columns
WHERE table_name = 'ai_usage_logs'
  AND table_schema = ANY(current_schemas(false))
  AND column_name IN (
      'cost_archive_status',
      'cost_archive_amount',
      'cost_archived_at',
      'cost_archive_error'
  )`); err != nil {
		return false, err
	}
	return count == 4, nil
}

func buildPricedLogsCTE(where string, supportsCostArchive bool) string {
	costExpr := `CASE
            WHEN pricing.pricing_missing THEN NULL
            ELSE ROUND(
                (
                    (
                        CASE
                            WHEN COALESCE(l.cached, false) THEN matched.cached_input_cost_per_1m
                            ELSE matched.input_cost_per_1m
                        END
                    ) * COALESCE(l.tokens_in, 0)::numeric
                    + COALESCE(matched.output_cost_per_1m, 0) * COALESCE(l.tokens_out, 0)::numeric
                ) / 1000000.0,
                8
            )
        END AS cost`
	costStatusExpr := `CASE
            WHEN pricing.pricing_missing THEN 'missing'
            ELSE 'realtime'
        END AS cost_status`
	archiveErrorExpr := `CASE
            WHEN pricing.pricing_missing THEN pricing.missing_fields
            ELSE NULL
        END AS archive_error`
	if supportsCostArchive {
		costExpr = `CASE
            WHEN l.cost_archive_status = 'archived' AND l.cost_archive_amount IS NOT NULL THEN ROUND(l.cost_archive_amount::numeric, 8)
            WHEN pricing.pricing_missing THEN NULL
            ELSE ROUND(
                (
                    (
                        CASE
                            WHEN COALESCE(l.cached, false) THEN matched.cached_input_cost_per_1m
                            ELSE matched.input_cost_per_1m
                        END
                    ) * COALESCE(l.tokens_in, 0)::numeric
                    + COALESCE(matched.output_cost_per_1m, 0) * COALESCE(l.tokens_out, 0)::numeric
                ) / 1000000.0,
                8
            )
        END AS cost`
		costStatusExpr = `CASE
            WHEN l.cost_archive_status = 'archived' AND l.cost_archive_amount IS NOT NULL THEN 'archived'
            WHEN pricing.pricing_missing THEN 'missing'
            ELSE 'realtime'
        END AS cost_status`
		archiveErrorExpr = `CASE
            WHEN l.cost_archive_status = 'failed' AND l.cost_archive_error IS NOT NULL THEN l.cost_archive_error
            WHEN pricing.pricing_missing THEN pricing.missing_fields
            ELSE NULL
        END AS archive_error`
	}

	return fmt.Sprintf(`
WITH priced_logs AS (
    SELECT
        l.id,
        COALESCE(NULLIF(l.task_type, ''), 'unknown') AS task_type,
        COALESCE(NULLIF(l.provider_code, ''), NULLIF(matched.provider_code, ''), 'unknown') AS provider_code,
        COALESCE(
            NULLIF(l.model_id, ''),
            CASE
                WHEN POSITION('/' IN COALESCE(l.model, '')) > 0 THEN SPLIT_PART(l.model, '/', 2)
                ELSE NULLIF(l.model, '')
            END,
            'unknown'
        ) AS model,
        COALESCE(l.tokens_in, 0) AS tokens_in,
        COALESCE(l.tokens_out, 0) AS tokens_out,
        COALESCE(l.total_tokens, 0) AS total_tokens,
        COALESCE(l.latency_ms, 0) AS latency_ms,
        COALESCE(l.success, false) AS success,
        COALESCE(l.cached, false) AS cached,
        l.error_code,
        l.created_at,
        matched.model_db_id,
        COALESCE(matched.display_name, COALESCE(NULLIF(l.model_id, ''), NULLIF(l.model, ''), 'unknown')) AS display_name,
        pricing.missing_fields,
        %s,
        %s,
        pricing.pricing_missing,
        %s
    FROM ai_usage_logs l
    LEFT JOIN LATERAL (
        SELECT
            m.id AS model_db_id,
            p.code AS provider_code,
            COALESCE(NULLIF(m.display_name, ''), m.model_id) AS display_name,
            COALESCE(
                NULLIF(m.capabilities->'pricing'->>'input', '')::numeric,
                (
                    SELECT NULLIF(unit->>'rate', '')::numeric
                    FROM jsonb_array_elements(COALESCE(m.capabilities->'pricing'->'units', '[]'::jsonb)) AS unit
                    WHERE unit->>'name' = 'textInput'
                      AND unit->>'unit' = 'millionTokens'
                    LIMIT 1
                ),
                m.input_cost_per_1k * 1000
            ) AS input_cost_per_1m,
            COALESCE(
                NULLIF(m.capabilities->'pricing'->>'output', '')::numeric,
                (
                    SELECT NULLIF(unit->>'rate', '')::numeric
                    FROM jsonb_array_elements(COALESCE(m.capabilities->'pricing'->'units', '[]'::jsonb)) AS unit
                    WHERE unit->>'name' = 'textOutput'
                      AND unit->>'unit' = 'millionTokens'
                    LIMIT 1
                ),
                m.output_cost_per_1k * 1000
            ) AS output_cost_per_1m,
            COALESCE(
                NULLIF(m.capabilities->'pricing'->>'cachedInput', '')::numeric,
                (
                    SELECT NULLIF(unit->>'rate', '')::numeric
                    FROM jsonb_array_elements(COALESCE(m.capabilities->'pricing'->'units', '[]'::jsonb)) AS unit
                    WHERE unit->>'name' = 'textInput_cacheRead'
                      AND unit->>'unit' = 'millionTokens'
                    LIMIT 1
                )
            ) AS cached_input_cost_per_1m
        FROM ai_models m
        JOIN ai_providers p ON p.id = m.provider_id
        WHERE m.model_id = COALESCE(
            NULLIF(l.model_id, ''),
            CASE
                WHEN POSITION('/' IN COALESCE(l.model, '')) > 0 THEN SPLIT_PART(l.model, '/', 2)
                ELSE NULLIF(l.model, '')
            END
        )
          AND (l.provider_code IS NULL OR l.provider_code = '' OR p.code = l.provider_code)
        ORDER BY CASE WHEN p.code = l.provider_code THEN 0 ELSE 1 END
        LIMIT 1
    ) AS matched ON TRUE
    CROSS JOIN LATERAL (
        SELECT
            CASE
                WHEN matched.model_db_id IS NULL THEN true
                WHEN COALESCE(l.tokens_out, 0) > 0 AND matched.output_cost_per_1m IS NULL THEN true
                WHEN COALESCE(l.tokens_in, 0) > 0 AND COALESCE(l.cached, false) AND matched.cached_input_cost_per_1m IS NULL THEN true
                WHEN COALESCE(l.tokens_in, 0) > 0 AND NOT COALESCE(l.cached, false) AND matched.input_cost_per_1m IS NULL THEN true
                ELSE false
            END AS pricing_missing,
            NULLIF(strings.missing_fields, '') AS missing_fields
        FROM (
            SELECT TRIM(BOTH ', ' FROM CONCAT_WS(', ',
                CASE WHEN matched.model_db_id IS NULL THEN 'model' END,
                CASE
                    WHEN COALESCE(l.tokens_in, 0) > 0 AND COALESCE(l.cached, false) AND matched.cached_input_cost_per_1m IS NULL
                        THEN 'cachedInput'
                END,
                CASE
                    WHEN COALESCE(l.tokens_in, 0) > 0 AND NOT COALESCE(l.cached, false) AND matched.input_cost_per_1m IS NULL
                        THEN 'input'
                END,
                CASE
                    WHEN COALESCE(l.tokens_out, 0) > 0 AND matched.output_cost_per_1m IS NULL
                        THEN 'output'
                END
            )) AS missing_fields
        ) AS strings
    ) AS pricing
    %s
)`, costExpr, costStatusExpr, archiveErrorExpr, where)
}

func splitCSVFields(value string) []string {
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		item := strings.TrimSpace(part)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		result = append(result, item)
	}
	return result
}

// GetAIPricingGaps 查询当前过滤范围内缺失价格配置的模型聚合结果。
func (r *AnalyticsRepo) GetAIPricingGaps(ctx context.Context, f AIDashboardFilter) ([]AIPricingGap, error) {
	where, args := buildAIDashboardWhereWithAlias(f, "l")
	supportsCostArchive, err := r.hasAICostArchiveColumns(ctx)
	if err != nil {
		return nil, err
	}
	query := buildPricedLogsCTE(where, supportsCostArchive) + `
SELECT
    provider_code,
    model AS model_id,
    MIN(model_db_id) AS model_db_id,
    COALESCE(MAX(NULLIF(display_name, '')), model) AS display_name,
    STRING_AGG(DISTINCT missing_fields, ',') AS missing_fields,
    COUNT(*) AS calls,
    MAX(created_at) AS latest_used_at
FROM priced_logs
WHERE pricing_missing = true
GROUP BY provider_code, model
ORDER BY calls DESC, latest_used_at DESC NULLS LAST, provider_code ASC, model ASC`

	var rows []AIPricingGap
	if err := r.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, err
	}
	return rows, nil
}

// ArchiveAICosts 将当前筛选范围内未归档或归档失败的日志按当前价格配置归档。
func (r *AnalyticsRepo) ArchiveAICosts(ctx context.Context, f AIDashboardFilter) (*AICostArchiveResult, error) {
	supportsCostArchive, err := r.hasAICostArchiveColumns(ctx)
	if err != nil {
		return nil, err
	}
	if !supportsCostArchive {
		return nil, ErrAICostArchiveSchemaMissing
	}

	where, args := buildAIDashboardWhereWithAlias(f, "l")
	if where == "" {
		where = "WHERE 1=1"
	}
	where += " AND COALESCE(l.cost_archive_status, 'pending') <> 'archived'"

	query := buildPricedLogsCTE(where, supportsCostArchive) + `
, updated AS (
    UPDATE ai_usage_logs AS target
    SET cost_archive_status = CASE WHEN priced_logs.pricing_missing THEN 'failed' ELSE 'archived' END,
        cost_archive_amount = CASE WHEN priced_logs.pricing_missing THEN NULL ELSE priced_logs.cost END,
        cost_archived_at = CASE WHEN priced_logs.pricing_missing THEN NULL ELSE NOW() END,
        cost_archive_error = CASE WHEN priced_logs.pricing_missing THEN priced_logs.missing_fields ELSE NULL END
    FROM priced_logs
    WHERE target.id = priced_logs.id
    RETURNING CASE WHEN priced_logs.pricing_missing THEN 'failed' ELSE 'archived' END AS result_status
)
SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE result_status = 'archived') AS archived,
    COUNT(*) FILTER (WHERE result_status = 'failed') AS failed
FROM updated`

	var result AICostArchiveResult
	if err := r.db.GetContext(ctx, &result, query, args...); err != nil {
		return nil, err
	}
	return &result, nil
}
