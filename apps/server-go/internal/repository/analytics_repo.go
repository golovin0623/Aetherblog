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
	PostCount     int64 `db:"post_count"`
	CommentCount  int64 `db:"comment_count"`
	ViewTotal     int64 `db:"view_total"`
	TodayVisits   int64 `db:"today_visits"`
	MediaCount    int64 `db:"media_count"`
	MediaSize     int64 `db:"media_size"`
	CategoryCount int64 `db:"category_count"`
	TagCount      int64 `db:"tag_count"`
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
	Date  string `db:"visit_date"`
	Count int64  `db:"cnt"`
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

	return &d, nil
}

// GetTopPosts returns the top N posts ordered by view_count descending.
func (r *AnalyticsRepo) GetTopPosts(ctx context.Context, limit int) ([]TopPost, error) {
	var rows []TopPost
	err := r.db.SelectContext(ctx, &rows,
		fmt.Sprintf(`SELECT id, title, slug, view_count
		             FROM posts
		             WHERE deleted = false AND status = 'PUBLISHED'
		             ORDER BY view_count DESC
		             LIMIT %d`, limit))
	return rows, err
}

// GetVisitorTrend returns daily visit counts for the last N days.
func (r *AnalyticsRepo) GetVisitorTrend(ctx context.Context, days int) ([]DailyVisit, error) {
	var rows []DailyVisit
	err := r.db.SelectContext(ctx, &rows,
		fmt.Sprintf(`SELECT DATE(created_at)::text AS visit_date, COUNT(*) AS cnt
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

// RecordVisit inserts a new visit record row.
func (r *AnalyticsRepo) RecordVisit(ctx context.Context, v *model.VisitRecord) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO visit_records
		    (post_id, page_url, page_title, visitor_hash, ip, user_agent, referer, is_bot, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW())`,
		v.PostID, v.PageURL, v.PageTitle, v.VisitorHash, v.IP, v.UserAgent, v.Referer)
	return err
}
