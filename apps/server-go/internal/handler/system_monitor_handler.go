package handler

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
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
	return response.OK(c, metrics)
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
		"metrics": metrics,
		"storage": storage,
		"health":  health,
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
	return response.OK(c, map[string]any{
		"containerId": id,
		"logs":        logs,
		"lines":       len(logs),
	})
}

// GET /api/v1/admin/system/logs
func (h *SystemMonitorHandler) GetLogs(c echo.Context) error {
	level := c.QueryParam("level")
	limitStr := c.QueryParam("limit")
	keyword := c.QueryParam("keyword")
	cursor := c.QueryParam("cursor")

	limit := 100
	if limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil {
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
	return response.OK(c, map[string]any{
		"deletedPoints": count,
		"message":       fmt.Sprintf("Cleaned %d metric snapshots", count),
	})
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
	uploadSize := dirSize(h.cfg.Upload.Path)
	breakdown.Upload = service.StorageItem{
		Name:  "uploads",
		Size:  uploadSize,
		Label: "Media Uploads",
	}

	// Log directory size
	logSize := dirSize(h.cfg.Log.Path)
	breakdown.Logs = service.StorageItem{
		Name:  "logs",
		Size:  logSize,
		Label: "Application Logs",
	}

	// Database size (pg_database_size)
	var dbSize int64
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = h.db.QueryRowContext(ctx, "SELECT pg_database_size(current_database())").Scan(&dbSize)
	breakdown.Database = service.StorageItem{
		Name:  "database",
		Size:  dbSize,
		Label: "PostgreSQL Database",
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
		Name:  "redis",
		Size:  redisSize,
		Label: "Redis Cache",
	}

	breakdown.Total = uploadSize + logSize + dbSize + redisSize
	return breakdown
}

// checkServiceHealth checks the health of all dependent services.
func (h *SystemMonitorHandler) checkServiceHealth() map[string]any {
	services := make(map[string]any)

	// Database
	dbStatus := "UP"
	dbLatency := measureLatency(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		return h.db.PingContext(ctx)
	})
	if dbLatency < 0 {
		dbStatus = "DOWN"
		dbLatency = 0
	}
	services["database"] = map[string]any{
		"status":    dbStatus,
		"latencyMs": dbLatency,
	}

	// Redis
	redisStatus := "UP"
	redisLatency := measureLatency(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return h.rdb.Ping(ctx).Err()
	})
	if redisLatency < 0 {
		redisStatus = "DOWN"
		redisLatency = 0
	}
	services["redis"] = map[string]any{
		"status":    redisStatus,
		"latencyMs": redisLatency,
	}

	// Elasticsearch (attempt connection)
	esStatus := "UNKNOWN"
	if len(h.cfg.ES.URIs) > 0 {
		esLatency := measureLatency(func() error {
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
			services["elasticsearch"] = map[string]any{
				"status":    esStatus,
				"latencyMs": esLatency,
			}
		} else {
			esStatus = "DOWN"
			services["elasticsearch"] = map[string]any{
				"status":    esStatus,
				"latencyMs": 0,
			}
		}
	} else {
		services["elasticsearch"] = map[string]any{
			"status": "NOT_CONFIGURED",
		}
	}

	// AI Service
	aiStatus := "UNKNOWN"
	if h.cfg.AI.BaseURL != "" {
		aiLatency := measureLatency(func() error {
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
			services["ai"] = map[string]any{
				"status":    aiStatus,
				"latencyMs": aiLatency,
			}
		} else {
			aiStatus = "DOWN"
			services["ai"] = map[string]any{
				"status":    aiStatus,
				"latencyMs": 0,
			}
		}
	} else {
		services["ai"] = map[string]any{
			"status": "NOT_CONFIGURED",
		}
	}

	// Overall status
	overallStatus := "UP"
	if dbStatus == "DOWN" {
		overallStatus = "DOWN"
	} else if redisStatus == "DOWN" || esStatus == "DOWN" {
		overallStatus = "DEGRADED"
	}

	return map[string]any{
		"status":   overallStatus,
		"services": services,
	}
}

// measureLatency measures how long a check takes. Returns -1 if the check fails.
func measureLatency(fn func() error) int64 {
	start := time.Now()
	if err := fn(); err != nil {
		return -1
	}
	return time.Since(start).Milliseconds()
}

// dirSize calculates the total size of files in a directory.
func dirSize(path string) int64 {
	var size int64
	_ = filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		size += info.Size()
		return nil
	})
	return size
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
