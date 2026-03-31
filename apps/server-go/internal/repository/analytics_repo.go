package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// DashboardData holds aggregated site-wide statistics.
type DashboardData struct {
	PostCount      int64 `db:"post_count"`
	CommentCount   int64 `db:"comment_count"`
	ViewTotal      int64 `db:"view_total"`
	TodayVisits    int64 `db:"today_visits"`
	MediaCount     int64 `db:"media_count"`
	MediaSize      int64 `db:"media_size"`
	CategoryCount  int64 `db:"category_count"`
	TagCount       int64 `db:"tag_count"`
	TotalWords     int64 `db:"total_words"`
	UniqueVisitors int64 `db:"unique_visitors"`
}

// TopPost is a lightweight post row ordered by view_count.
type TopPost struct {
	ID        int64   `db:"id"`
	Title     string  `db:"title"`
	Slug      string  `db:"slug"`
	ViewCount int64   `db:"view_count"`
}

// DailyVisit represents visit count for a single day.
type DailyVisit struct {
	Date string `db:"visit_date"`
	PV   int64  `db:"pv"`
	UV   int64  `db:"uv"`
}

// AIDashboard holds aggregated AI usage statistics.
type AIDashboard struct {
	TotalCalls    int64           `db:"total_calls"`
	SuccessCalls  int64           `db:"success_calls"`
	TotalTokens   int64           `db:"total_tokens"`
	EstimatedCost float64         `db:"estimated_cost"`
	ByTaskType    []TaskTypeStat
}

// TaskTypeStat holds per-task-type aggregation from ai_usage_logs.
type TaskTypeStat struct {
	TaskType string `db:"task_type"`
	Count    int64  `db:"cnt"`
	Tokens   int64  `db:"tokens"`
}

// AnalyticsRepo handles all analytics-related database queries.
type AnalyticsRepo struct{ db *sqlx.DB }

// NewAnalyticsRepo creates an AnalyticsRepo backed by the given database connection.
func NewAnalyticsRepo(db *sqlx.DB) *AnalyticsRepo { return &AnalyticsRepo{db: db} }

// GetDashboard returns aggregated site statistics from multiple tables.
func (r *AnalyticsRepo) GetDashboard(ctx context.Context) (*DashboardData, error) {
	today := time.Now().Format("2006-01-02")

	var d DashboardData

	// Post count (published, not deleted)
	if err := r.db.GetContext(ctx, &d.PostCount,
		`SELECT COUNT(*) FROM posts WHERE deleted = false AND status = 'PUBLISHED'`); err != nil {
		return nil, err
	}

	// Comment count (approved)
	if err := r.db.GetContext(ctx, &d.CommentCount,
		`SELECT COUNT(*) FROM comments WHERE status = 'APPROVED'`); err != nil {
		return nil, err
	}

	// Total view count
	if err := r.db.GetContext(ctx, &d.ViewTotal,
		`SELECT COALESCE(SUM(view_count), 0) FROM posts WHERE deleted = false`); err != nil {
		return nil, err
	}

	// Today's unique visitors
	if err := r.db.GetContext(ctx, &d.TodayVisits,
		`SELECT COUNT(*) FROM visit_records WHERE is_bot = false AND DATE(created_at) = $1`, today); err != nil {
		return nil, err
	}

	// Media count
	if err := r.db.GetContext(ctx, &d.MediaCount,
		`SELECT COUNT(*) FROM media_files WHERE deleted = false`); err != nil {
		return nil, err
	}

	// Media total size
	if err := r.db.GetContext(ctx, &d.MediaSize,
		`SELECT COALESCE(SUM(file_size), 0) FROM media_files WHERE deleted = false`); err != nil {
		return nil, err
	}

	// Category count
	if err := r.db.GetContext(ctx, &d.CategoryCount,
		`SELECT COUNT(*) FROM categories`); err != nil {
		return nil, err
	}

	// Tag count
	if err := r.db.GetContext(ctx, &d.TagCount,
		`SELECT COUNT(*) FROM tags`); err != nil {
		return nil, err
	}

	// Total word count
	if err := r.db.GetContext(ctx, &d.TotalWords,
		`SELECT COALESCE(SUM(word_count), 0) FROM posts WHERE deleted = false`); err != nil {
		return nil, err
	}

	// Unique visitors (all time, excluding bots)
	if err := r.db.GetContext(ctx, &d.UniqueVisitors,
		`SELECT COUNT(DISTINCT visitor_hash) FROM visit_records WHERE is_bot = false`); err != nil {
		return nil, err
	}

	return &d, nil
}

// GetTopPosts returns the top N posts ordered by view_count descending.
func (r *AnalyticsRepo) GetTopPosts(ctx context.Context, limit int) ([]TopPost, error) {
	var rows []TopPost
	err := r.db.SelectContext(ctx, &rows,
		fmt.Sprintf(`SELECT id, title, slug, view_count
		             FROM posts
		             WHERE deleted = false AND status = 'PUBLISHED' AND is_hidden = false
		             ORDER BY view_count DESC
		             LIMIT %d`, limit))
	return rows, err
}

// GetVisitorTrend returns daily visit counts for the last N days.
func (r *AnalyticsRepo) GetVisitorTrend(ctx context.Context, days int) ([]DailyVisit, error) {
	var rows []DailyVisit
	err := r.db.SelectContext(ctx, &rows,
		fmt.Sprintf(`SELECT DATE(created_at)::text AS visit_date,
		                    COUNT(*) AS pv,
		                    COUNT(DISTINCT visitor_hash) AS uv
		             FROM visit_records
		             WHERE is_bot = false
		               AND created_at >= NOW() - INTERVAL '%d days'
		             GROUP BY visit_date
		             ORDER BY visit_date ASC`, days))
	return rows, err
}

// GetTodayVisitCount returns total non-bot visit count for today.
func (r *AnalyticsRepo) GetTodayVisitCount(ctx context.Context) (int64, error) {
	today := time.Now().Format("2006-01-02")
	var n int64
	err := r.db.GetContext(ctx, &n,
		`SELECT COUNT(*) FROM visit_records WHERE is_bot = false AND DATE(created_at) = $1`, today)
	return n, err
}

// GetAIDashboard returns aggregated AI usage statistics.
func (r *AnalyticsRepo) GetAIDashboard(ctx context.Context) (*AIDashboard, error) {
	var d AIDashboard

	if err := r.db.GetContext(ctx, &d,
		`SELECT
		    COUNT(*)                           AS total_calls,
		    COUNT(*) FILTER (WHERE success)    AS success_calls,
		    COALESCE(SUM(total_tokens), 0)     AS total_tokens,
		    COALESCE(SUM(estimated_cost), 0.0) AS estimated_cost
		 FROM ai_usage_logs`); err != nil {
		return nil, err
	}

	var stats []TaskTypeStat
	if err := r.db.SelectContext(ctx, &stats,
		`SELECT
		    COALESCE(task_type, 'unknown') AS task_type,
		    COUNT(*)                       AS cnt,
		    COALESCE(SUM(total_tokens), 0) AS tokens
		 FROM ai_usage_logs
		 GROUP BY task_type
		 ORDER BY cnt DESC`); err != nil {
		return nil, err
	}
	d.ByTaskType = stats

	return &d, nil
}

// ArchiveMonth holds a year-month string and a post count for that month.
type ArchiveMonthStat struct {
	YearMonth string `db:"year_month"`
	Count     int64  `db:"count"`
}

// GetArchiveStats returns monthly post counts, ordered newest-first.
func (r *AnalyticsRepo) GetArchiveStats(ctx context.Context) ([]ArchiveMonthStat, error) {
	var rows []ArchiveMonthStat
	err := r.db.SelectContext(ctx, &rows,
		`SELECT TO_CHAR(published_at, 'YYYY-MM') AS year_month, COUNT(*) AS count
		 FROM posts
		 WHERE deleted = false AND status = 'PUBLISHED'
		 GROUP BY year_month
		 ORDER BY year_month DESC`)
	return rows, err
}

// TrendsData holds this-month vs last-month comparisons for dashboard trends.
type TrendsData struct {
	PostsThisMonth    int64 `db:"posts_this_month"`
	PostsLastMonth    int64 `db:"posts_last_month"`
	CommentsThisMonth int64 `db:"comments_this_month"`
	CommentsLastMonth int64 `db:"comments_last_month"`
	ViewsThisMonth    int64 `db:"views_this_month"`
	ViewsLastMonth    int64 `db:"views_last_month"`
	VisitorsThisMonth int64 `db:"visitors_this_month"`
	VisitorsLastMonth int64 `db:"visitors_last_month"`
	WordsThisMonth    int64 `db:"words_this_month"`
	WordsLastMonth    int64 `db:"words_last_month"`
}

// GetTrends returns this-month vs last-month comparison data.
func (r *AnalyticsRepo) GetTrends(ctx context.Context) (*TrendsData, error) {
	var d TrendsData

	// Posts this month
	if err := r.db.GetContext(ctx, &d.PostsThisMonth,
		`SELECT COUNT(*) FROM posts WHERE deleted = false AND status = 'PUBLISHED'
		 AND published_at >= date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// Posts last month
	if err := r.db.GetContext(ctx, &d.PostsLastMonth,
		`SELECT COUNT(*) FROM posts WHERE deleted = false AND status = 'PUBLISHED'
		 AND published_at >= date_trunc('month', NOW() - INTERVAL '1 month')
		 AND published_at < date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// Comments this month
	if err := r.db.GetContext(ctx, &d.CommentsThisMonth,
		`SELECT COUNT(*) FROM comments WHERE status = 'APPROVED'
		 AND created_at >= date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// Comments last month
	if err := r.db.GetContext(ctx, &d.CommentsLastMonth,
		`SELECT COUNT(*) FROM comments WHERE status = 'APPROVED'
		 AND created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
		 AND created_at < date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// Views this month (from visit_records)
	if err := r.db.GetContext(ctx, &d.ViewsThisMonth,
		`SELECT COUNT(*) FROM visit_records WHERE is_bot = false
		 AND created_at >= date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// Views last month
	if err := r.db.GetContext(ctx, &d.ViewsLastMonth,
		`SELECT COUNT(*) FROM visit_records WHERE is_bot = false
		 AND created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
		 AND created_at < date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// Visitors this month (unique)
	if err := r.db.GetContext(ctx, &d.VisitorsThisMonth,
		`SELECT COUNT(DISTINCT visitor_hash) FROM visit_records WHERE is_bot = false
		 AND created_at >= date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// Visitors last month (unique)
	if err := r.db.GetContext(ctx, &d.VisitorsLastMonth,
		`SELECT COUNT(DISTINCT visitor_hash) FROM visit_records WHERE is_bot = false
		 AND created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
		 AND created_at < date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// Words this month
	if err := r.db.GetContext(ctx, &d.WordsThisMonth,
		`SELECT COALESCE(SUM(word_count), 0) FROM posts WHERE deleted = false AND status = 'PUBLISHED'
		 AND published_at >= date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// Words last month
	if err := r.db.GetContext(ctx, &d.WordsLastMonth,
		`SELECT COALESCE(SUM(word_count), 0) FROM posts WHERE deleted = false AND status = 'PUBLISHED'
		 AND published_at >= date_trunc('month', NOW() - INTERVAL '1 month')
		 AND published_at < date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	return &d, nil
}

// DeviceStat holds device type distribution data.
type DeviceStat struct {
	Name  string `db:"name" json:"name"`
	Value int64  `db:"value" json:"value"`
}

// GetDeviceStats returns device type distribution for the last 30 days.
func (r *AnalyticsRepo) GetDeviceStats(ctx context.Context) ([]DeviceStat, error) {
	var rows []DeviceStat
	err := r.db.SelectContext(ctx, &rows,
		`SELECT COALESCE(device_type, 'Unknown') AS name, COUNT(*) AS value
		 FROM visit_records
		 WHERE is_bot = false AND created_at >= NOW() - INTERVAL '30 days'
		 GROUP BY device_type
		 ORDER BY value DESC
		 LIMIT 10`)
	return rows, err
}

// AIDashboardFilter holds filter parameters for filtered AI dashboard queries.
type AIDashboardFilter struct {
	Days     int
	TaskType string
	ModelID  string
	Success  *bool
	Keyword  string
	PageNum  int
	PageSize int
}

// GetAIDashboardFiltered returns AI usage statistics filtered by the given parameters.
func (r *AnalyticsRepo) GetAIDashboardFiltered(ctx context.Context, f AIDashboardFilter) (*AIDashboard, error) {
	var d AIDashboard

	where := "WHERE 1=1"
	args := []any{}
	argIdx := 1

	if f.Days > 0 {
		where += fmt.Sprintf(" AND created_at >= NOW() - INTERVAL '%d days'", f.Days)
	}
	if f.TaskType != "" {
		where += fmt.Sprintf(" AND task_type = $%d", argIdx)
		args = append(args, f.TaskType)
		argIdx++
	}
	if f.ModelID != "" {
		where += fmt.Sprintf(" AND model_id = $%d", argIdx)
		args = append(args, f.ModelID)
		argIdx++
	}
	if f.Success != nil {
		where += fmt.Sprintf(" AND success = $%d", argIdx)
		args = append(args, *f.Success)
		argIdx++
	}
	if f.Keyword != "" {
		where += fmt.Sprintf(" AND (task_type ILIKE $%d OR model_id ILIKE $%d)", argIdx, argIdx)
		args = append(args, "%"+f.Keyword+"%")
		argIdx++
	}

	aggQuery := fmt.Sprintf(
		`SELECT
		    COUNT(*)                           AS total_calls,
		    COUNT(*) FILTER (WHERE success)    AS success_calls,
		    COALESCE(SUM(total_tokens), 0)     AS total_tokens,
		    COALESCE(SUM(estimated_cost), 0.0) AS estimated_cost
		 FROM ai_usage_logs %s`, where)

	if err := r.db.GetContext(ctx, &d, aggQuery, args...); err != nil {
		return nil, err
	}

	statsQuery := fmt.Sprintf(
		`SELECT
		    COALESCE(task_type, 'unknown') AS task_type,
		    COUNT(*)                       AS cnt,
		    COALESCE(SUM(total_tokens), 0) AS tokens
		 FROM ai_usage_logs %s
		 GROUP BY task_type
		 ORDER BY cnt DESC`, where)

	var stats []TaskTypeStat
	if err := r.db.SelectContext(ctx, &stats, statsQuery, args...); err != nil {
		return nil, err
	}
	d.ByTaskType = stats

	return &d, nil
}

// RecordVisit inserts a new visit record row.
func (r *AnalyticsRepo) RecordVisit(ctx context.Context, v *model.VisitRecord) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO visit_records
		    (post_id, page_url, page_title, visitor_hash, ip, user_agent, device_type, browser, os, referer, is_bot, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, NOW())`,
		v.PostID, v.PageURL, v.PageTitle, v.VisitorHash, v.IP, v.UserAgent, v.DeviceType, v.Browser, v.OS, v.Referer)
	return err
}
