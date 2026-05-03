package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// SyncHandler 处理"本地→云"备份相关的管理端 HTTP 接口。
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
	g.GET("/auto-enabled", h.GetAutoEnabled)
	g.PUT("/auto-enabled", h.SetAutoEnabled)
}

// MountMediaRoutes 把 "POST /admin/media/:id/sync" 路由挂到 media 组下。
//
// 这是一条"per-media"路由,而不是 storage/sync 子组,所以单独 Mount。
func (h *SyncHandler) MountMediaRoutes(g *echo.Group) {
	g.POST("/:id/sync", h.SyncOne)
}

// startReq 是 POST /sync/start 的可选 body。
type startReq struct {
	TargetProviderID *int64 `json:"targetProviderId"`
}

// Start 立即把所有未与目标 provider 同步的非删除文件入队 + 启动 worker。
//
// targetProviderId 缺省时使用当前 default provider(必须是非 LOCAL)。
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
