package handler

import (
	"context"
	"fmt"
	"net/http"
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

// SystemMonitorHandler handles all system monitoring endpoints.
type SystemMonitorHandler struct {
	monitor   *service.SystemMonitorService
	container *service.ContainerMonitorService
	logViewer *service.LogViewerService
	history   *service.MetricsHistoryService
	db        *sqlx.DB
	rdb       *redis.Client
	cfg       *config.Config
}

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

// MountAdmin registers all system monitor routes on the given group.
// The group is expected to be /api/v1/admin/system (already JWT-protected).
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

// GET /api/v1/admin/system/metrics
func (h *SystemMonitorHandler) GetMetrics(c echo.Context) error {
	metrics := h.monitor.CollectMetrics()
	return response.OK(c, h.flattenMetrics(metrics))
}

// GET /api/v1/admin/system/storage
func (h *SystemMonitorHandler) GetStorage(c echo.Context) error {
	breakdown := h.collectStorageBreakdown()
	return response.OK(c, breakdown)
}

// GET /api/v1/admin/system/health
func (h *SystemMonitorHandler) GetHealth(c echo.Context) error {
	health := h.checkServiceHealth()
	return response.OK(c, health)
}

// GET /api/v1/admin/system/overview
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

// GET /api/v1/admin/system/containers
func (h *SystemMonitorHandler) GetContainers(c echo.Context) error {
	overview := h.container.ListContainers()
	return response.OK(c, overview)
}

// GET /api/v1/admin/system/containers/:id/logs
func (h *SystemMonitorHandler) GetContainerLogs(c echo.Context) error {
	id := c.Param("id")
	if id == "" {
		return response.FailCode(c, response.ParamMiss)
	}
	tail, _ := strconv.Atoi(c.QueryParam("tail"))
	if tail <= 0 {
		tail = 200
	}

	logs, err := h.container.GetContainerLogs(id, tail)
	if err != nil {
		return response.Fail(c, err.Error())
	}
	// Return as string array, split by newline
	lines := strings.Split(strings.TrimRight(logs, "\n"), "\n")
	if len(lines) == 1 && lines[0] == "" {
		lines = []string{}
	}
	return response.OK(c, lines)
}

// GET /api/v1/admin/system/logs
func (h *SystemMonitorHandler) GetLogs(c echo.Context) error {
	level := c.QueryParam("level")
	limitStr := c.QueryParam("limit")
	linesStr := c.QueryParam("lines")
	keyword := c.QueryParam("keyword")
	cursor := c.QueryParam("cursor")

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
	return response.OK(c, result)
}

// GET /api/v1/admin/system/logs/files
func (h *SystemMonitorHandler) GetLogFiles(c echo.Context) error {
	files := h.logViewer.ListLogFiles()
	return response.OK(c, files)
}

// GET /api/v1/admin/system/logs/download
func (h *SystemMonitorHandler) DownloadLog(c echo.Context) error {
	level := c.QueryParam("level")
	path, err := h.logViewer.GetLogFilePath(level)
	if err != nil {
		return response.Fail(c, err.Error())
	}
	return c.Attachment(path, filepath.Base(path))
}

// POST /api/v1/admin/system/network/test
func (h *SystemMonitorHandler) NetworkTest(c echo.Context) error {
	return response.OK(c, map[string]any{
		"status":  "completed",
		"message": "Network bandwidth test is a placeholder. Actual testing not implemented.",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// GET /api/v1/admin/system/history
func (h *SystemMonitorHandler) GetHistory(c echo.Context) error {
	minutes, _ := strconv.Atoi(c.QueryParam("minutes"))
	maxPoints, _ := strconv.Atoi(c.QueryParam("maxPoints"))

	hist := h.history.GetHistory(minutes, maxPoints)
	return response.OK(c, hist)
}

// GET /api/v1/admin/system/history/stats
func (h *SystemMonitorHandler) GetHistoryStats(c echo.Context) error {
	stats := h.history.GetStats()
	return response.OK(c, stats)
}

// DELETE /api/v1/admin/system/history
func (h *SystemMonitorHandler) CleanHistory(c echo.Context) error {
	count := h.history.CleanHistory()
	return response.OK(c, count)
}

// GET /api/v1/admin/system/alerts
func (h *SystemMonitorHandler) GetAlerts(c echo.Context) error {
	alerts := h.history.GetAlerts()
	return response.OK(c, alerts)
}

// GET /api/v1/admin/system/config
func (h *SystemMonitorHandler) GetConfig(c echo.Context) error {
	cfg := h.history.GetConfig()
	return response.OK(c, cfg)
}

// collectStorageBreakdown gathers storage usage from various subsystems.
func (h *SystemMonitorHandler) collectStorageBreakdown() service.StorageBreakdown {
	var breakdown service.StorageBreakdown

	// Upload directory size
	uploadSize, uploadCount := dirSizeAndCount(h.cfg.Upload.Path)
	breakdown.Uploads = service.StorageItem{
		Name:      "uploads",
		Size:      uploadSize,
		FileCount: uploadCount,
		Formatted: service.FormatBytes(uploadSize),
	}

	// Log directory size
	logSize, logCount := dirSizeAndCount(h.cfg.Log.Path)
	breakdown.Logs = service.StorageItem{
		Name:      "logs",
		Size:      logSize,
		FileCount: logCount,
		Formatted: service.FormatBytes(logSize),
	}

	// Database size (pg_database_size)
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

	// Redis memory
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

	total := uploadSize + logSize + dbSize + redisSize
	breakdown.TotalSize = total
	breakdown.UsedSize = total

	// Calculate used percent against disk total
	disk := h.monitor.CollectMetrics().Disk
	if disk.TotalBytes > 0 {
		breakdown.UsedPercent = float64(total) / float64(disk.TotalBytes) * 100
	}

	return breakdown
}

// ServiceHealth represents the health of a single service.
type ServiceHealth struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Latency int64  `json:"latency"`
	Message string `json:"message"`
}

// checkServiceHealth checks the health of all dependent services and returns an array.
func (h *SystemMonitorHandler) checkServiceHealth() []ServiceHealth {
	var result []ServiceHealth

	// Database
	dbStatus := "UP"
	dbMsg := ""
	dbLatency := measureLatency(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		return h.db.PingContext(ctx)
	})
	if dbLatency < 0 {
		dbStatus = "DOWN"
		dbMsg = "Connection failed"
		dbLatency = 0
	}
	result = append(result, ServiceHealth{Name: "database", Status: dbStatus, Latency: dbLatency, Message: dbMsg})

	// Redis
	redisStatus := "UP"
	redisMsg := ""
	redisLatency := measureLatency(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return h.rdb.Ping(ctx).Err()
	})
	if redisLatency < 0 {
		redisStatus = "DOWN"
		redisMsg = "Connection failed"
		redisLatency = 0
	}
	result = append(result, ServiceHealth{Name: "redis", Status: redisStatus, Latency: redisLatency, Message: redisMsg})

	// Elasticsearch
	esStatus := "DOWN"
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
			esStatus = "UP"
		} else {
			esMsg = "Connection failed"
			esLatency = 0
		}
	} else {
		esStatus = "NOT_CONFIGURED"
	}
	result = append(result, ServiceHealth{Name: "elasticsearch", Status: esStatus, Latency: esLatency, Message: esMsg})

	// AI Service
	aiStatus := "DOWN"
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
			aiStatus = "UP"
		} else {
			aiMsg = "Connection failed"
			aiLatency = 0
		}
	} else {
		aiStatus = "NOT_CONFIGURED"
	}
	result = append(result, ServiceHealth{Name: "ai", Status: aiStatus, Latency: aiLatency, Message: aiMsg})

	return result
}

// flattenMetrics converts the nested SystemMetrics into a flat map matching the frontend type.
func (h *SystemMonitorHandler) flattenMetrics(m service.SystemMetrics) map[string]any {
	return map[string]any{
		"cpuUsage":        m.CPU.UsagePercent,
		"cpuCores":        m.CPU.Cores,
		"cpuModel":        getCPUModel(),
		"cpuFrequency":    0,
		"memoryUsed":      m.Memory.UsedBytes,
		"memoryTotal":     m.Memory.TotalBytes,
		"memoryPercent":   m.Memory.UsagePercent,
		"diskUsed":        m.Disk.UsedBytes,
		"diskTotal":       m.Disk.TotalBytes,
		"diskPercent":     m.Disk.UsagePercent,
		"networkIn":       m.Network.BytesIn,
		"networkOut":      m.Network.BytesOut,
		"networkInSpeed":  0,
		"networkOutSpeed": 0,
		"networkInRate":   0.0,
		"networkOutRate":  0.0,
		"networkPercent":  0.0,
		"networkMaxSpeed": 0,
		"uptime":          m.Go.Uptime,
		"osName":          runtime.GOOS,
		"osArch":          runtime.GOARCH,
	}
}

// getCPUModel returns the CPU model string.
func getCPUModel() string {
	if runtime.GOOS == "darwin" {
		out, err := execCommand("sysctl", "-n", "machdep.cpu.brand_string")
		if err == nil {
			return strings.TrimSpace(string(out))
		}
	}
	return fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH)
}

func execCommand(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).Output()
}

// measureLatency measures how long a check takes. Returns -1 if the check fails.
func measureLatency(fn func() error) int64 {
	start := time.Now()
	if err := fn(); err != nil {
		return -1
	}
	return time.Since(start).Milliseconds()
}

// dirSizeAndCount calculates the total size and file count in a directory.
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

// parseRedisMemory extracts used_memory from Redis INFO memory output.
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

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

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
