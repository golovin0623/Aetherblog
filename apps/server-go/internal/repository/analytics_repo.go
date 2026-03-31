package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// DashboardData 汇总站点全局统计数据，用于管理端仪表盘展示。
type DashboardData struct {
	PostCount      int64 `db:"post_count"`      // 已发布文章数
	CommentCount   int64 `db:"comment_count"`   // 已审核评论数
	ViewTotal      int64 `db:"view_total"`       // 所有文章总浏览量
	TodayVisits    int64 `db:"today_visits"`    // 今日访客数（排除机器人）
	MediaCount     int64 `db:"media_count"`     // 媒体文件数（未删除）
	MediaSize      int64 `db:"media_size"`      // 媒体文件总大小（字节）
	CategoryCount  int64 `db:"category_count"`  // 分类总数
	TagCount       int64 `db:"tag_count"`       // 标签总数
	TotalWords     int64 `db:"total_words"`     // 所有文章总字数
	UniqueVisitors int64 `db:"unique_visitors"` // 历史累计独立访客数（排除机器人）
}

// TopPost 是按浏览量排序的轻量文章行，用于"热门文章"列表展示。
type TopPost struct {
	ID        int64  `db:"id"`
	Title     string `db:"title"`
	Slug      string `db:"slug"`
	ViewCount int64  `db:"view_count"`
}

// DailyVisit 表示某一天的访问统计数据。
type DailyVisit struct {
	Date string `db:"visit_date"` // 日期，格式 YYYY-MM-DD
	PV   int64  `db:"pv"`         // 页面浏览量（Page View）
	UV   int64  `db:"uv"`         // 独立访客数（Unique Visitor）
}

// AIDashboard 汇总 AI 功能使用统计数据。
type AIDashboard struct {
	TotalCalls    int64          `db:"total_calls"`     // AI 接口总调用次数
	SuccessCalls  int64          `db:"success_calls"`   // 成功调用次数
	TotalTokens   int64          `db:"total_tokens"`    // 消耗 Token 总量
	EstimatedCost float64        `db:"estimated_cost"`  // 估算费用（美元）
	ByTaskType    []TaskTypeStat // 按任务类型细分的统计
}

// TaskTypeStat 持有 ai_usage_logs 表中按任务类型聚合的统计数据。
type TaskTypeStat struct {
	TaskType string `db:"task_type"` // 任务类型名称
	Count    int64  `db:"cnt"`       // 调用次数
	Tokens   int64  `db:"tokens"`    // 消耗 Token 量
}

// AnalyticsRepo 负责所有与统计分析相关的数据库查询操作。
type AnalyticsRepo struct{ db *sqlx.DB }

// NewAnalyticsRepo 创建一个使用给定数据库连接的 AnalyticsRepo 实例。
func NewAnalyticsRepo(db *sqlx.DB) *AnalyticsRepo { return &AnalyticsRepo{db: db} }

// GetDashboard 分别查询多个数据表，汇总站点全局统计数据后返回。
// 涉及表：posts、comments、visit_records、media_files、categories、tags。
func (r *AnalyticsRepo) GetDashboard(ctx context.Context) (*DashboardData, error) {
	today := time.Now().Format("2006-01-02")

	var d DashboardData

	// 统计已发布且未删除的文章数
	if err := r.db.GetContext(ctx, &d.PostCount,
		`SELECT COUNT(*) FROM posts WHERE deleted = false AND status = 'PUBLISHED'`); err != nil {
		return nil, err
	}

	// 统计已审核通过的评论数
	if err := r.db.GetContext(ctx, &d.CommentCount,
		`SELECT COUNT(*) FROM comments WHERE status = 'APPROVED'`); err != nil {
		return nil, err
	}

	// 统计所有未删除文章的浏览量总和
	if err := r.db.GetContext(ctx, &d.ViewTotal,
		`SELECT COALESCE(SUM(view_count), 0) FROM posts WHERE deleted = false`); err != nil {
		return nil, err
	}

	// 统计今日非机器人访客数（按创建日期过滤）
	if err := r.db.GetContext(ctx, &d.TodayVisits,
		`SELECT COUNT(*) FROM visit_records WHERE is_bot = false AND DATE(created_at) = $1`, today); err != nil {
		return nil, err
	}

	// 统计未删除媒体文件数
	if err := r.db.GetContext(ctx, &d.MediaCount,
		`SELECT COUNT(*) FROM media_files WHERE deleted = false`); err != nil {
		return nil, err
	}

	// 统计未删除媒体文件的存储总大小
	if err := r.db.GetContext(ctx, &d.MediaSize,
		`SELECT COALESCE(SUM(file_size), 0) FROM media_files WHERE deleted = false`); err != nil {
		return nil, err
	}

	// 统计分类总数
	if err := r.db.GetContext(ctx, &d.CategoryCount,
		`SELECT COUNT(*) FROM categories`); err != nil {
		return nil, err
	}

	// 统计标签总数
	if err := r.db.GetContext(ctx, &d.TagCount,
		`SELECT COUNT(*) FROM tags`); err != nil {
		return nil, err
	}

	// 统计所有未删除文章的总字数
	if err := r.db.GetContext(ctx, &d.TotalWords,
		`SELECT COALESCE(SUM(word_count), 0) FROM posts WHERE deleted = false`); err != nil {
		return nil, err
	}

	// 统计历史累计独立访客数（排除机器人，基于 visitor_hash 去重）
	if err := r.db.GetContext(ctx, &d.UniqueVisitors,
		`SELECT COUNT(DISTINCT visitor_hash) FROM visit_records WHERE is_bot = false`); err != nil {
		return nil, err
	}

	return &d, nil
}

// GetTopPosts 从 posts 表返回浏览量最高的前 N 篇已发布文章，按 view_count 降序排列。
// limit 指定最多返回的文章数。
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

// GetVisitorTrend 从 visit_records 表返回最近 N 天的每日 PV/UV 趋势数据，按日期升序排列。
// days 指定统计的天数范围。
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

// GetTodayVisitCount 从 visit_records 表返回今日非机器人访问总次数。
func (r *AnalyticsRepo) GetTodayVisitCount(ctx context.Context) (int64, error) {
	today := time.Now().Format("2006-01-02")
	var n int64
	err := r.db.GetContext(ctx, &n,
		`SELECT COUNT(*) FROM visit_records WHERE is_bot = false AND DATE(created_at) = $1`, today)
	return n, err
}

// GetAIDashboard 从 ai_usage_logs 表查询聚合的 AI 使用统计数据，包括总调用次数、成功次数、
// Token 消耗量、估算费用，以及按任务类型细分的统计。
func (r *AnalyticsRepo) GetAIDashboard(ctx context.Context) (*AIDashboard, error) {
	var d AIDashboard

	// 查询 AI 整体聚合指标
	if err := r.db.GetContext(ctx, &d,
		`SELECT
		    COUNT(*)                           AS total_calls,
		    COUNT(*) FILTER (WHERE success)    AS success_calls,
		    COALESCE(SUM(total_tokens), 0)     AS total_tokens,
		    COALESCE(SUM(estimated_cost), 0.0) AS estimated_cost
		 FROM ai_usage_logs`); err != nil {
		return nil, err
	}

	// 按任务类型分组统计调用次数和 Token 消耗，按调用量降序排列
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

// ArchiveMonthStat 持有某年月的文章发布数量统计，用于博客归档展示。
type ArchiveMonthStat struct {
	YearMonth string `db:"year_month"` // 格式 YYYY-MM
	Count     int64  `db:"count"`      // 该月发布的文章数
}

// GetArchiveStats 从 posts 表按月统计已发布文章数，按年月降序返回（最新月份在前）。
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

// TrendsData 持有当月与上月的环比对比数据，用于仪表盘趋势展示。
type TrendsData struct {
	PostsThisMonth    int64 `db:"posts_this_month"`    // 本月新发布文章数
	PostsLastMonth    int64 `db:"posts_last_month"`    // 上月新发布文章数
	CommentsThisMonth int64 `db:"comments_this_month"` // 本月新增审核评论数
	CommentsLastMonth int64 `db:"comments_last_month"` // 上月新增审核评论数
	ViewsThisMonth    int64 `db:"views_this_month"`    // 本月访问量
	ViewsLastMonth    int64 `db:"views_last_month"`    // 上月访问量
	VisitorsThisMonth int64 `db:"visitors_this_month"` // 本月独立访客数
	VisitorsLastMonth int64 `db:"visitors_last_month"` // 上月独立访客数
	WordsThisMonth    int64 `db:"words_this_month"`    // 本月发布文章总字数
	WordsLastMonth    int64 `db:"words_last_month"`    // 上月发布文章总字数
}

// GetTrends 分别从 posts、comments、visit_records 表查询当月与上月的对比数据，
// 使用 date_trunc('month', NOW()) 精确划定月份边界。
func (r *AnalyticsRepo) GetTrends(ctx context.Context) (*TrendsData, error) {
	var d TrendsData

	// 本月新发布文章数
	if err := r.db.GetContext(ctx, &d.PostsThisMonth,
		`SELECT COUNT(*) FROM posts WHERE deleted = false AND status = 'PUBLISHED'
		 AND published_at >= date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// 上月新发布文章数（上月月初 ≤ published_at < 本月月初）
	if err := r.db.GetContext(ctx, &d.PostsLastMonth,
		`SELECT COUNT(*) FROM posts WHERE deleted = false AND status = 'PUBLISHED'
		 AND published_at >= date_trunc('month', NOW() - INTERVAL '1 month')
		 AND published_at < date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// 本月已审核评论数
	if err := r.db.GetContext(ctx, &d.CommentsThisMonth,
		`SELECT COUNT(*) FROM comments WHERE status = 'APPROVED'
		 AND created_at >= date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// 上月已审核评论数
	if err := r.db.GetContext(ctx, &d.CommentsLastMonth,
		`SELECT COUNT(*) FROM comments WHERE status = 'APPROVED'
		 AND created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
		 AND created_at < date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// 本月访问量（来自 visit_records，排除机器人）
	if err := r.db.GetContext(ctx, &d.ViewsThisMonth,
		`SELECT COUNT(*) FROM visit_records WHERE is_bot = false
		 AND created_at >= date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// 上月访问量
	if err := r.db.GetContext(ctx, &d.ViewsLastMonth,
		`SELECT COUNT(*) FROM visit_records WHERE is_bot = false
		 AND created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
		 AND created_at < date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// 本月独立访客数（基于 visitor_hash 去重）
	if err := r.db.GetContext(ctx, &d.VisitorsThisMonth,
		`SELECT COUNT(DISTINCT visitor_hash) FROM visit_records WHERE is_bot = false
		 AND created_at >= date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// 上月独立访客数
	if err := r.db.GetContext(ctx, &d.VisitorsLastMonth,
		`SELECT COUNT(DISTINCT visitor_hash) FROM visit_records WHERE is_bot = false
		 AND created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
		 AND created_at < date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// 本月发布文章总字数
	if err := r.db.GetContext(ctx, &d.WordsThisMonth,
		`SELECT COALESCE(SUM(word_count), 0) FROM posts WHERE deleted = false AND status = 'PUBLISHED'
		 AND published_at >= date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	// 上月发布文章总字数
	if err := r.db.GetContext(ctx, &d.WordsLastMonth,
		`SELECT COALESCE(SUM(word_count), 0) FROM posts WHERE deleted = false AND status = 'PUBLISHED'
		 AND published_at >= date_trunc('month', NOW() - INTERVAL '1 month')
		 AND published_at < date_trunc('month', NOW())`); err != nil {
		return nil, err
	}

	return &d, nil
}

// DeviceStat 持有设备类型分布数据，用于访问来源统计图表展示。
type DeviceStat struct {
	Name  string `db:"name" json:"name"`   // 设备类型名称（如 Desktop、Mobile、Unknown）
	Value int64  `db:"value" json:"value"` // 该设备类型的访问次数
}

// GetDeviceStats 从 visit_records 表统计近 30 天内各设备类型的访问次数分布，
// 排除机器人访问，按访问量降序返回最多 10 种设备类型。
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

// AIDashboardFilter 持有过滤 AI 统计查询的参数。
type AIDashboardFilter struct {
	Days     int    // 查询最近 N 天的数据，0 表示不限时间
	TaskType string // 按任务类型过滤，为空时不过滤
	ModelID  string // 按模型 ID 过滤，为空时不过滤
	Success  *bool  // 按成功状态过滤，nil 表示不过滤
	Keyword  string // 关键字模糊搜索（匹配 task_type 或 model_id）
	PageNum  int    // 页码（从 1 开始）
	PageSize int    // 每页大小
}

// GetAIDashboardFiltered 根据 AIDashboardFilter 中的条件，从 ai_usage_logs 表动态拼接 WHERE 子句，
// 返回过滤后的 AI 使用聚合统计数据及按任务类型细分的统计。
func (r *AnalyticsRepo) GetAIDashboardFiltered(ctx context.Context, f AIDashboardFilter) (*AIDashboard, error) {
	var d AIDashboard

	// 动态构建 WHERE 子句
	where := "WHERE 1=1"
	args := []any{}
	argIdx := 1

	if f.Days > 0 {
		// 限制时间范围为最近 N 天
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
		// 关键字同时模糊匹配 task_type 和 model_id（不区分大小写）
		where += fmt.Sprintf(" AND (task_type ILIKE $%d OR model_id ILIKE $%d)", argIdx, argIdx)
		args = append(args, "%"+f.Keyword+"%")
		argIdx++
	}

	// 查询聚合指标（总调用次数、成功次数、Token 量、费用）
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

	// 按任务类型分组统计，按调用量降序排列
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

// RecordVisit 向 visit_records 表插入一条新的访问记录，is_bot 固定为 false，created_at 由数据库自动填充。
func (r *AnalyticsRepo) RecordVisit(ctx context.Context, v *model.VisitRecord) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO visit_records
		    (post_id, page_url, page_title, visitor_hash, ip, user_agent, device_type, browser, os, referer, is_bot, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, NOW())`,
		v.PostID, v.PageURL, v.PageTitle, v.VisitorHash, v.IP, v.UserAgent, v.DeviceType, v.Browser, v.OS, v.Referer)
	return err
}
