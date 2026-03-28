package service

import (
	"context"
	"crypto/sha256"
	"fmt"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// --- DTOs returned by AnalyticsService ---

type DashboardVO struct {
	PostCount     int64 `json:"postCount"`
	CommentCount  int64 `json:"commentCount"`
	ViewTotal     int64 `json:"viewTotal"`
	TodayVisits   int64 `json:"todayVisits"`
	MediaCount    int64 `json:"mediaCount"`
	MediaSize     int64 `json:"mediaSize"`
	CategoryCount int64 `json:"categoryCount"`
	TagCount      int64 `json:"tagCount"`
}

type TopPostVO struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Slug      string `json:"slug"`
	ViewCount int64  `json:"viewCount"`
}

type DailyVisitVO struct {
	Date string `json:"date"`
	PV   int64  `json:"pv"`
	UV   int64  `json:"uv"`
}

type TaskTypeStatVO struct {
	TaskType string `json:"taskType"`
	Count    int64  `json:"count"`
	Tokens   int64  `json:"tokens"`
}

type AIDashboardVO struct {
	RangeDays         int              `json:"rangeDays"`
	Overview          AiOverviewVO     `json:"overview"`
	Trend             []any            `json:"trend"`
	ModelDistribution []any            `json:"modelDistribution"`
	TaskDistribution  []TaskTypeStatVO `json:"taskDistribution"`
	Records           any              `json:"records"`
}

type AiOverviewVO struct {
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
}

// AnalyticsService wraps the analytics repository and exposes business logic.
type AnalyticsService struct {
	repo *repository.AnalyticsRepo
}

func NewAnalyticsService(repo *repository.AnalyticsRepo) *AnalyticsService {
	return &AnalyticsService{repo: repo}
}

// GetDashboard returns aggregated site statistics.
func (s *AnalyticsService) GetDashboard(ctx context.Context) (*DashboardVO, error) {
	d, err := s.repo.GetDashboard(ctx)
	if err != nil {
		return nil, err
	}
	return &DashboardVO{
		PostCount:     d.PostCount,
		CommentCount:  d.CommentCount,
		ViewTotal:     d.ViewTotal,
		TodayVisits:   d.TodayVisits,
		MediaCount:    d.MediaCount,
		MediaSize:     d.MediaSize,
		CategoryCount: d.CategoryCount,
		TagCount:      d.TagCount,
	}, nil
}

// GetTopPosts returns the top 10 posts by view count.
func (s *AnalyticsService) GetTopPosts(ctx context.Context) ([]TopPostVO, error) {
	rows, err := s.repo.GetTopPosts(ctx, 10)
	if err != nil {
		return nil, err
	}
	vos := make([]TopPostVO, len(rows))
	for i, r := range rows {
		vos[i] = TopPostVO{ID: r.ID, Title: r.Title, Slug: r.Slug, ViewCount: r.ViewCount}
	}
	return vos, nil
}

// GetVisitorTrend returns daily visit counts for the last N days.
func (s *AnalyticsService) GetVisitorTrend(ctx context.Context, days int) ([]DailyVisitVO, error) {
	if days <= 0 {
		days = 30
	}
	rows, err := s.repo.GetVisitorTrend(ctx, days)
	if err != nil {
		return nil, err
	}
	vos := make([]DailyVisitVO, len(rows))
	for i, r := range rows {
		vos[i] = DailyVisitVO{Date: r.Date, PV: r.Count, UV: r.Count}
	}
	return vos, nil
}

// GetAIDashboard returns aggregated AI usage statistics.
func (s *AnalyticsService) GetAIDashboard(ctx context.Context) (*AIDashboardVO, error) {
	d, err := s.repo.GetAIDashboard(ctx)
	if err != nil {
		return nil, err
	}
	stats := make([]TaskTypeStatVO, len(d.ByTaskType))
	for i, t := range d.ByTaskType {
		stats[i] = TaskTypeStatVO{TaskType: t.TaskType, Count: t.Count, Tokens: t.Tokens}
	}

	errorCalls := d.TotalCalls - d.SuccessCalls
	var successRate float64
	if d.TotalCalls > 0 {
		successRate = float64(d.SuccessCalls) / float64(d.TotalCalls) * 100
	}
	var avgTokensPerCall, avgCostPerCall float64
	if d.TotalCalls > 0 {
		avgTokensPerCall = float64(d.TotalTokens) / float64(d.TotalCalls)
		avgCostPerCall = d.EstimatedCost / float64(d.TotalCalls)
	}

	return &AIDashboardVO{
		RangeDays: 30,
		Overview: AiOverviewVO{
			TotalCalls:       d.TotalCalls,
			SuccessCalls:     d.SuccessCalls,
			ErrorCalls:       errorCalls,
			SuccessRate:      successRate,
			CacheHitRate:     0,
			TotalTokens:      d.TotalTokens,
			TotalCost:        d.EstimatedCost,
			AvgLatencyMs:     0,
			AvgTokensPerCall: avgTokensPerCall,
			AvgCostPerCall:   avgCostPerCall,
		},
		Trend:             []any{},
		ModelDistribution: []any{},
		TaskDistribution:  stats,
		Records:           nil,
	}, nil
}

// RecordVisit records a page visit asynchronously (fire-and-forget).
// Visitor hash = SHA-256(ip + ua).
func (s *AnalyticsService) RecordVisit(ctx context.Context, pageURL, pageTitle, ip, ua, referer string) {
	go func() {
		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(ip+ua)))

		var pageTitlePtr *string
		if pageTitle != "" {
			pageTitlePtr = &pageTitle
		}
		var ipPtr *string
		if ip != "" {
			ipPtr = &ip
		}
		var uaPtr *string
		if ua != "" {
			uaPtr = &ua
		}
		var refererPtr *string
		if referer != "" {
			refererPtr = &referer
		}

		v := &model.VisitRecord{
			PageURL:     pageURL,
			PageTitle:   pageTitlePtr,
			VisitorHash: hash,
			IP:          ipPtr,
			UserAgent:   uaPtr,
			Referer:     refererPtr,
		}
		// Use a background context so the goroutine is not cancelled when the request ends.
		_ = s.repo.RecordVisit(context.Background(), v)
	}()
}

// GetTodayCount returns the total visit count for today.
func (s *AnalyticsService) GetTodayCount(ctx context.Context) (int64, error) {
	return s.repo.GetTodayVisitCount(ctx)
}

// ArchiveMonthVO is the DTO for a single archive month entry.
type ArchiveMonthVO struct {
	YearMonth string `json:"yearMonth"`
	Count     int64  `json:"count"`
}

// GetArchiveStats returns monthly post counts for the stats endpoint.
func (s *AnalyticsService) GetArchiveStats(ctx context.Context) ([]ArchiveMonthVO, error) {
	rows, err := s.repo.GetArchiveStats(ctx)
	if err != nil {
		return nil, err
	}
	vos := make([]ArchiveMonthVO, len(rows))
	for i, r := range rows {
		vos[i] = ArchiveMonthVO{YearMonth: r.YearMonth, Count: r.Count}
	}
	return vos, nil
}
