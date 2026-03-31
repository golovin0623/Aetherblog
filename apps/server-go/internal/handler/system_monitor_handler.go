package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// SystemMonitorHandler 处理所有系统监控相关的 HTTP 接口。
type SystemMonitorHandler struct {
	monitor   *service.SystemMonitorService   // 系统指标采集服务
	container *service.ContainerMonitorService // Docker 容器监控服务
	logViewer *service.LogViewerService        // 日志查看服务
	history   *service.MetricsHistoryService   // 历史指标存储服务
	db        *sqlx.DB                         // 数据库连接（用于健康检查和存储统计）
	rdb       *redis.Client                    // Redis 客户端（用于健康检查和内存统计）
	cfg       *config.Config                   // 应用配置
}

// NewSystemMonitorHandler 创建 SystemMonitorHandler 实例。
func NewSystemMonitorHandler(
	monitor *service.SystemMonitorService,
	container *service.ContainerMonitorService,
	logViewer *service.LogViewerService,
	history *service.MetricsHistoryService,
	db *sqlx.DB,
	rdb *redis.Client,
	cfg *config.Config,
) *SystemMonitorHandler {
	return &SystemMonitorHandler{
		monitor:   monitor,
		container: container,
		logViewer: logViewer,
		history:   history,
		db:        db,
		rdb:       rdb,
		cfg:       cfg,
	}
}

// MountAdmin 将所有系统监控路由注册到指定路由组。
// 预期挂载路径为 /api/v1/admin/system，调用方应已配置 JWT 认证中间件。
func (h *SystemMonitorHandler) MountAdmin(g *echo.Group) {
	g.GET("/metrics", h.GetMetrics)
	g.GET("/storage", h.GetStorage)
	g.GET("/health", h.GetHealth)
	g.GET("/overview", h.GetOverview)
	g.GET("/containers", h.GetContainers)
	g.GET("/containers/:id/logs", h.GetContainerLogs)
	g.GET("/logs", h.GetLogs)
	g.GET("/logs/files", h.GetLogFiles)
	g.GET("/logs/download", h.DownloadLog)
	g.POST("/network/test", h.NetworkTest)
	g.GET("/history", h.GetHistory)
	g.GET("/history/stats", h.GetHistoryStats)
	g.DELETE("/history", h.CleanHistory)
	g.GET("/alerts", h.GetAlerts)
	g.GET("/config", h.GetConfig)
}

// GetMetrics 处理 GET /api/v1/admin/system/metrics 请求。
// 采集并返回当前 CPU、内存、磁盘、网络等系统性能指标（扁平化结构）。
func (h *SystemMonitorHandler) GetMetrics(c echo.Context) error {
	metrics := h.monitor.CollectMetrics()
	return response.OK(c, h.flattenMetrics(metrics))
}

// GetStorage 处理 GET /api/v1/admin/system/storage 请求。
// 返回各存储子系统（上传文件、日志、数据库、Redis）的磁盘占用明细。
func (h *SystemMonitorHandler) GetStorage(c echo.Context) error {
	breakdown := h.collectStorageBreakdown()
	return response.OK(c, breakdown)
}

// GetHealth 处理 GET /api/v1/admin/system/health 请求。
// 检查并返回所有依赖服务（数据库、Redis、Elasticsearch、AI 服务）的健康状态。
func (h *SystemMonitorHandler) GetHealth(c echo.Context) error {
	health := h.checkServiceHealth()
	return response.OK(c, health)
}

// GetOverview 处理 GET /api/v1/admin/system/overview 请求。
// 聚合返回系统指标、存储占用和服务健康状态的综合概览。
func (h *SystemMonitorHandler) GetOverview(c echo.Context) error {
	metrics := h.monitor.CollectMetrics()
	storage := h.collectStorageBreakdown()
	health := h.checkServiceHealth()

	return response.OK(c, map[string]any{
		"metrics":  h.flattenMetrics(metrics),
		"storage":  storage,
		"services": health,
	})
}

// GetContainers 处理 GET /api/v1/admin/system/containers 请求。
// 返回所有 Docker 容器的运行状态概览。
func (h *SystemMonitorHandler) GetContainers(c echo.Context) error {
	overview := h.container.ListContainers()
	return response.OK(c, overview)
}

// GetContainerLogs 处理 GET /api/v1/admin/system/containers/:id/logs 请求。
// 返回指定容器的最新日志行（以换行符分割的字符串数组）。
// 路径参数 id 为容器 ID 或名称；查询参数 tail 指定返回行数，默认 200。
func (h *SystemMonitorHandler) GetContainerLogs(c echo.Context) error {
	id := c.Param("id")
	if id == "" {
		return response.FailCode(c, response.ParamMiss)
	}
	// 解析 tail 参数，默认返回最新 200 行
	tail, _ := strconv.Atoi(c.QueryParam("tail"))
	if tail <= 0 {
		tail = 200
	}

	logs, err := h.container.GetContainerLogs(id, tail)
	if err != nil {
		return response.Fail(c, err.Error())
	}
	// 将日志字符串按换行符分割为数组返回
	lines := strings.Split(strings.TrimRight(logs, "\n"), "\n")
	if len(lines) == 1 && lines[0] == "" {
		lines = []string{}
	}
	return response.OK(c, lines)
}

// GetLogs 处理 GET /api/v1/admin/system/logs 请求。
// 读取应用日志，支持按级别、关键词过滤及游标分页。
// 查询参数：level（日志级别）、limit/lines（返回行数，默认 100）、keyword（关键词）、cursor（游标）。
func (h *SystemMonitorHandler) GetLogs(c echo.Context) error {
	level := c.QueryParam("level")
	limitStr := c.QueryParam("limit")
	linesStr := c.QueryParam("lines")
	keyword := c.QueryParam("keyword")
	cursor := c.QueryParam("cursor")

	// 解析返回行数限制，limit 优先于 lines
	limit := 100
	if limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil {
			limit = v
		}
	} else if linesStr != "" {
		if v, err := strconv.Atoi(linesStr); err == nil {
			limit = v
		}
	}

	result, err := h.logViewer.ReadLogs(level, limit, keyword, cursor)
	if err != nil {
		return response.Fail(c, err.Error())
	}
	// 将 JSON 格式的日志行转换为前端日志查看器可直接展示的可读文本格式
	for i, line := range result.Lines {
		result.Lines[i] = formatLogLine(line)
	}
	return response.OK(c, result)
}

// GetLogFiles 处理 GET /api/v1/admin/system/logs/files 请求。
// 返回所有可用的日志文件列表。
func (h *SystemMonitorHandler) GetLogFiles(c echo.Context) error {
	files := h.logViewer.ListLogFiles()
	return response.OK(c, files)
}

// DownloadLog 处理 GET /api/v1/admin/system/logs/download 请求。
// 以文件附件形式下载指定级别的日志文件。
// 查询参数 level 为日志级别（如 info、error）。
func (h *SystemMonitorHandler) DownloadLog(c echo.Context) error {
	level := c.QueryParam("level")
	path, err := h.logViewer.GetLogFilePath(level)
	if err != nil {
		return response.Fail(c, err.Error())
	}
	return c.Attachment(path, filepath.Base(path))
}

// NetworkTest 处理 POST /api/v1/admin/system/network/test 请求。
// 通过 TCP 拨号测试各依赖服务（Google DNS、Cloudflare DNS、AI 服务、PostgreSQL、Redis）的网络连通性，
// 返回每个目标的连接状态和延迟（毫秒）。
func (h *SystemMonitorHandler) NetworkTest(c echo.Context) error {
	// TestResult 表示单次网络连通性测试结果
	type TestResult struct {
		Name    string  `json:"name"`
		Host    string  `json:"host"`
		Status  string  `json:"status"`
		Latency float64 `json:"latency"`
		Message string  `json:"message,omitempty"`
	}

	// 预设测试目标：Google DNS 和 Cloudflare DNS
	targets := []struct {
		name string
		addr string
	}{
		{"Google DNS", "8.8.8.8:53"},
		{"Cloudflare DNS", "1.1.1.1:53"},
	}

	// 若已配置 AI 服务地址，则加入测试目标
	if h.cfg.AI.BaseURL != "" {
		if u, err := url.Parse(h.cfg.AI.BaseURL); err == nil {
			host := u.Host
			// 若主机名未包含端口，根据协议补充默认端口
			if !strings.Contains(host, ":") {
				if u.Scheme == "https" {
					host += ":443"
				} else {
					host += ":80"
				}
			}
			targets = append(targets, struct {
				name string
				addr string
			}{"AI Service", host})
		}
	}

	// 添加 PostgreSQL 测试目标
	targets = append(targets, struct {
		name string
		addr string
	}{"PostgreSQL", fmt.Sprintf("%s:%d", h.cfg.Database.Host, h.cfg.Database.Port)})

	// 添加 Redis 测试目标
	targets = append(targets, struct {
		name string
		addr string
	}{"Redis", h.cfg.Redis.Addr()})

	// 对每个目标执行 TCP 连接测试并记录延迟
	var results []TestResult
	for _, t := range targets {
		start := time.Now()
		conn, err := net.DialTimeout("tcp", t.addr, 3*time.Second)
		latency := float64(time.Since(start).Microseconds()) / 1000.0 // 转换为毫秒

		r := TestResult{
			Name: t.name,
			Host: t.addr,
		}
		if err != nil {
			r.Status = "failed"
			r.Latency = 0
			r.Message = err.Error()
		} else {
			conn.Close()
			r.Status = "ok"
			r.Latency = latency
		}
		results = append(results, r)
	}

	return response.OK(c, map[string]any{
		"status":    "completed",
		"results":   results,
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// GetHistory 处理 GET /api/v1/admin/system/history 请求。
// 返回指定时间范围内的历史性能指标数据。
// 查询参数：minutes（时间跨度，分钟）、maxPoints（最大数据点数）。
func (h *SystemMonitorHandler) GetHistory(c echo.Context) error {
	minutes, _ := strconv.Atoi(c.QueryParam("minutes"))
	maxPoints, _ := strconv.Atoi(c.QueryParam("maxPoints"))

	hist := h.history.GetHistory(minutes, maxPoints)
	return response.OK(c, hist)
}

// GetHistoryStats 处理 GET /api/v1/admin/system/history/stats 请求。
// 返回历史指标数据的统计摘要（如均值、峰值等）。
func (h *SystemMonitorHandler) GetHistoryStats(c echo.Context) error {
	stats := h.history.GetStats()
	return response.OK(c, stats)
}

// CleanHistory 处理 DELETE /api/v1/admin/system/history 请求。
// 清空历史指标记录，返回实际删除的条目数量。
func (h *SystemMonitorHandler) CleanHistory(c echo.Context) error {
	count := h.history.CleanHistory()
	return response.OK(c, count)
}

// GetAlerts 处理 GET /api/v1/admin/system/alerts 请求。
// 返回当前触发的系统告警列表（如 CPU/内存超阈值告警）。
func (h *SystemMonitorHandler) GetAlerts(c echo.Context) error {
	alerts := h.history.GetAlerts()
	return response.OK(c, alerts)
}

// GetConfig 处理 GET /api/v1/admin/system/config 请求。
// 返回系统监控模块的当前配置（如采集间隔、告警阈值等）。
func (h *SystemMonitorHandler) GetConfig(c echo.Context) error {
	cfg := h.history.GetConfig()
	return response.OK(c, cfg)
}

// collectStorageBreakdown 汇总各存储子系统的磁盘占用情况。
// 包括：上传文件目录、日志目录、PostgreSQL 数据库大小、Redis 内存占用。
func (h *SystemMonitorHandler) collectStorageBreakdown() service.StorageBreakdown {
	var breakdown service.StorageBreakdown

	// 统计上传文件目录大小和文件数量
	uploadSize, uploadCount := dirSizeAndCount(h.cfg.Upload.Path)
	breakdown.Uploads = service.StorageItem{
		Name:      "uploads",
		Size:      uploadSize,
		FileCount: uploadCount,
		Formatted: service.FormatBytes(uploadSize),
	}

	// 统计日志目录大小和文件数量
	logSize, logCount := dirSizeAndCount(h.cfg.Log.Path)
	breakdown.Logs = service.StorageItem{
		Name:      "logs",
		Size:      logSize,
		FileCount: logCount,
		Formatted: service.FormatBytes(logSize),
	}

	// 通过 pg_database_size() 查询当前数据库占用空间
	var dbSize int64
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = h.db.QueryRowContext(ctx, "SELECT pg_database_size(current_database())").Scan(&dbSize)
	breakdown.Database = service.StorageItem{
		Name:      "database",
		Size:      dbSize,
		FileCount: 0,
		Formatted: service.FormatBytes(dbSize),
	}

	// 通过 Redis INFO memory 命令获取内存占用
	var redisSize int64
	rctx, rcancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer rcancel()
	info, err := h.rdb.Info(rctx, "memory").Result()
	if err == nil {
		redisSize = parseRedisMemory(info)
	}
	breakdown.Redis = service.StorageItem{
		Name:      "redis",
		Size:      redisSize,
		FileCount: 0,
		Formatted: service.FormatBytes(redisSize),
	}

	// 汇总各项占用总量
	total := uploadSize + logSize + dbSize + redisSize
	breakdown.TotalSize = total
	breakdown.UsedSize = total

	// 计算相对于磁盘总容量的使用百分比
	disk := h.monitor.CollectMetrics().Disk
	if disk.TotalBytes > 0 {
		breakdown.UsedPercent = float64(total) / float64(disk.TotalBytes) * 100
	}

	return breakdown
}

// ServiceHealth 表示单个服务的健康检查结果。
type ServiceHealth struct {
	Name    string `json:"name"`    // 服务名称
	Status  string `json:"status"`  // 状态："up" 或 "down"
	Latency int64  `json:"latency"` // 响应延迟（毫秒）
	Message string `json:"message"` // 错误信息（正常时为空字符串）
}

// checkServiceHealth 检查所有依赖服务的健康状态，返回结果数组。
// 依次检查：PostgreSQL、Redis、Elasticsearch、AI 服务。
func (h *SystemMonitorHandler) checkServiceHealth() []ServiceHealth {
	var result []ServiceHealth

	// 检查 PostgreSQL 连接状态
	dbStatus := "up"
	dbMsg := ""
	dbLatency := measureLatency(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		return h.db.PingContext(ctx)
	})
	if dbLatency < 0 {
		dbStatus = "down"
		dbMsg = "Connection failed"
		dbLatency = 0
	}
	result = append(result, ServiceHealth{Name: "database", Status: dbStatus, Latency: dbLatency, Message: dbMsg})

	// 检查 Redis 连接状态
	redisStatus := "up"
	redisMsg := ""
	redisLatency := measureLatency(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return h.rdb.Ping(ctx).Err()
	})
	if redisLatency < 0 {
		redisStatus = "down"
		redisMsg = "Connection failed"
		redisLatency = 0
	}
	result = append(result, ServiceHealth{Name: "redis", Status: redisStatus, Latency: redisLatency, Message: redisMsg})

	// 检查 Elasticsearch 连接状态（通过 HTTP GET 请求根路径）
	esStatus := "down"
	esMsg := ""
	var esLatency int64
	if len(h.cfg.ES.URIs) > 0 {
		esLatency = measureLatency(func() error {
			client := &http.Client{Timeout: 3 * time.Second}
			resp, err := client.Get(h.cfg.ES.URIs[0])
			if err != nil {
				return err
			}
			resp.Body.Close()
			return nil
		})
		if esLatency >= 0 {
			esStatus = "up"
		} else {
			esMsg = "Connection failed"
			esLatency = 0
		}
	} else {
		// 未配置 ES 地址，视为不可用
		esStatus = "down"
	}
	result = append(result, ServiceHealth{Name: "elasticsearch", Status: esStatus, Latency: esLatency, Message: esMsg})

	// 检查 AI 服务健康状态（通过 GET /health 接口探测）
	aiStatus := "down"
	aiMsg := ""
	var aiLatency int64
	if h.cfg.AI.BaseURL != "" {
		aiLatency = measureLatency(func() error {
			client := &http.Client{Timeout: 3 * time.Second}
			resp, err := client.Get(h.cfg.AI.BaseURL + "/health")
			if err != nil {
				return err
			}
			resp.Body.Close()
			return nil
		})
		if aiLatency >= 0 {
			aiStatus = "up"
		} else {
			aiMsg = "Connection failed"
			aiLatency = 0
		}
	} else {
		// 未配置 AI 服务地址，视为不可用
		aiStatus = "down"
	}
	result = append(result, ServiceHealth{Name: "ai", Status: aiStatus, Latency: aiLatency, Message: aiMsg})

	return result
}

// flattenMetrics 将嵌套的 SystemMetrics 结构体转换为前端所需的扁平化键值映射。
func (h *SystemMonitorHandler) flattenMetrics(m service.SystemMetrics) map[string]any {
	return map[string]any{
		"cpuUsage":        m.CPU.UsagePercent,
		"cpuCores":        m.CPU.Cores,
		"cpuModel":        getCPUModel(),
		"cpuFrequency":    0, // 暂不支持，固定返回 0
		"memoryUsed":      m.Memory.UsedBytes,
		"memoryTotal":     m.Memory.TotalBytes,
		"memoryPercent":   m.Memory.UsagePercent,
		"diskUsed":        m.Disk.UsedBytes,
		"diskTotal":       m.Disk.TotalBytes,
		"diskPercent":     m.Disk.UsagePercent,
		"networkIn":       m.Network.BytesIn,
		"networkOut":      m.Network.BytesOut,
		"networkInSpeed":  0,   // 暂不支持，固定返回 0
		"networkOutSpeed": 0,   // 暂不支持，固定返回 0
		"networkInRate":   0.0, // 暂不支持，固定返回 0.0
		"networkOutRate":  0.0, // 暂不支持，固定返回 0.0
		"networkPercent":  0.0, // 暂不支持，固定返回 0.0
		"networkMaxSpeed": 0,   // 暂不支持，固定返回 0
		"uptime":          m.Go.Uptime,
		"osName":          runtime.GOOS,
		"osArch":          runtime.GOARCH,
	}
}

// getCPUModel 返回 CPU 型号字符串。
// macOS 系统通过 sysctl 命令获取具体型号；其他系统返回 "OS/架构" 格式字符串。
func getCPUModel() string {
	if runtime.GOOS == "darwin" {
		out, err := execCommand("sysctl", "-n", "machdep.cpu.brand_string")
		if err == nil {
			return strings.TrimSpace(string(out))
		}
	}
	return fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH)
}

// execCommand 执行外部命令并返回标准输出。
func execCommand(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).Output()
}

// measureLatency 测量指定检查函数的执行耗时（毫秒）。
// 若检查函数返回错误，则返回 -1 表示失败。
func measureLatency(fn func() error) int64 {
	start := time.Now()
	if err := fn(); err != nil {
		return -1
	}
	return time.Since(start).Milliseconds()
}

// formatLogLine 将 JSON 格式的日志行转换为统一的可读文本格式：
//
//	[模块名称    ] 时间戳           级别  链路ID   日志内容
//
// 示例：[backend   ] 2026-03-29 16:12:00 INFO  d171f7b3 GET /api/v1/admin/posts → 200 (12ms)
// 若输入不是合法 JSON，则原样返回。
func formatLogLine(line string) string {
	var entry map[string]any
	if json.Unmarshal([]byte(line), &entry) != nil {
		return line // 非 JSON 格式，原样返回
	}

	svc := fmt.Sprint(entry["service"])
	level := strings.ToUpper(fmt.Sprint(entry["level"]))
	msg := fmt.Sprint(entry["message"])
	traceId, _ := entry["traceId"].(string)
	// traceId 为空时显示占位符，过长时截取前 8 位
	if traceId == "" {
		traceId = "--------"
	} else if len(traceId) > 8 {
		traceId = traceId[:8]
	}

	// 解析时间戳：支持毫秒时间戳（数字）和 RFC3339 字符串两种格式
	ts := ""
	if t, ok := entry["time"].(float64); ok {
		ts = time.UnixMilli(int64(t)).Format("2006-01-02 15:04:05")
	} else if t, ok := entry["timestamp"].(string); ok {
		if parsed, err := time.Parse(time.RFC3339Nano, t); err == nil {
			ts = parsed.Format("2006-01-02 15:04:05")
		} else {
			ts = t
		}
	}

	// 构建日志正文：HTTP 请求日志单独格式化，包含方法/路径/状态码/延迟
	body := msg
	if method, ok := entry["method"].(string); ok {
		path, _ := entry["path"].(string)
		status, _ := entry["status"].(float64)
		latency, _ := entry["latency_ms"].(float64)
		body = fmt.Sprintf("%s %s → %d (%dms)", method, path, int(status), int(latency))
	}

	return fmt.Sprintf("[%-10s] %s %-5s %s %s", svc, ts, level, traceId, body)
}

// dirSizeAndCount 递归计算指定目录下所有文件的总大小（字节）和文件数量。
func dirSizeAndCount(path string) (int64, int) {
	var size int64
	var count int
	_ = filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		size += info.Size()
		count++
		return nil
	})
	return size, count
}

// parseRedisMemory 从 Redis INFO memory 命令的输出中提取 used_memory 字段值（字节）。
func parseRedisMemory(info string) int64 {
	for _, line := range splitLines(info) {
		if len(line) > 0 && line[0] != '#' {
			parts := splitKV(line)
			if len(parts) == 2 && parts[0] == "used_memory" {
				v, _ := strconv.ParseInt(parts[1], 10, 64)
				return v
			}
		}
	}
	return 0
}

// splitLines 将字符串按换行符（支持 \r\n 和 \n）分割为行切片。
func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			// 去除行尾的回车符（Windows 换行兼容）
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
			start = i + 1
		}
	}
	// 处理末尾无换行的最后一行
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

// splitKV 将 "key:value" 格式的字符串按第一个冒号分割为键值对切片。
// 若不含冒号，则返回仅包含原字符串的单元素切片。
func splitKV(s string) []string {
	idx := -1
	for i := 0; i < len(s); i++ {
		if s[i] == ':' {
			idx = i
			break
		}
	}
	if idx < 0 {
		return []string{s}
	}
	return []string{s[:idx], s[idx+1:]}
}
