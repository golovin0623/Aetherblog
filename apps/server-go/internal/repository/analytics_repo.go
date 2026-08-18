package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	"golang.org/x/sync/errgroup"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// DashboardData 汇总站点全局统计数据，用于管理端仪表盘展示。
type DashboardData struct {
	PostCount      int64 `db:"post_count"`      // 已发布文章数
	CommentCount   int64 `db:"comment_count"`   // 已审核评论数
	ViewTotal      int64 `db:"view_total"`      // 所有文章总浏览量
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
	TotalCalls        int64                 `db:"total_calls"`    // AI 接口总调用次数
	SuccessCalls      int64                 `db:"success_calls"`  // 成功调用次数
	CachedCalls       int64                 `db:"cached_calls"`   // 缓存命中次数
	TotalTokens       int64                 `db:"total_tokens"`   // 消耗 Token 总量
	EstimatedCost     float64               `db:"estimated_cost"` // 估算费用（美元）
	AvgLatencyMs      float64               `db:"avg_latency_ms"` // 平均耗时（毫秒）
	TaskDistribution  []AITaskDistribution  // 按任务类型细分的统计
	Trend             []AITrendPoint        // 按日聚合趋势
	ModelDistribution []AIModelDistribution // 按模型聚合统计
	Records           AICallRecordPage      // 分页明细记录
}

// AITaskDistribution 持有 ai_usage_logs 表中按任务类型聚合的统计数据。
// Today* 字段为当天（服务器时区 CURRENT_DATE 起）的子集聚合，
// 供前端「灵境对话」等任务专项卡片展示「今日 vs 时间窗」对比。
type AITaskDistribution struct {
	Task              string  `db:"task"`                 // 任务类型名称
	Calls             int64   `db:"calls"`                // 调用次数
	Tokens            int64   `db:"tokens"`               // 消耗 Token 量
	TokensIn          int64   `db:"tokens_in"`            // 输入 Token 量
	TokensOut         int64   `db:"tokens_out"`           // 输出 Token 量
	Cost              float64 `db:"cost"`                 // 估算费用
	AvgLatencyMs      float64 `db:"avg_latency_ms"`       // 平均延迟（毫秒）
	TodayCalls        int64   `db:"today_calls"`          // 今日调用次数
	TodayTokensIn     int64   `db:"today_tokens_in"`      // 今日输入 Token 量
	TodayTokensOut    int64   `db:"today_tokens_out"`     // 今日输出 Token 量
	TodayCost         float64 `db:"today_cost"`           // 今日估算费用
	TodayAvgLatencyMs float64 `db:"today_avg_latency_ms"` // 今日平均延迟（毫秒）
}

// AITrendPoint 表示单日 AI 调用趋势点。
type AITrendPoint struct {
	Date   string  `db:"date"`   // 日期，格式 YYYY-MM-DD
	Calls  int64   `db:"calls"`  // 调用次数
	Tokens int64   `db:"tokens"` // Token 总量
	Cost   float64 `db:"cost"`   // 费用
}

// AIModelDistribution 表示按模型维度聚合的统计数据。
type AIModelDistribution struct {
	Model        string  `db:"model"`         // 展示给前端的模型名
	ProviderCode string  `db:"provider_code"` // 供应商编码
	Calls        int64   `db:"calls"`         // 调用次数
	Tokens       int64   `db:"tokens"`        // Token 总量
	Cost         float64 `db:"cost"`          // 费用
}

// AICallRecord 表示单条 AI 调用明细。
type AICallRecord struct {
	ID             int64     `db:"id"`
	TaskType       string    `db:"task_type"`
	ProviderCode   string    `db:"provider_code"`
	Model          string    `db:"model"`
	TokensIn       int64     `db:"tokens_in"`
	TokensOut      int64     `db:"tokens_out"`
	TotalTokens    int64     `db:"total_tokens"`
	Cost           float64   `db:"cost"`
	CostStatus     string    `db:"cost_status"`
	PricingMissing bool      `db:"pricing_missing"`
	LatencyMs      int64     `db:"latency_ms"`
	Success        bool      `db:"success"`
	Cached         bool      `db:"cached"`
	ErrorCode      *string   `db:"error_code"`
	ArchiveError   *string   `db:"archive_error"`
	CreatedAt      time.Time `db:"created_at"`
}

// AICallRecordPage 表示 AI 调用明细分页结果。
type AICallRecordPage struct {
	List     []AICallRecord
	PageNum  int
	PageSize int
	Total    int64
	Pages    int
}

// AnalyticsRepo 负责所有与统计分析相关的数据库查询操作。
type AnalyticsRepo struct{ db *sqlx.DB }

// NewAnalyticsRepo 创建一个使用给定数据库连接的 AnalyticsRepo 实例。
func NewAnalyticsRepo(db *sqlx.DB) *AnalyticsRepo { return &AnalyticsRepo{db: db} }

// GetDashboard 分别查询多个数据表，汇总站点全局统计数据后返回。
// 涉及表：posts、comments、visit_records、media_files、categories、tags。
func (r *AnalyticsRepo) GetDashboard(ctx context.Context) (*DashboardData, error) {
	today := time.Now().Format("2006-01-02")

	var (
		postStats struct {
			PostCount  int64 `db:"post_count"`
			ViewTotal  int64 `db:"view_total"`
			TotalWords int64 `db:"total_words"`
		}
		mediaStats struct {
			MediaCount int64 `db:"media_count"`
			MediaSize  int64 `db:"media_size"`
		}
		commentCount   int64
		todayVisits    int64
		categoryCount  int64
		tagCount       int64
		uniqueVisitors int64
	)

	g, queryCtx := errgroup.WithContext(ctx)

	// posts 表的全局统计可在一次扫描内完成，避免同表多次并发查询挤占连接池。
	g.Go(func() error {
		return r.db.GetContext(queryCtx, &postStats,
			`SELECT
			    COUNT(*) FILTER (WHERE status = 'PUBLISHED') AS post_count,
			    COALESCE(SUM(view_count), 0) AS view_total,
			    COALESCE(SUM(word_count), 0) AS total_words
			 FROM posts
			 WHERE deleted = false`)
	})

	// 统计已审核通过的评论数
	g.Go(func() error {
		return r.db.GetContext(queryCtx, &commentCount,
			`SELECT COUNT(*) FROM comments WHERE status = 'APPROVED'`)
	})

	// 统计今日非机器人访客数（按创建日期过滤）
	g.Go(func() error {
		return r.db.GetContext(queryCtx, &todayVisits,
			`SELECT COUNT(*) FROM visit_records
			 WHERE is_bot = false
			   AND created_at >= $1::date
			   AND created_at < $1::date + INTERVAL '1 day'`, today)
	})

	// media_files 表的数量和容量统计共享同一过滤条件，合并为一次查询。
	g.Go(func() error {
		return r.db.GetContext(queryCtx, &mediaStats,
			`SELECT
			    COUNT(*) AS media_count,
			    COALESCE(SUM(file_size), 0) AS media_size
			 FROM media_files
			 WHERE deleted = false`)
	})

	// 统计分类总数
	g.Go(func() error {
		return r.db.GetContext(queryCtx, &categoryCount,
			`SELECT COUNT(*) FROM categories`)
	})

	// 统计标签总数
	g.Go(func() error {
		return r.db.GetContext(queryCtx, &tagCount,
			`SELECT COUNT(*) FROM tags`)
	})

	// 统计历史累计独立访客数（排除机器人，基于 visitor_hash 去重）
	g.Go(func() error {
		return r.db.GetContext(queryCtx, &uniqueVisitors,
			`SELECT COUNT(DISTINCT visitor_hash) FROM visit_records WHERE is_bot = false`)
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}

	return &DashboardData{
		PostCount:      postStats.PostCount,
		CommentCount:   commentCount,
		ViewTotal:      postStats.ViewTotal,
		TodayVisits:    todayVisits,
		MediaCount:     mediaStats.MediaCount,
		MediaSize:      mediaStats.MediaSize,
		CategoryCount:  categoryCount,
		TagCount:       tagCount,
		TotalWords:     postStats.TotalWords,
		UniqueVisitors: uniqueVisitors,
	}, nil
}

// GetTopPosts 从 posts 表返回浏览量最高的前 N 篇已发布文章，按 view_count 降序排列。
// limit 指定最多返回的文章数。
func (r *AnalyticsRepo) GetTopPosts(ctx context.Context, limit int) ([]TopPost, error) {
	var rows []TopPost
	err := r.db.SelectContext(ctx, &rows,
		`SELECT id, title, slug, view_count
		             FROM posts
		             WHERE deleted = false AND status = 'PUBLISHED' AND is_hidden = false
		             ORDER BY view_count DESC
		             LIMIT $1`, limit)
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
		`SELECT COUNT(*) FROM visit_records
		 WHERE is_bot = false
		   AND created_at >= $1::date
		   AND created_at < $1::date + INTERVAL '1 day'`, today)
	return n, err
}

// GetAIDashboard 从 ai_usage_logs 表查询聚合的 AI 使用统计数据，包括总调用次数、成功次数、
// Token 消耗量、估算费用，以及按任务类型细分的统计。
func (r *AnalyticsRepo) GetAIDashboard(ctx context.Context) (*AIDashboard, error) {
	return r.GetAIDashboardFiltered(ctx, AIDashboardFilter{
		Days:     30,
		PageNum:  1,
		PageSize: 20,
	})
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
	var (
		postStats struct {
			PostsThisMonth int64 `db:"posts_this_month"`
			PostsLastMonth int64 `db:"posts_last_month"`
			WordsThisMonth int64 `db:"words_this_month"`
			WordsLastMonth int64 `db:"words_last_month"`
		}
		commentStats struct {
			CommentsThisMonth int64 `db:"comments_this_month"`
			CommentsLastMonth int64 `db:"comments_last_month"`
		}
		visitStats struct {
			ViewsThisMonth    int64 `db:"views_this_month"`
			ViewsLastMonth    int64 `db:"views_last_month"`
			VisitorsThisMonth int64 `db:"visitors_this_month"`
			VisitorsLastMonth int64 `db:"visitors_last_month"`
		}
	)

	g, queryCtx := errgroup.WithContext(ctx)

	// posts 表趋势指标共享状态和时间过滤，使用条件聚合减少往返。
	g.Go(func() error {
		return r.db.GetContext(queryCtx, &postStats,
			`SELECT
			    COUNT(*) FILTER (
			      WHERE published_at >= date_trunc('month', NOW())
			    ) AS posts_this_month,
			    COUNT(*) FILTER (
			      WHERE published_at >= date_trunc('month', NOW() - INTERVAL '1 month')
			        AND published_at < date_trunc('month', NOW())
			    ) AS posts_last_month,
			    COALESCE(SUM(word_count) FILTER (
			      WHERE published_at >= date_trunc('month', NOW())
			    ), 0) AS words_this_month,
			    COALESCE(SUM(word_count) FILTER (
			      WHERE published_at >= date_trunc('month', NOW() - INTERVAL '1 month')
			        AND published_at < date_trunc('month', NOW())
			    ), 0) AS words_last_month
			 FROM posts
			 WHERE deleted = false
			   AND status = 'PUBLISHED'
			   AND published_at >= date_trunc('month', NOW() - INTERVAL '1 month')`)
	})

	// comments 表趋势指标共享审核状态和时间过滤。
	g.Go(func() error {
		return r.db.GetContext(queryCtx, &commentStats,
			`SELECT
			    COUNT(*) FILTER (
			      WHERE created_at >= date_trunc('month', NOW())
			    ) AS comments_this_month,
			    COUNT(*) FILTER (
			      WHERE created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
			        AND created_at < date_trunc('month', NOW())
			    ) AS comments_last_month
			 FROM comments
			 WHERE status = 'APPROVED'
			   AND created_at >= date_trunc('month', NOW() - INTERVAL '1 month')`)
	})

	// visit_records 表趋势指标共享机器人过滤和时间范围。
	g.Go(func() error {
		return r.db.GetContext(queryCtx, &visitStats,
			`SELECT
			    COUNT(*) FILTER (
			      WHERE created_at >= date_trunc('month', NOW())
			    ) AS views_this_month,
			    COUNT(*) FILTER (
			      WHERE created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
			        AND created_at < date_trunc('month', NOW())
			    ) AS views_last_month,
			    COUNT(DISTINCT visitor_hash) FILTER (
			      WHERE created_at >= date_trunc('month', NOW())
			    ) AS visitors_this_month,
			    COUNT(DISTINCT visitor_hash) FILTER (
			      WHERE created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
			        AND created_at < date_trunc('month', NOW())
			    ) AS visitors_last_month
			 FROM visit_records
			 WHERE is_bot = false
			   AND created_at >= date_trunc('month', NOW() - INTERVAL '1 month')`)
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}

	return &TrendsData{
		PostsThisMonth:    postStats.PostsThisMonth,
		PostsLastMonth:    postStats.PostsLastMonth,
		CommentsThisMonth: commentStats.CommentsThisMonth,
		CommentsLastMonth: commentStats.CommentsLastMonth,
		ViewsThisMonth:    visitStats.ViewsThisMonth,
		ViewsLastMonth:    visitStats.ViewsLastMonth,
		VisitorsThisMonth: visitStats.VisitorsThisMonth,
		VisitorsLastMonth: visitStats.VisitorsLastMonth,
		WordsThisMonth:    postStats.WordsThisMonth,
		WordsLastMonth:    postStats.WordsLastMonth,
	}, nil
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
		`SELECT COALESCE(INITCAP(device_type), 'Unknown') AS name, COUNT(*) AS value
		 FROM visit_records
		 WHERE is_bot = false AND created_at >= NOW() - INTERVAL '30 days'
		 GROUP BY INITCAP(device_type)
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

func buildAIDashboardWhere(f AIDashboardFilter) (string, []any) {
	return buildAIDashboardWhereWithAlias(f, "")
}

func calcPages(total int64, pageSize int) int {
	if total <= 0 || pageSize <= 0 {
		return 0
	}
	return int((total + int64(pageSize) - 1) / int64(pageSize))
}

// GetAIDashboardFiltered 根据 AIDashboardFilter 中的条件，从 ai_usage_logs 表动态拼接 WHERE 子句，
// 返回过滤后的 AI 使用聚合统计数据及按任务类型细分的统计。
func (r *AnalyticsRepo) GetAIDashboardFiltered(ctx context.Context, f AIDashboardFilter) (*AIDashboard, error) {
	var d AIDashboard
	where, args := buildAIDashboardWhereWithAlias(f, "l")
	supportsCostArchive, err := r.hasAICostArchiveColumns(ctx)
	if err != nil {
		return nil, err
	}
	pageNum := f.PageNum
	if pageNum <= 0 {
		pageNum = 1
	}
	pageSize := f.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	offset := (pageNum - 1) * pageSize

	cte := buildPricedLogsCTE(where, supportsCostArchive)

	aggQuery := cte + `
SELECT
    COUNT(*) AS total_calls,
    COUNT(*) FILTER (WHERE success) AS success_calls,
    COUNT(*) FILTER (WHERE cached) AS cached_calls,
    COALESCE(SUM(total_tokens), 0) AS total_tokens,
    COALESCE(SUM(COALESCE(cost, 0)), 0.0) AS estimated_cost,
    COALESCE(AVG(latency_ms), 0.0) AS avg_latency_ms
FROM priced_logs`

	if err := r.db.GetContext(ctx, &d, aggQuery, args...); err != nil {
		return nil, err
	}

	taskQuery := cte + `
SELECT
    task_type AS task,
    COUNT(*) AS calls,
    COALESCE(SUM(total_tokens), 0) AS tokens,
    COALESCE(SUM(tokens_in), 0) AS tokens_in,
    COALESCE(SUM(tokens_out), 0) AS tokens_out,
    COALESCE(SUM(COALESCE(cost, 0)), 0.0) AS cost,
    COALESCE(AVG(latency_ms), 0.0) AS avg_latency_ms,
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today_calls,
    COALESCE(SUM(tokens_in) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS today_tokens_in,
    COALESCE(SUM(tokens_out) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS today_tokens_out,
    COALESCE(SUM(COALESCE(cost, 0)) FILTER (WHERE created_at >= CURRENT_DATE), 0.0) AS today_cost,
    COALESCE(AVG(latency_ms) FILTER (WHERE created_at >= CURRENT_DATE), 0.0) AS today_avg_latency_ms
FROM priced_logs
GROUP BY task_type
ORDER BY calls DESC, task ASC`

	var taskStats []AITaskDistribution
	if err := r.db.SelectContext(ctx, &taskStats, taskQuery, args...); err != nil {
		return nil, err
	}
	d.TaskDistribution = taskStats

	trendQuery := cte + `,
daily AS (
    SELECT
        DATE(created_at)::text AS date,
        COUNT(*) AS calls,
        COALESCE(SUM(total_tokens), 0) AS tokens,
        COALESCE(SUM(COALESCE(cost, 0)), 0.0) AS cost
    FROM priced_logs
    GROUP BY DATE(created_at)::text
)
SELECT
    date,
    calls,
    tokens,
    cost
FROM daily
ORDER BY date ASC`

	var trend []AITrendPoint
	if err := r.db.SelectContext(ctx, &trend, trendQuery, args...); err != nil {
		return nil, err
	}
	d.Trend = trend

	modelQuery := cte + `
SELECT
    model,
    provider_code,
    COUNT(*) AS calls,
    COALESCE(SUM(total_tokens), 0) AS tokens,
    COALESCE(SUM(COALESCE(cost, 0)), 0.0) AS cost
FROM priced_logs
GROUP BY model, provider_code
ORDER BY calls DESC, model ASC
LIMIT 8`

	var modelStats []AIModelDistribution
	if err := r.db.SelectContext(ctx, &modelStats, modelQuery, args...); err != nil {
		return nil, err
	}
	d.ModelDistribution = modelStats

	countQuery := cte + ` SELECT COUNT(*) FROM priced_logs`
	if err := r.db.GetContext(ctx, &d.Records.Total, countQuery, args...); err != nil {
		return nil, err
	}

	recordQuery := cte + fmt.Sprintf(`
SELECT
    id,
    task_type,
    provider_code,
    model,
    tokens_in,
    tokens_out,
    total_tokens,
    COALESCE(cost, 0.0) AS cost,
    cost_status,
    pricing_missing,
    latency_ms,
    success,
    cached,
    error_code,
    archive_error,
    created_at
FROM priced_logs
ORDER BY created_at DESC
LIMIT $%d OFFSET $%d`, len(args)+1, len(args)+2)
	args = append(args, pageSize, offset)

	var records []AICallRecord
	if err := r.db.SelectContext(ctx, &records, recordQuery, args...); err != nil {
		return nil, err
	}

	d.Records = AICallRecordPage{
		List:     records,
		PageNum:  pageNum,
		PageSize: pageSize,
		Total:    d.Records.Total,
		Pages:    calcPages(d.Records.Total, pageSize),
	}

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
