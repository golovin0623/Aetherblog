package service

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// --- AnalyticsService 对外暴露的 DTO ---

// DashboardVO 汇总站点核心统计指标，用于管理后台概览面板。
type DashboardVO struct {
	PostCount      int64 `json:"postCount"`      // 文章总数
	CommentCount   int64 `json:"commentCount"`   // 评论总数
	ViewTotal      int64 `json:"viewTotal"`      // 累计浏览量
	TodayVisits    int64 `json:"todayVisits"`    // 今日访问量
	MediaCount     int64 `json:"mediaCount"`     // 媒体文件总数
	MediaSize      int64 `json:"mediaSize"`      // 媒体文件总体积（字节）
	CategoryCount  int64 `json:"categoryCount"`  // 分类总数
	TagCount       int64 `json:"tagCount"`       // 标签总数
	TotalWords     int64 `json:"totalWords"`     // 全站文章总字数
	UniqueVisitors int64 `json:"uniqueVisitors"` // 独立访客数
}

// TopPostVO 表示按浏览量排行的热门文章条目。
type TopPostVO struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Slug      string `json:"slug"`
	ViewCount int64  `json:"viewCount"`
}

// DailyVisitVO 表示单日的页面浏览量（PV）和独立访客数（UV）。
type DailyVisitVO struct {
	Date string `json:"date"` // 日期，格式 YYYY-MM-DD
	PV   int64  `json:"pv"`   // 页面浏览量
	UV   int64  `json:"uv"`   // 独立访客数
}

// AiTrendPointVO 表示单日 AI 调用趋势点。
type AiTrendPointVO struct {
	Date   string  `json:"date"`
	Calls  int64   `json:"calls"`
	Tokens int64   `json:"tokens"`
	Cost   float64 `json:"cost"`
}

// AiModelDistributionVO 表示按模型聚合的调用占比数据。
type AiModelDistributionVO struct {
	Model        string  `json:"model"`
	ProviderCode string  `json:"providerCode"`
	Calls        int64   `json:"calls"`
	Percentage   float64 `json:"percentage"`
	Tokens       int64   `json:"tokens"`
	Cost         float64 `json:"cost"`
}

// AiTaskDistributionVO 表示按任务类型聚合的调用占比数据。
type AiTaskDistributionVO struct {
	Task       string  `json:"task"`
	Calls      int64   `json:"calls"`
	Percentage float64 `json:"percentage"`
	Tokens     int64   `json:"tokens"`
	Cost       float64 `json:"cost"`
}

// AiCallRecordVO 表示单条 AI 调用明细。
type AiCallRecordVO struct {
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
}

// AiRecordsPageVO 表示 AI 调用明细分页结果。
type AiRecordsPageVO struct {
	List     []AiCallRecordVO `json:"list"`
	PageNum  int              `json:"pageNum"`
	PageSize int              `json:"pageSize"`
	Total    int64            `json:"total"`
	Pages    int              `json:"pages"`
}

// AIDashboardVO 是 AI 使用统计面板的综合 DTO。
type AIDashboardVO struct {
	RangeDays         int                     `json:"rangeDays"`         // 统计时间范围（天数）
	Overview          AiOverviewVO            `json:"overview"`          // 整体汇总指标
	Trend             []AiTrendPointVO        `json:"trend"`             // 趋势数据
	ModelDistribution []AiModelDistributionVO `json:"modelDistribution"` // 模型分布
	TaskDistribution  []AiTaskDistributionVO  `json:"taskDistribution"`  // 按任务类型分布
	Records           AiRecordsPageVO         `json:"records"`           // 详细记录
}

// AiOverviewVO 汇总 AI 服务的调用成功率、Token 用量、费用及延迟等核心指标。
type AiOverviewVO struct {
	TotalCalls       int64   `json:"totalCalls"`       // 总调用次数
	SuccessCalls     int64   `json:"successCalls"`     // 成功次数
	ErrorCalls       int64   `json:"errorCalls"`       // 失败次数
	SuccessRate      float64 `json:"successRate"`      // 成功率（百分比）
	CacheHitRate     float64 `json:"cacheHitRate"`     // 缓存命中率（预留）
	TotalTokens      int64   `json:"totalTokens"`      // 消耗 Token 总数
	TotalCost        float64 `json:"totalCost"`        // 估算费用（美元）
	AvgLatencyMs     float64 `json:"avgLatencyMs"`     // 平均延迟（毫秒，预留）
	AvgTokensPerCall float64 `json:"avgTokensPerCall"` // 每次调用平均 Token 数
	AvgCostPerCall   float64 `json:"avgCostPerCall"`   // 每次调用平均费用
}

// AnalyticsService 封装统计分析仓储层，对外暴露站点数据统计业务方法。
type AnalyticsService struct {
	repo *repository.AnalyticsRepo
}

// NewAnalyticsService 使用给定的仓储创建 AnalyticsService 实例。
func NewAnalyticsService(repo *repository.AnalyticsRepo) *AnalyticsService {
	return &AnalyticsService{repo: repo}
}

func ratio(part, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return float64(part) / float64(total) * 100
}

func mapAiOverview(d *repository.AIDashboard) AiOverviewVO {
	var avgTokensPerCall, avgCostPerCall float64
	if d.TotalCalls > 0 {
		avgTokensPerCall = float64(d.TotalTokens) / float64(d.TotalCalls)
		avgCostPerCall = d.EstimatedCost / float64(d.TotalCalls)
	}

	return AiOverviewVO{
		TotalCalls:       d.TotalCalls,
		SuccessCalls:     d.SuccessCalls,
		ErrorCalls:       d.TotalCalls - d.SuccessCalls,
		SuccessRate:      ratio(d.SuccessCalls, d.TotalCalls),
		CacheHitRate:     ratio(d.CachedCalls, d.TotalCalls),
		TotalTokens:      d.TotalTokens,
		TotalCost:        d.EstimatedCost,
		AvgLatencyMs:     d.AvgLatencyMs,
		AvgTokensPerCall: avgTokensPerCall,
		AvgCostPerCall:   avgCostPerCall,
	}
}

func mapAiTrend(rows []repository.AITrendPoint) []AiTrendPointVO {
	vos := make([]AiTrendPointVO, len(rows))
	for i, row := range rows {
		vos[i] = AiTrendPointVO{
			Date:   row.Date,
			Calls:  row.Calls,
			Tokens: row.Tokens,
			Cost:   row.Cost,
		}
	}
	return vos
}

func mapAiModelDistribution(rows []repository.AIModelDistribution, totalCalls int64) []AiModelDistributionVO {
	vos := make([]AiModelDistributionVO, len(rows))
	for i, row := range rows {
		vos[i] = AiModelDistributionVO{
			Model:        row.Model,
			ProviderCode: row.ProviderCode,
			Calls:        row.Calls,
			Percentage:   ratio(row.Calls, totalCalls),
			Tokens:       row.Tokens,
			Cost:         row.Cost,
		}
	}
	return vos
}

func mapAiTaskDistribution(rows []repository.AITaskDistribution, totalCalls int64) []AiTaskDistributionVO {
	vos := make([]AiTaskDistributionVO, len(rows))
	for i, row := range rows {
		vos[i] = AiTaskDistributionVO{
			Task:       row.Task,
			Calls:      row.Calls,
			Percentage: ratio(row.Calls, totalCalls),
			Tokens:     row.Tokens,
			Cost:       row.Cost,
		}
	}
	return vos
}

func mapAiRecords(page repository.AICallRecordPage) AiRecordsPageVO {
	vos := make([]AiCallRecordVO, len(page.List))
	for i, row := range page.List {
		vos[i] = AiCallRecordVO{
			ID:           row.ID,
			TaskType:     row.TaskType,
			ProviderCode: row.ProviderCode,
			Model:        row.Model,
			TokensIn:     row.TokensIn,
			TokensOut:    row.TokensOut,
			TotalTokens:  row.TotalTokens,
			Cost:         row.Cost,
			LatencyMs:    row.LatencyMs,
			Success:      row.Success,
			Cached:       row.Cached,
			ErrorCode:    row.ErrorCode,
			CreatedAt:    row.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	return AiRecordsPageVO{
		List:     vos,
		PageNum:  page.PageNum,
		PageSize: page.PageSize,
		Total:    page.Total,
		Pages:    page.Pages,
	}
}

func buildAIDashboardVO(d *repository.AIDashboard, rangeDays int) *AIDashboardVO {
	return &AIDashboardVO{
		RangeDays:         rangeDays,
		Overview:          mapAiOverview(d),
		Trend:             mapAiTrend(d.Trend),
		ModelDistribution: mapAiModelDistribution(d.ModelDistribution, d.TotalCalls),
		TaskDistribution:  mapAiTaskDistribution(d.TaskDistribution, d.TotalCalls),
		Records:           mapAiRecords(d.Records),
	}
}

// GetDashboard 返回站点核心统计汇总数据，包括文章数、评论数、浏览量、媒体文件等。
func (s *AnalyticsService) GetDashboard(ctx context.Context) (*DashboardVO, error) {
	d, err := s.repo.GetDashboard(ctx)
	if err != nil {
		return nil, err
	}
	return &DashboardVO{
		PostCount:      d.PostCount,
		CommentCount:   d.CommentCount,
		ViewTotal:      d.ViewTotal,
		TodayVisits:    d.TodayVisits,
		MediaCount:     d.MediaCount,
		MediaSize:      d.MediaSize,
		CategoryCount:  d.CategoryCount,
		TagCount:       d.TagCount,
		TotalWords:     d.TotalWords,
		UniqueVisitors: d.UniqueVisitors,
	}, nil
}

// GetTopPosts 返回按浏览量降序排列的前 10 篇热门文章。
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

// GetVisitorTrend 返回最近 N 天的每日 PV/UV 趋势数据。
// 当 days <= 0 时，默认使用 30 天。
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

// GetAIDashboard 返回默认 30 天范围的 AI 使用统计数据，
// 包括成功率、Token 用量、费用及按任务类型分布等。
func (s *AnalyticsService) GetAIDashboard(ctx context.Context) (*AIDashboardVO, error) {
	d, err := s.repo.GetAIDashboard(ctx)
	if err != nil {
		return nil, err
	}
	return buildAIDashboardVO(d, 30), nil
}

// RecordVisit 以"即发即忘"的方式在后台 goroutine 中异步记录一次页面访问。
// 访客哈希值 = SHA-256(ip + userAgent)，用于去重统计独立访客（UV）。
// 使用 context.Background() 避免请求结束后 goroutine 被取消。
func (s *AnalyticsService) RecordVisit(ctx context.Context, pageURL, pageTitle, ip, ua, referer string) {
	go func() {
		// 生成访客指纹哈希，用于 UV 去重
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

		// 解析 User-Agent 获取设备类型、浏览器和操作系统信息
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
		// 使用独立的 Background context，防止请求上下文取消后记录失败
		_ = s.repo.RecordVisit(context.Background(), v)
	}()
}

// parseUserAgent 通过简单的字符串匹配（不依赖外部库）从 User-Agent 字符串中
// 提取设备类型（Mobile/Tablet/Desktop）、浏览器名称和操作系统名称。
// 当 ua 为空时，三个字段均返回 "Unknown"。
func parseUserAgent(ua string) (deviceType, browser, osName string) {
	if ua == "" {
		return "Unknown", "Unknown", "Unknown"
	}
	lower := strings.ToLower(ua)

	// 判断设备类型：优先平板，其次手机，默认桌面
	switch {
	case strings.Contains(lower, "ipad") || strings.Contains(lower, "tablet"):
		deviceType = "Tablet"
	case strings.Contains(lower, "mobile") || strings.Contains(lower, "android") || strings.Contains(lower, "iphone"):
		deviceType = "Mobile"
	default:
		deviceType = "Desktop"
	}

	// 识别浏览器：Edge 优先于 Chrome，Opera 优先于 Chrome
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

	// 识别操作系统
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

// TrendsVO 存储各项指标的环比（月度）百分比变化值。
type TrendsVO struct {
	Posts          float64 `json:"posts"`          // 文章数环比变化（%）
	Categories     float64 `json:"categories"`     // 分类数变化（暂无时间维度，始终为 0）
	Views          float64 `json:"views"`          // 浏览量环比变化（%）
	Visitors       float64 `json:"visitors"`       // 独立访客数环比变化（%）
	Comments       float64 `json:"comments"`       // 评论数环比变化（%）
	Words          float64 `json:"words"`          // 总字数环比变化（%）
	PostsThisMonth int64   `json:"postsThisMonth"` // 本月新增文章绝对数量
}

// GetTrends 返回各项关键指标的月度环比百分比变化。
// 分类不具备时间维度统计，固定返回 0。
func (s *AnalyticsService) GetTrends(ctx context.Context) (*TrendsVO, error) {
	d, err := s.repo.GetTrends(ctx)
	if err != nil {
		return nil, err
	}
	return &TrendsVO{
		Posts:          pctChange(d.PostsThisMonth, d.PostsLastMonth),
		Categories:     0, // 分类不具备时间维度趋势统计
		Views:          pctChange(d.ViewsThisMonth, d.ViewsLastMonth),
		Visitors:       pctChange(d.VisitorsThisMonth, d.VisitorsLastMonth),
		Comments:       pctChange(d.CommentsThisMonth, d.CommentsLastMonth),
		Words:          pctChange(d.WordsThisMonth, d.WordsLastMonth),
		PostsThisMonth: d.PostsThisMonth,
	}, nil
}

// pctChange 计算环比百分比变化：(current - previous) / max(previous, 1) * 100。
// 当 previous < 1 时将其视为 1，避免除零错误。
func pctChange(current, previous int64) float64 {
	prev := previous
	if prev < 1 {
		prev = 1
	}
	return float64(current-previous) / float64(prev) * 100
}

// DeviceStatVO 表示某设备类型的访问量统计条目。
type DeviceStatVO struct {
	Name  string `json:"name"`  // 设备类型名称（如 Mobile、Desktop、Tablet）
	Value int64  `json:"value"` // 该类型的访问次数
}

// deviceNameZH 将英文设备类型名称映射为中文展示名。
var deviceNameZH = map[string]string{
	"Desktop": "桌面端",
	"Mobile":  "移动端",
	"Tablet":  "平板",
}

// GetDeviceStats 返回最近 30 天内各设备类型的访问量分布。
func (s *AnalyticsService) GetDeviceStats(ctx context.Context) ([]DeviceStatVO, error) {
	rows, err := s.repo.GetDeviceStats(ctx)
	if err != nil {
		return nil, err
	}
	vos := make([]DeviceStatVO, len(rows))
	for i, r := range rows {
		name := r.Name
		if zh, ok := deviceNameZH[name]; ok {
			name = zh
		} else if name == "" || name == "Unknown" {
			name = "其他"
		}
		vos[i] = DeviceStatVO{Name: name, Value: r.Value}
	}
	return vos, nil
}

// GetAIDashboardFiltered 返回按指定过滤条件（时间范围、任务类型等）筛选的 AI 使用统计数据。
// 当 f.Days <= 0 时，默认使用 30 天。
func (s *AnalyticsService) GetAIDashboardFiltered(ctx context.Context, f repository.AIDashboardFilter) (*AIDashboardVO, error) {
	if f.Days <= 0 {
		f.Days = 30
	}
	if f.PageNum <= 0 {
		f.PageNum = 1
	}
	if f.PageSize <= 0 {
		f.PageSize = 20
	}

	d, err := s.repo.GetAIDashboardFiltered(ctx, f)
	if err != nil {
		return nil, err
	}
	return buildAIDashboardVO(d, f.Days), nil
}

// GetTodayCount 返回今日的页面访问总次数（PV）。
func (s *AnalyticsService) GetTodayCount(ctx context.Context) (int64, error) {
	return s.repo.GetTodayVisitCount(ctx)
}

// ArchiveMonthVO 表示归档统计中单个月份的文章数量条目。
type ArchiveMonthVO struct {
	YearMonth string `json:"yearMonth"` // 月份，格式 YYYY-MM
	Count     int64  `json:"count"`     // 该月发布的文章数量
}

// GetArchiveStats 返回按月份分组的文章数量统计，用于归档页面展示。
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
