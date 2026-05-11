package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// SyncHandler 处理媒体备份同步相关的管理端 HTTP 接口。
//
// 路由前缀: /v1/admin/storage/sync
// @ref 对象存储 rollout - Phase 4
type SyncHandler struct {
	svc *service.SyncService
}

// NewSyncHandler 构造 SyncHandler。
func NewSyncHandler(svc *service.SyncService) *SyncHandler {
	return &SyncHandler{svc: svc}
}

// Mount 把同步备份路由挂到 admin storage 组下。
func (h *SyncHandler) Mount(g *echo.Group) {
	g.POST("/start", h.Start)
	g.POST("/cancel", h.Cancel)
	g.GET("/status", h.Status)
	g.GET("/failed", h.Failed)
	g.POST("/retry", h.Retry)
	g.GET("/target-provider", h.GetTargetProvider)
	g.PUT("/target-provider", h.SetTargetProvider)
	g.GET("/auto-enabled", h.GetAutoEnabled)
	g.PUT("/auto-enabled", h.SetAutoEnabled)
	// Phase 5: 备份完整性校验
	g.POST("/verify", h.VerifyAll)
	g.GET("/verify-enabled", h.GetVerifyEnabled)
	g.PUT("/verify-enabled", h.SetVerifyEnabled)
}

// MountMediaRoutes 把 "POST /admin/media/:id/sync" / "DELETE /admin/media/:id/backup"
// / "POST /admin/media/:id/verify" 路由挂到 media 组下。
//
// 这些是"per-media"路由,而不是 storage/sync 子组,所以单独 Mount。
func (h *SyncHandler) MountMediaRoutes(g *echo.Group) {
	g.POST("/:id/sync", h.SyncOne)
	// Phase 5
	g.DELETE("/:id/backup", h.RemoveBackup)
	g.POST("/:id/verify", h.VerifyOne)
}

// startReq 是 POST /sync/start 的可选 body。
type startReq struct {
	TargetProviderID *int64 `json:"targetProviderId"`
}

// Start 立即把所有未与目标 provider 同步的非删除文件入队 + 启动 worker。
//
// targetProviderId 缺省时使用已配置的备份目标;未配置时兼容使用非 LOCAL default provider。
// 返回入队的 job 数量。
func (h *SyncHandler) Start(c echo.Context) error {
	var req startReq
	_ = c.Bind(&req) // body 可省略
	enqueued, err := h.svc.EnqueueAll(c.Request().Context(), req.TargetProviderID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, map[string]any{"enqueued": enqueued})
}

// Cancel 通知 worker 优雅停止 — 当前批次跑完后退出。
func (h *SyncHandler) Cancel(c echo.Context) error {
	h.svc.Stop()
	return response.OKEmpty(c)
}

// Status 返回 worker 实时摘要。
func (h *SyncHandler) Status(c echo.Context) error {
	st, err := h.svc.GetStatus(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, st)
}

// Failed 列出最近失败的同步 job (默认 50 条)。
func (h *SyncHandler) Failed(c echo.Context) error {
	limit := 50
	if v := c.QueryParam("limit"); v != "" {
		if n, _ := strconv.Atoi(v); n > 0 {
			limit = n
		}
	}
	jobs, err := h.svc.ListFailed(c.Request().Context(), limit)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, jobs)
}

// retryReq POST /sync/retry body
type retryReq struct {
	JobIDs []int64 `json:"jobIds"`
}

// Retry 把指定的 FAILED job 重新置为 PENDING 并启动 worker。
func (h *SyncHandler) Retry(c echo.Context) error {
	var req retryReq
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	if len(req.JobIDs) == 0 {
		return response.FailWith(c, response.BadRequest, "jobIds 为空")
	}
	if err := h.svc.RetryFailed(c.Request().Context(), req.JobIDs); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// syncOneReq 是 POST /admin/media/:id/sync 的可选 body。
type syncOneReq struct {
	TargetProviderID *int64 `json:"targetProviderId"`
}

// SyncOne 入队单个文件并启动 worker。
func (h *SyncHandler) SyncOne(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req syncOneReq
	_ = c.Bind(&req)
	if err := h.svc.EnqueueOne(c.Request().Context(), id, req.TargetProviderID); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OKEmpty(c)
}

// GetTargetProvider 返回当前显式配置的备份目标 provider。
func (h *SyncHandler) GetTargetProvider(c echo.Context) error {
	targetProviderID, err := h.svc.TargetProviderID(c.Request().Context())
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, map[string]any{"targetProviderId": targetProviderID})
}

// targetProviderReq 是 PUT /storage/sync/target-provider 的 body。
type targetProviderReq struct {
	TargetProviderID *int64 `json:"targetProviderId"`
}

// SetTargetProvider 修改备份同步目标 provider。
func (h *SyncHandler) SetTargetProvider(c echo.Context) error {
	var req targetProviderReq
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	if err := h.svc.SetTargetProviderID(c.Request().Context(), req.TargetProviderID); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, map[string]any{"targetProviderId": req.TargetProviderID})
}

// GetAutoEnabled 返回当前自动后台备份开关状态。
func (h *SyncHandler) GetAutoEnabled(c echo.Context) error {
	enabled := h.svc.AutoEnabled(c.Request().Context())
	return response.OK(c, map[string]any{"autoEnabled": enabled})
}

// autoEnabledReq PUT body
type autoEnabledReq struct {
	AutoEnabled bool `json:"autoEnabled"`
}

// SetAutoEnabled 修改自动后台备份开关 + 立即启停 worker。
func (h *SyncHandler) SetAutoEnabled(c echo.Context) error {
	var req autoEnabledReq
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	if err := h.svc.SetAutoEnabled(c.Request().Context(), req.AutoEnabled); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, map[string]any{"autoEnabled": req.AutoEnabled})
}

// ============================================================================
// Phase 5: 删除云端备份 + 定期校验
// ============================================================================

// RemoveBackup 处理 DELETE /admin/media/:id/backup 请求,删除云端备份对象但保留本地主文件。
func (h *SyncHandler) RemoveBackup(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.RemoveBackup(c.Request().Context(), id); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OKEmpty(c)
}

// VerifyOne 处理 POST /admin/media/:id/verify 请求,手动校验单条记录的云端备份是否存在。
func (h *SyncHandler) VerifyOne(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.VerifyOne(c.Request().Context(), id); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OKEmpty(c)
}

// VerifyAll 处理 POST /admin/storage/sync/verify 请求,扫描所有 due 的 SYNCED 记录并校验。
// 返回本次实际处理数量。
func (h *SyncHandler) VerifyAll(c echo.Context) error {
	limit := 200
	if v := c.QueryParam("limit"); v != "" {
		if n, _ := strconv.Atoi(v); n > 0 && n <= 1000 {
			limit = n
		}
	}
	checked, err := h.svc.VerifyOverdue(c.Request().Context(), limit)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, map[string]any{"checked": checked})
}

// GetVerifyEnabled 返回当前定期校验开关状态 + 间隔。
func (h *SyncHandler) GetVerifyEnabled(c echo.Context) error {
	ctx := c.Request().Context()
	return response.OK(c, map[string]any{
		"autoEnabled":     h.svc.VerifyAutoEnabled(ctx),
		"intervalSeconds": h.svc.VerifyIntervalSec(ctx),
		"running":         h.svc.IsVerifyRunning(),
	})
}

// verifyEnabledReq PUT body
type verifyEnabledReq struct {
	AutoEnabled bool `json:"autoEnabled"`
}

// SetVerifyEnabled 修改定期校验开关 + 立即启停 worker。
func (h *SyncHandler) SetVerifyEnabled(c echo.Context) error {
	var req verifyEnabledReq
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	if err := h.svc.SetVerifyAutoEnabled(c.Request().Context(), req.AutoEnabled); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, map[string]any{"autoEnabled": req.AutoEnabled})
}
