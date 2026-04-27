// Package handler — log_level_handler 提供运行时调整 backend / ai-service
// 日志级别的管理 API。
//
// 设计要点：
//   - 后端通过 zerolog.SetGlobalLevel 在线生效，无需重启进程。
//   - ai-service 通过 X-Internal-Service token 转发到 PUT /api/v1/admin/log-level，
//     由 Python 侧改 root logger 级别。
//   - 调整不持久化：进程重启后回到 LogConfig.Level（环境变量 / config.yaml）。
//     生产环境长期变更应该改 AETHERBLOG_LOG_LEVEL 后重启，避免运维和实际状态漂移。
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// LogLevelHandler 提供 /v1/admin/system/log-level 端点。
type LogLevelHandler struct {
	cfg      *config.Config
	aiClient *service.AIClient
}

// NewLogLevelHandler 创建一个 LogLevelHandler。
func NewLogLevelHandler(cfg *config.Config, aiClient *service.AIClient) *LogLevelHandler {
	return &LogLevelHandler{cfg: cfg, aiClient: aiClient}
}

// MountAdmin 注册到 /v1/admin/system 路由组。
func (h *LogLevelHandler) MountAdmin(g *echo.Group) {
	g.GET("/log-level", h.Get)
	g.PUT("/log-level", h.Update)
}

// LogLevelStatus 是 GET 响应体。
type LogLevelStatus struct {
	Backend   string `json:"backend"`
	AIService string `json:"aiService,omitempty"`
	// AIServiceError 在 ai-service 拉取失败时返回错误描述，
	// 不是 5xx —— backend 自己的级别仍然有效。
	AIServiceError string `json:"aiServiceError,omitempty"`
}

// LogLevelUpdateRequest 是 PUT 请求体。两个字段都是可选的，
// 缺失字段对应服务保持原级别不变。
type LogLevelUpdateRequest struct {
	Backend   *string `json:"backend,omitempty"`
	AIService *string `json:"aiService,omitempty"`
}

// Get 处理 GET /v1/admin/system/log-level。
// 返回 backend 当前级别 + 远程拉取 ai-service 当前级别。
func (h *LogLevelHandler) Get(c echo.Context) error {
	status := LogLevelStatus{
		Backend: zerolog.GlobalLevel().String(),
	}

	if level, err := h.fetchAIServiceLevel(c.Request().Context()); err != nil {
		status.AIServiceError = err.Error()
	} else {
		status.AIService = level
	}

	return response.OK(c, status)
}

// Update 处理 PUT /v1/admin/system/log-level。
// Body: {"backend":"info","aiService":"info"} —— 任一缺省则保留。
func (h *LogLevelHandler) Update(c echo.Context) error {
	var req LogLevelUpdateRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "invalid JSON body")
	}

	status := LogLevelStatus{
		Backend: zerolog.GlobalLevel().String(),
	}

	if req.Backend != nil {
		lvl, perr := zerolog.ParseLevel(strings.ToLower(*req.Backend))
		if perr != nil || lvl == zerolog.NoLevel {
			return response.FailWith(c, response.BadRequest, "invalid backend level: "+*req.Backend)
		}
		zerolog.SetGlobalLevel(lvl)
		status.Backend = lvl.String()
		// 用 lvl 自身记录变更事件,避免运维一次性切到 Warn/Error 后这条
		// 审计行被新级别屏蔽 —— 想知道"是不是真的切过去了"反而看不到。
		log.WithLevel(lvl).
			Str("level", lvl.String()).
			Str("by", "admin-api").
			Msg("log level changed at runtime")
	}

	if req.AIService != nil {
		lvl := strings.ToLower(strings.TrimSpace(*req.AIService))
		if !isValidPyLevel(lvl) {
			return response.FailWith(c, response.BadRequest, "invalid aiService level: "+*req.AIService)
		}
		if err := h.pushAIServiceLevel(c.Request().Context(), lvl); err != nil {
			status.AIServiceError = err.Error()
		} else {
			status.AIService = lvl
		}
	} else {
		// 即便没改 ai-service，也回填一次当前值，保持响应一致
		if level, err := h.fetchAIServiceLevel(c.Request().Context()); err == nil {
			status.AIService = level
		} else {
			status.AIServiceError = err.Error()
		}
	}

	return response.OK(c, status)
}

// fetchAIServiceLevel 通过内部 token 拉取 ai-service 当前根 logger 级别。
func (h *LogLevelHandler) fetchAIServiceLevel(ctx context.Context) (string, error) {
	if h.aiClient == nil {
		return "", &remoteErr{msg: "ai client not initialized"}
	}
	rctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	body, status, err := h.aiClient.DoSync(rctx, http.MethodGet, "/api/v1/admin/log-level", nil, map[string]string{
		"X-Internal-Service": h.cfg.AI.InternalServiceToken,
	})
	if err != nil {
		return "", err
	}
	defer body.Close()

	if status >= 400 {
		return "", &remoteErr{msg: "ai-service responded " + http.StatusText(status)}
	}

	raw, err := io.ReadAll(body)
	if err != nil {
		return "", err
	}

	var payload struct {
		Code int `json:"code"`
		Data struct {
			Level string `json:"level"`
		} `json:"data"`
		Message string `json:"message,omitempty"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return "", err
	}
	return payload.Data.Level, nil
}

// pushAIServiceLevel 把目标级别写到 ai-service 的运行时设置上。
func (h *LogLevelHandler) pushAIServiceLevel(ctx context.Context, level string) error {
	if h.aiClient == nil {
		return &remoteErr{msg: "ai client not initialized"}
	}
	payload, _ := json.Marshal(map[string]string{"level": level})

	rctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	body, status, err := h.aiClient.DoSync(rctx, http.MethodPut, "/api/v1/admin/log-level", bytes.NewReader(payload), map[string]string{
		"X-Internal-Service": h.cfg.AI.InternalServiceToken,
	})
	if err != nil {
		return err
	}
	defer body.Close()
	if status >= 400 {
		raw, readErr := io.ReadAll(body)
		if readErr != nil {
			return &remoteErr{msg: "ai-service rejected (status " + http.StatusText(status) + "); reading body failed: " + readErr.Error()}
		}
		return &remoteErr{msg: "ai-service rejected: " + string(raw)}
	}
	return nil
}

// isValidPyLevel 兼容 Python logging 的级别名称。
func isValidPyLevel(s string) bool {
	switch strings.ToLower(s) {
	case "debug", "info", "warning", "warn", "error", "critical":
		return true
	}
	return false
}

type remoteErr struct{ msg string }

func (e *remoteErr) Error() string { return e.msg }
