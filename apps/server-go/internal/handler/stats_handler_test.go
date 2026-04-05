package handler

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	handlertest "github.com/golovin0623/aetherblog-server/internal/handler/testutil"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
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
			Task       string  `json:"task"`
			Calls      int64   `json:"calls"`
			Percentage float64 `json:"percentage"`
			Tokens     int64   `json:"tokens"`
			Cost       float64 `json:"cost"`
		} `json:"taskDistribution"`
		Records struct {
			List []struct {
				ID           int64   `json:"id"`
				TaskType     string  `json:"taskType"`
				ProviderCode string  `json:"providerCode"`
				Model        string  `json:"model"`
				TokensIn     int64   `json:"tokensIn"`
				TokensOut    int64   `json:"tokensOut"`
				TotalTokens  int64   `json:"totalTokens"`
				Cost         float64 `json:"cost"`
				LatencyMs    int64   `json:"latencyMs"`
				Success      bool    `json:"success"`
				Cached       bool    `json:"cached"`
				ErrorCode    *string `json:"errorCode"`
				CreatedAt    string  `json:"createdAt"`
			} `json:"list"`
			PageNum  int   `json:"pageNum"`
			PageSize int   `json:"pageSize"`
			Total    int64 `json:"total"`
			Pages    int   `json:"pages"`
		} `json:"records"`
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

	mock.ExpectQuery(`SELECT[\s\S]+FROM ai_usage_logs WHERE 1=1 AND created_at >= NOW\(\) - INTERVAL '30 days'`).
		WillReturnRows(sqlmock.NewRows([]string{
			"total_calls",
			"success_calls",
			"cached_calls",
			"total_tokens",
			"estimated_cost",
			"avg_latency_ms",
		}).AddRow(2, 1, 1, 12, 0.024, 345.5))

	mock.ExpectQuery(`SELECT[\s\S]+FROM ai_usage_logs WHERE 1=1 AND created_at >= NOW\(\) - INTERVAL '30 days'[\s\S]+GROUP BY COALESCE\(NULLIF\(task_type, ''\), 'unknown'\)`).
		WillReturnRows(sqlmock.NewRows([]string{
			"task",
			"calls",
			"tokens",
			"cost",
		}).AddRow("summary", 2, 12, 0.024))

	mock.ExpectQuery(`WITH daily AS \([\s\S]+FROM ai_usage_logs WHERE 1=1 AND created_at >= NOW\(\) - INTERVAL '30 days'[\s\S]+GROUP BY DATE\(created_at\)::text[\s\S]+\)`).
		WillReturnRows(sqlmock.NewRows([]string{
			"date",
			"calls",
			"tokens",
			"cost",
		}).AddRow("2026-04-05", 1, 4, 0.008).AddRow("2026-04-06", 1, 8, 0.016))

	mock.ExpectQuery(`SELECT[\s\S]+FROM ai_usage_logs WHERE 1=1 AND created_at >= NOW\(\) - INTERVAL '30 days'[\s\S]+GROUP BY COALESCE\(NULLIF\(model_id, ''\), NULLIF\(model, ''\), 'unknown'\)`).
		WillReturnRows(sqlmock.NewRows([]string{
			"model",
			"provider_code",
			"calls",
			"tokens",
			"cost",
		}).AddRow("gpt-5-mini", "openai", 2, 12, 0.024))

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM ai_usage_logs WHERE 1=1 AND created_at >= NOW\(\) - INTERVAL '30 days'`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))

	mock.ExpectQuery(`SELECT[\s\S]+FROM ai_usage_logs WHERE 1=1 AND created_at >= NOW\(\) - INTERVAL '30 days'[\s\S]+ORDER BY created_at DESC[\s\S]+LIMIT 20 OFFSET 0`).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"task_type",
			"provider_code",
			"model",
			"tokens_in",
			"tokens_out",
			"total_tokens",
			"cost",
			"latency_ms",
			"success",
			"cached",
			"error_code",
			"created_at",
		}).AddRow(101, "summary", "openai", "gpt-5-mini", 4, 8, 12, 0.024, 345, true, false, nil, time.Date(2026, time.April, 6, 10, 0, 0, 0, time.UTC)))

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
	if len(resp.Data.Records.List) != 1 {
		t.Fatalf("records.list length = %d, want 1", len(resp.Data.Records.List))
	}
	if resp.Data.Records.PageNum != 1 || resp.Data.Records.PageSize != 20 || resp.Data.Records.Total != 2 || resp.Data.Records.Pages != 1 {
		t.Fatalf("unexpected records pagination: %#v", resp.Data.Records)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations were not met: %v", err)
	}
}
