package service

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// --- DTOs returned by AnalyticsService ---

type DashboardVO struct {
	PostCount      int64 `json:"postCount"`
	CommentCount   int64 `json:"commentCount"`
	ViewTotal      int64 `json:"viewTotal"`
	TodayVisits    int64 `json:"todayVisits"`
	MediaCount     int64 `json:"mediaCount"`
	MediaSize      int64 `json:"mediaSize"`
	CategoryCount  int64 `json:"categoryCount"`
	TagCount       int64 `json:"tagCount"`
	TotalWords     int64 `json:"totalWords"`
	UniqueVisitors int64 `json:"uniqueVisitors"`
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

// NewAnalyticsService creates an AnalyticsService backed by the given repository.
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
		CategoryCount:  d.CategoryCount,
		TagCount:       d.TagCount,
		TotalWords:     d.TotalWords,
		UniqueVisitors: d.UniqueVisitors,
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
		vos[i] = DailyVisitVO{Date: r.Date, PV: r.PV, UV: r.UV}
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

		// Parse User-Agent for device info
		deviceType, browser, osName := parseUserAgent(ua)
		var deviceTypePtr, browserPtr, osPtr *string
		if deviceType != "" {
			deviceTypePtr = &deviceType
		}
		if browser != "" {
			browserPtr = &browser
		}
		if osName != "" {
			osPtr = &osName
		}

		v := &model.VisitRecord{
			PageURL:     pageURL,
			PageTitle:   pageTitlePtr,
			VisitorHash: hash,
			IP:          ipPtr,
			UserAgent:   uaPtr,
			DeviceType:  deviceTypePtr,
			Browser:     browserPtr,
			OS:          osPtr,
			Referer:     refererPtr,
		}
		// Use a background context so the goroutine is not cancelled when the request ends.
		_ = s.repo.RecordVisit(context.Background(), v)
	}()
}

// parseUserAgent extracts device type, browser, and OS from a User-Agent string
// using simple string matching (no external library).
func parseUserAgent(ua string) (deviceType, browser, osName string) {
	if ua == "" {
		return "Unknown", "Unknown", "Unknown"
	}
	lower := strings.ToLower(ua)

	// Device type
	switch {
	case strings.Contains(lower, "ipad") || strings.Contains(lower, "tablet"):
		deviceType = "Tablet"
	case strings.Contains(lower, "mobile") || strings.Contains(lower, "android") || strings.Contains(lower, "iphone"):
		deviceType = "Mobile"
	default:
		deviceType = "Desktop"
	}

	// Browser detection
	switch {
	case strings.Contains(lower, "edg/") || strings.Contains(lower, "edge/"):
		browser = "Edge"
	case strings.Contains(lower, "opr/") || strings.Contains(lower, "opera"):
		browser = "Opera"
	case strings.Contains(lower, "chrome") && !strings.Contains(lower, "chromium"):
		browser = "Chrome"
	case strings.Contains(lower, "firefox"):
		browser = "Firefox"
	case strings.Contains(lower, "safari") && !strings.Contains(lower, "chrome"):
		browser = "Safari"
	default:
		browser = "Other"
	}

	// OS detection
	switch {
	case strings.Contains(lower, "windows"):
		osName = "Windows"
	case strings.Contains(lower, "mac os") || strings.Contains(lower, "macintosh"):
		osName = "macOS"
	case strings.Contains(lower, "iphone") || strings.Contains(lower, "ipad"):
		osName = "iOS"
	case strings.Contains(lower, "android"):
		osName = "Android"
	case strings.Contains(lower, "linux"):
		osName = "Linux"
	default:
		osName = "Other"
	}

	return
}

// TrendsVO holds percentage change for each metric.
type TrendsVO struct {
	Posts          float64 `json:"posts"`
	Categories     float64 `json:"categories"`
	Views          float64 `json:"views"`
	Visitors       float64 `json:"visitors"`
	Comments       float64 `json:"comments"`
	Words          float64 `json:"words"`
	PostsThisMonth int64   `json:"postsThisMonth"`
}

// GetTrends returns month-over-month percentage changes.
func (s *AnalyticsService) GetTrends(ctx context.Context) (*TrendsVO, error) {
	d, err := s.repo.GetTrends(ctx)
	if err != nil {
		return nil, err
	}
	return &TrendsVO{
		Posts:          pctChange(d.PostsThisMonth, d.PostsLastMonth),
		Categories:     0, // categories don't have time-based trends
		Views:          pctChange(d.ViewsThisMonth, d.ViewsLastMonth),
		Visitors:       pctChange(d.VisitorsThisMonth, d.VisitorsLastMonth),
		Comments:       pctChange(d.CommentsThisMonth, d.CommentsLastMonth),
		Words:          pctChange(d.WordsThisMonth, d.WordsLastMonth),
		PostsThisMonth: d.PostsThisMonth,
	}, nil
}

// pctChange calculates (current - previous) / max(previous, 1) * 100.
func pctChange(current, previous int64) float64 {
	prev := previous
	if prev < 1 {
		prev = 1
	}
	return float64(current-previous) / float64(prev) * 100
}

// DeviceStatVO is the DTO for device statistics.
type DeviceStatVO struct {
	Name  string `json:"name"`
	Value int64  `json:"value"`
}

// GetDeviceStats returns device type distribution for the last 30 days.
func (s *AnalyticsService) GetDeviceStats(ctx context.Context) ([]DeviceStatVO, error) {
	rows, err := s.repo.GetDeviceStats(ctx)
	if err != nil {
		return nil, err
	}
	vos := make([]DeviceStatVO, len(rows))
	for i, r := range rows {
		vos[i] = DeviceStatVO{Name: r.Name, Value: r.Value}
	}
	return vos, nil
}

// GetAIDashboardFiltered returns filtered AI usage statistics.
func (s *AnalyticsService) GetAIDashboardFiltered(ctx context.Context, f repository.AIDashboardFilter) (*AIDashboardVO, error) {
	d, err := s.repo.GetAIDashboardFiltered(ctx, f)
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

	rangeDays := f.Days
	if rangeDays <= 0 {
		rangeDays = 30
	}

	return &AIDashboardVO{
		RangeDays: rangeDays,
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
