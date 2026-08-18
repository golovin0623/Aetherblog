package handler

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	handlertest "github.com/golovin0623/aetherblog-server/internal/handler/testutil"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

func expectAICostArchiveSchemaCheck(mock sqlmock.Sqlmock, columnCount int) {
	mock.ExpectQuery(`(?s).*information_schema\.columns.*ai_usage_logs.*cost_archive_status.*cost_archive_error.*`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(columnCount))
}

// sqlContaining 生成 sqlmock 用的查询正则：给定片段必须**按顺序逐字**出现在
// 被执行的 SQL 里（片段之间允许任意内容）。
//
// 为什么不用 `(?s).*`：那等于不校验 SQL —— 二期新增的「今日 vs 时间窗」聚合
// （task 分布的 FILTER (WHERE created_at >= CURRENT_DATE) 一族）曾被通配符
// 整个吞掉，测试只验证了结构体字段搬运，聚合表达式写错也一路绿。片段命中式
// 断言让任何一处关键聚合被改名 / 删除 / 改口径都立刻红。
//
// 注意 sqlmock 会先把 SQL 的连续空白折叠为单个空格，所以片段里不要写换行。
func sqlContaining(fragments ...string) string {
	quoted := make([]string, 0, len(fragments))
	for _, fragment := range fragments {
		quoted = append(quoted, regexp.QuoteMeta(fragment))
	}
	return `(?s)` + strings.Join(quoted, `.*`)
}

// priced_logs CTE 的 cost_status 分支：库有 cost_archive_* 列时优先取归档金额，
// 否则只有 missing / realtime 两态。两个片段互斥，用来钉住走了哪条分支。
const (
	aiArchivedCostStatusBranch = "WHEN l.cost_archive_status = 'archived' AND l.cost_archive_amount IS NOT NULL THEN 'archived'"
	aiRealtimeOnlyCostStatus   = "CASE WHEN pricing.pricing_missing THEN 'missing' ELSE 'realtime' END AS cost_status"
)

// aiOverviewSQL 概览聚合查询；costStatusBranch 同时钉住 priced_logs CTE 走了
// 归档分支还是降级分支。
func aiOverviewSQL(costStatusBranch string) string {
	return sqlContaining(
		costStatusBranch,
		"COUNT(*) AS total_calls",
		"COUNT(*) FILTER (WHERE success) AS success_calls",
		"COUNT(*) FILTER (WHERE cached) AS cached_calls",
		"COALESCE(AVG(latency_ms), 0.0) AS avg_latency_ms",
		"FROM priced_logs",
	)
}

// AI 仪表盘其余查询的关键片段（按 AnalyticsRepo.GetAIDashboard 的执行顺序）。
var (
	// task 分布：时间窗聚合与「今日」聚合并存，且按 task_type 分组。
	aiTaskDistributionSQL = sqlContaining(
		"task_type AS task",
		"COALESCE(SUM(tokens_in), 0) AS tokens_in",
		"COALESCE(SUM(tokens_out), 0) AS tokens_out",
		"COALESCE(AVG(latency_ms), 0.0) AS avg_latency_ms",
		"COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today_calls",
		"COALESCE(SUM(tokens_in) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS today_tokens_in",
		"COALESCE(SUM(tokens_out) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS today_tokens_out",
		"COALESCE(SUM(COALESCE(cost, 0)) FILTER (WHERE created_at >= CURRENT_DATE), 0.0) AS today_cost",
		"COALESCE(AVG(latency_ms) FILTER (WHERE created_at >= CURRENT_DATE), 0.0) AS today_avg_latency_ms",
		"FROM priced_logs GROUP BY task_type",
	)
	aiTrendSQL = sqlContaining(
		"DATE(created_at)::text AS date",
		"GROUP BY DATE(created_at)::text",
		"FROM daily ORDER BY date ASC",
	)
	aiModelDistributionSQL = sqlContaining(
		"FROM priced_logs GROUP BY model, provider_code",
		"ORDER BY calls DESC, model ASC LIMIT 8",
	)
	aiRecordCountSQL = sqlContaining("SELECT COUNT(*) FROM priced_logs")
	aiRecordsPageSQL = sqlContaining("FROM priced_logs ORDER BY created_at DESC LIMIT $")
	// 价格缺口：只聚合 pricing_missing 的调用，按 provider+model 归组。
	aiPricingGapsSQL = sqlContaining(
		"FROM priced_logs WHERE pricing_missing = true GROUP BY provider_code, model",
	)
	// 费用归档：UPDATE ... RETURNING 后按 archived / failed 分桶计数。
	aiCostArchiveSQL = sqlContaining(
		"UPDATE ai_usage_logs AS target",
		"RETURNING CASE WHEN priced_logs.pricing_missing THEN 'failed' ELSE 'archived' END AS result_status",
		"COUNT(*) FILTER (WHERE result_status = 'archived') AS archived",
		"COUNT(*) FILTER (WHERE result_status = 'failed') AS failed",
	)
)

type aiDashboardResponse struct {
	Code int `json:"code"`
	Data struct {
		RangeDays int `json:"rangeDays"`
		Overview  struct {
			TotalCalls       int64   `json:"totalCalls"`
			SuccessCalls     int64   `json:"successCalls"`
			ErrorCalls       int64   `json:"errorCalls"`
			SuccessRate      float64 `json:"successRate"`
			CacheHitRate     float64 `json:"cacheHitRate"`
			TotalTokens      int64   `json:"totalTokens"`
			TotalCost        float64 `json:"totalCost"`
			AvgLatencyMs     float64 `json:"avgLatencyMs"`
			AvgTokensPerCall float64 `json:"avgTokensPerCall"`
			AvgCostPerCall   float64 `json:"avgCostPerCall"`
		} `json:"overview"`
		Trend []struct {
			Date   string  `json:"date"`
			Calls  int64   `json:"calls"`
			Tokens int64   `json:"tokens"`
			Cost   float64 `json:"cost"`
		} `json:"trend"`
		ModelDistribution []struct {
			Model        string  `json:"model"`
			ProviderCode string  `json:"providerCode"`
			Calls        int64   `json:"calls"`
			Percentage   float64 `json:"percentage"`
			Tokens       int64   `json:"tokens"`
			Cost         float64 `json:"cost"`
		} `json:"modelDistribution"`
		TaskDistribution []struct {
			Task              string  `json:"task"`
			Calls             int64   `json:"calls"`
			Percentage        float64 `json:"percentage"`
			Tokens            int64   `json:"tokens"`
			TokensIn          int64   `json:"tokensIn"`
			TokensOut         int64   `json:"tokensOut"`
			Cost              float64 `json:"cost"`
			AvgLatencyMs      float64 `json:"avgLatencyMs"`
			TodayCalls        int64   `json:"todayCalls"`
			TodayTokensIn     int64   `json:"todayTokensIn"`
			TodayTokensOut    int64   `json:"todayTokensOut"`
			TodayCost         float64 `json:"todayCost"`
			TodayAvgLatencyMs float64 `json:"todayAvgLatencyMs"`
		} `json:"taskDistribution"`
		Records struct {
			List []struct {
				ID             int64   `json:"id"`
				TaskType       string  `json:"taskType"`
				ProviderCode   string  `json:"providerCode"`
				Model          string  `json:"model"`
				TokensIn       int64   `json:"tokensIn"`
				TokensOut      int64   `json:"tokensOut"`
				TotalTokens    int64   `json:"totalTokens"`
				Cost           float64 `json:"cost"`
				CostStatus     string  `json:"costStatus"`
				PricingMissing bool    `json:"pricingMissing"`
				LatencyMs      int64   `json:"latencyMs"`
				Success        bool    `json:"success"`
				Cached         bool    `json:"cached"`
				ErrorCode      *string `json:"errorCode"`
				CreatedAt      string  `json:"createdAt"`
			} `json:"list"`
			PageNum  int   `json:"pageNum"`
			PageSize int   `json:"pageSize"`
			Total    int64 `json:"total"`
			Pages    int   `json:"pages"`
		} `json:"records"`
	} `json:"data"`
}

type aiPricingGapsResponse struct {
	Code int `json:"code"`
	Data []struct {
		ProviderCode  string   `json:"providerCode"`
		ModelID       string   `json:"modelId"`
		ModelDBID     *int64   `json:"modelDbId"`
		DisplayName   string   `json:"displayName"`
		MissingFields []string `json:"missingFields"`
		Calls         int64    `json:"calls"`
		LatestUsedAt  string   `json:"latestUsedAt"`
	} `json:"data"`
}

type aiArchiveResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Total    int64 `json:"total"`
		Archived int64 `json:"archived"`
		Failed   int64 `json:"failed"`
	} `json:"data"`
}

func TestStatsHandler_AIDashboardReturnsFullAnalyticsPayload(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New failed: %v", err)
	}
	defer db.Close()

	sqlxDB := sqlx.NewDb(db, "sqlmock")
	repo := repository.NewAnalyticsRepo(sqlxDB)
	svc := service.NewAnalyticsService(repo)
	h := NewStatsHandler(svc)

	e := handlertest.NewEcho()
	h.Mount(e.Group("/api/v1/admin/stats"))

	expectAICostArchiveSchemaCheck(mock, 4)

	mock.ExpectQuery(aiOverviewSQL(aiArchivedCostStatusBranch)).
		WillReturnRows(sqlmock.NewRows([]string{
			"total_calls",
			"success_calls",
			"cached_calls",
			"total_tokens",
			"estimated_cost",
			"avg_latency_ms",
		}).AddRow(2, 1, 1, 12, 0.024, 345.5))

	mock.ExpectQuery(aiTaskDistributionSQL).
		WillReturnRows(sqlmock.NewRows([]string{
			"task",
			"calls",
			"tokens",
			"tokens_in",
			"tokens_out",
			"cost",
			"avg_latency_ms",
			"today_calls",
			"today_tokens_in",
			"today_tokens_out",
			"today_cost",
			"today_avg_latency_ms",
		}).AddRow("summary", 2, 12, 4, 8, 0.024, 345.5, 1, 2, 4, 0.012, 300.0))

	mock.ExpectQuery(aiTrendSQL).
		WillReturnRows(sqlmock.NewRows([]string{
			"date",
			"calls",
			"tokens",
			"cost",
		}).AddRow("2026-04-05", 1, 4, 0.008).AddRow("2026-04-06", 1, 8, 0.016))

	mock.ExpectQuery(aiModelDistributionSQL).
		WillReturnRows(sqlmock.NewRows([]string{
			"model",
			"provider_code",
			"calls",
			"tokens",
			"cost",
		}).AddRow("gpt-5-mini", "openai", 2, 12, 0.024))

	mock.ExpectQuery(aiRecordCountSQL).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))

	mock.ExpectQuery(aiRecordsPageSQL).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"task_type",
			"provider_code",
			"model",
			"tokens_in",
			"tokens_out",
			"total_tokens",
			"cost",
			"cost_status",
			"pricing_missing",
			"latency_ms",
			"success",
			"cached",
			"error_code",
			"created_at",
		}).AddRow(101, "summary", "openai", "gpt-5-mini", 4, 8, 12, 0.024, "realtime", false, 345, true, false, nil, time.Date(2026, time.April, 6, 10, 0, 0, 0, time.UTC)))

	rec := handlertest.DoRequest(e, "GET", "/api/v1/admin/stats/ai-dashboard?days=30&pageNum=1&pageSize=20", "")
	if rec.Code != 200 {
		t.Fatalf("unexpected status code: %d, body=%s", rec.Code, rec.Body.String())
	}

	var resp aiDashboardResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}

	if resp.Code != 200 {
		t.Fatalf("unexpected business code: %d, body=%s", resp.Code, rec.Body.String())
	}
	if resp.Data.RangeDays != 30 {
		t.Fatalf("rangeDays = %d, want 30", resp.Data.RangeDays)
	}
	if resp.Data.Overview.TotalCalls != 2 {
		t.Fatalf("overview.totalCalls = %d, want 2", resp.Data.Overview.TotalCalls)
	}
	if resp.Data.Overview.AvgLatencyMs != 345.5 {
		t.Fatalf("overview.avgLatencyMs = %v, want 345.5", resp.Data.Overview.AvgLatencyMs)
	}
	if resp.Data.Overview.CacheHitRate != 50 {
		t.Fatalf("overview.cacheHitRate = %v, want 50", resp.Data.Overview.CacheHitRate)
	}
	if len(resp.Data.Trend) != 2 {
		t.Fatalf("trend length = %d, want 2", len(resp.Data.Trend))
	}
	if len(resp.Data.ModelDistribution) != 1 {
		t.Fatalf("modelDistribution length = %d, want 1", len(resp.Data.ModelDistribution))
	}
	if len(resp.Data.TaskDistribution) != 1 || resp.Data.TaskDistribution[0].Task != "summary" {
		t.Fatalf("taskDistribution = %#v, want task=summary", resp.Data.TaskDistribution)
	}
	taskDist := resp.Data.TaskDistribution[0]
	if taskDist.TokensIn != 4 || taskDist.TokensOut != 8 {
		t.Fatalf("taskDistribution tokens in/out = %d/%d, want 4/8", taskDist.TokensIn, taskDist.TokensOut)
	}
	if taskDist.AvgLatencyMs != 345.5 {
		t.Fatalf("taskDistribution.avgLatencyMs = %v, want 345.5", taskDist.AvgLatencyMs)
	}
	if taskDist.TodayCalls != 1 || taskDist.TodayTokensIn != 2 || taskDist.TodayTokensOut != 4 {
		t.Fatalf("taskDistribution today calls/in/out = %d/%d/%d, want 1/2/4",
			taskDist.TodayCalls, taskDist.TodayTokensIn, taskDist.TodayTokensOut)
	}
	if taskDist.TodayCost != 0.012 || taskDist.TodayAvgLatencyMs != 300.0 {
		t.Fatalf("taskDistribution today cost/latency = %v/%v, want 0.012/300",
			taskDist.TodayCost, taskDist.TodayAvgLatencyMs)
	}
	if len(resp.Data.Records.List) != 1 {
		t.Fatalf("records.list length = %d, want 1", len(resp.Data.Records.List))
	}
	if resp.Data.Records.List[0].CostStatus != "realtime" {
		t.Fatalf("records.list[0].costStatus = %q, want realtime", resp.Data.Records.List[0].CostStatus)
	}
	if resp.Data.Records.PageNum != 1 || resp.Data.Records.PageSize != 20 || resp.Data.Records.Total != 2 || resp.Data.Records.Pages != 1 {
		t.Fatalf("unexpected records pagination: %#v", resp.Data.Records)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations were not met: %v", err)
	}
}

func TestStatsHandler_AIDashboardFallsBackWithoutArchiveColumns(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New failed: %v", err)
	}
	defer db.Close()

	sqlxDB := sqlx.NewDb(db, "sqlmock")
	repo := repository.NewAnalyticsRepo(sqlxDB)
	svc := service.NewAnalyticsService(repo)
	h := NewStatsHandler(svc)

	e := handlertest.NewEcho()
	h.Mount(e.Group("/api/v1/admin/stats"))

	expectAICostArchiveSchemaCheck(mock, 0)

	mock.ExpectQuery(aiOverviewSQL(aiRealtimeOnlyCostStatus)).
		WillReturnRows(sqlmock.NewRows([]string{
			"total_calls",
			"success_calls",
			"cached_calls",
			"total_tokens",
			"estimated_cost",
			"avg_latency_ms",
		}).AddRow(1, 1, 0, 24, 0.048, 220.0))

	// 降级路径同样要发「今日 vs 时间窗」的完整聚合 —— 缺 cost_archive_* 列
	// 只影响 priced_logs CTE 的成本口径，不该退化 task 分布的统计维度。
	mock.ExpectQuery(aiTaskDistributionSQL).
		WillReturnRows(sqlmock.NewRows([]string{
			"task",
			"calls",
			"tokens",
			"cost",
		}).AddRow("chat", 1, 24, 0.048))

	mock.ExpectQuery(aiTrendSQL).
		WillReturnRows(sqlmock.NewRows([]string{
			"date",
			"calls",
			"tokens",
			"cost",
		}).AddRow("2026-04-06", 1, 24, 0.048))

	mock.ExpectQuery(aiModelDistributionSQL).
		WillReturnRows(sqlmock.NewRows([]string{
			"model",
			"provider_code",
			"calls",
			"tokens",
			"cost",
		}).AddRow("gpt-5-mini", "openai", 1, 24, 0.048))

	mock.ExpectQuery(aiRecordCountSQL).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(aiRecordsPageSQL).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"task_type",
			"provider_code",
			"model",
			"tokens_in",
			"tokens_out",
			"total_tokens",
			"cost",
			"cost_status",
			"pricing_missing",
			"latency_ms",
			"success",
			"cached",
			"error_code",
			"archive_error",
			"created_at",
		}).AddRow(102, "chat", "openai", "gpt-5-mini", 12, 12, 24, 0.048, "realtime", false, 220, true, false, nil, nil, time.Date(2026, time.April, 6, 11, 0, 0, 0, time.UTC)))

	rec := handlertest.DoRequest(e, "GET", "/api/v1/admin/stats/ai-dashboard?days=30&pageNum=1&pageSize=20", "")
	if rec.Code != 200 {
		t.Fatalf("unexpected status code: %d, body=%s", rec.Code, rec.Body.String())
	}

	var resp aiDashboardResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}

	if resp.Code != 200 {
		t.Fatalf("unexpected business code: %d, body=%s", resp.Code, rec.Body.String())
	}
	if len(resp.Data.Records.List) != 1 {
		t.Fatalf("records.list length = %d, want 1", len(resp.Data.Records.List))
	}
	if resp.Data.Records.List[0].CostStatus != "realtime" {
		t.Fatalf("records.list[0].costStatus = %q, want realtime", resp.Data.Records.List[0].CostStatus)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations were not met: %v", err)
	}
}

func TestStatsHandler_AIPricingGapsAndArchiveEndpoints(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New failed: %v", err)
	}
	defer db.Close()

	sqlxDB := sqlx.NewDb(db, "sqlmock")
	repo := repository.NewAnalyticsRepo(sqlxDB)
	svc := service.NewAnalyticsService(repo)
	h := NewStatsHandler(svc)

	e := handlertest.NewEcho()
	h.Mount(e.Group("/api/v1/admin/stats"))

	expectAICostArchiveSchemaCheck(mock, 4)

	mock.ExpectQuery(aiPricingGapsSQL).
		WillReturnRows(sqlmock.NewRows([]string{
			"provider_code",
			"model_id",
			"model_db_id",
			"display_name",
			"missing_fields",
			"calls",
			"latest_used_at",
		}).AddRow("openai", "gpt-5-mini", 10, "GPT-5 mini", "cachedInput", 3, time.Date(2026, time.April, 6, 12, 0, 0, 0, time.UTC)))

	gapsRec := handlertest.DoRequest(e, "GET", "/api/v1/admin/stats/ai-pricing-gaps", "")
	if gapsRec.Code != 200 {
		t.Fatalf("unexpected status code for gaps: %d, body=%s", gapsRec.Code, gapsRec.Body.String())
	}

	var gapsResp aiPricingGapsResponse
	if err := json.Unmarshal(gapsRec.Body.Bytes(), &gapsResp); err != nil {
		t.Fatalf("json.Unmarshal gaps failed: %v", err)
	}
	if len(gapsResp.Data) != 1 || gapsResp.Data[0].ProviderCode != "openai" {
		t.Fatalf("unexpected gaps response: %#v", gapsResp)
	}

	expectAICostArchiveSchemaCheck(mock, 4)

	mock.ExpectQuery(aiCostArchiveSQL).
		WillReturnRows(sqlmock.NewRows([]string{"total", "archived", "failed"}).AddRow(4, 3, 1))

	archiveRec := handlertest.DoRequest(e, "POST", "/api/v1/admin/stats/ai-cost-archive", `{"days":30}`)
	if archiveRec.Code != 200 {
		t.Fatalf("unexpected status code for archive: %d, body=%s", archiveRec.Code, archiveRec.Body.String())
	}

	var archiveResp aiArchiveResponse
	if err := json.Unmarshal(archiveRec.Body.Bytes(), &archiveResp); err != nil {
		t.Fatalf("json.Unmarshal archive failed: %v", err)
	}
	if archiveResp.Data.Total != 4 || archiveResp.Data.Archived != 3 || archiveResp.Data.Failed != 1 {
		t.Fatalf("unexpected archive response: %#v", archiveResp)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations were not met: %v", err)
	}
}

func TestStatsHandler_ArchiveAICostsReturnsBadRequestWhenSchemaMissing(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New failed: %v", err)
	}
	defer db.Close()

	sqlxDB := sqlx.NewDb(db, "sqlmock")
	repo := repository.NewAnalyticsRepo(sqlxDB)
	svc := service.NewAnalyticsService(repo)
	h := NewStatsHandler(svc)

	e := handlertest.NewEcho()
	h.Mount(e.Group("/api/v1/admin/stats"))

	expectAICostArchiveSchemaCheck(mock, 0)

	rec := handlertest.DoRequest(e, "POST", "/api/v1/admin/stats/ai-cost-archive", `{"days":30}`)
	if rec.Code != 400 {
		t.Fatalf("unexpected status code: %d, body=%s", rec.Code, rec.Body.String())
	}

	var resp aiArchiveResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}
	if resp.Code != 400 {
		t.Fatalf("unexpected business code: %d, body=%s", resp.Code, rec.Body.String())
	}
	if resp.Message != "AI 费用归档依赖最新数据库迁移，请先执行迁移" {
		t.Fatalf("unexpected message: %q", resp.Message)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations were not met: %v", err)
	}
}
