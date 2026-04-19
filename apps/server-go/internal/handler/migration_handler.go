package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// MigrationHandler 是 VanBlog 数据迁移的 HTTP 边界层，职责单一：
// 1. multipart 解析 + options JSON 解析
// 2. 调用 MigrationService.Analyze 返回 AnalysisReport
// 3. 调用 MigrationService.Execute + NDJSON SSE 实时推送进度
type MigrationHandler struct {
	svc *service.MigrationService
}

// NewMigrationHandler 由 MigrationService 构造 handler。
func NewMigrationHandler(svc *service.MigrationService) *MigrationHandler {
	return &MigrationHandler{svc: svc}
}

// maxVanBlogUploadBytes 是单次上传的硬上限：500MB。
// 上游网关 `client_max_body_size: 10GB`，所以这里是应用层的二次保护。
// 4.5MB 真实备份远未触及，留 >100× 余量给带 base64 图片或超大历史归档的场景。
const maxVanBlogUploadBytes = 500 * 1024 * 1024

// Mount 在给定的管理员子路由上注册 3 个迁移端点。
func (h *MigrationHandler) Mount(g *echo.Group) {
	g.POST("/vanblog/analyze", h.Analyze)
	g.POST("/vanblog/import/stream", h.ImportStream)
	// 兼容保留：原 /vanblog/import?mode=dry-run|execute 的旧客户端。
	g.POST("/vanblog/import", h.LegacyImport)
}

// Analyze 处理 POST /v1/admin/migrations/vanblog/analyze。
// 返回 AnalysisReport，用于前端预览页（向导 Step 3）。
func (h *MigrationHandler) Analyze(c echo.Context) error {
	if _, err := requireAdmin(c); err != nil {
		return err
	}
	backup, opts, err := parseVanBlogUpload(c)
	if err != nil {
		return err
	}
	rep, err := h.svc.Analyze(c.Request().Context(), backup, *opts)
	if err != nil {
		return response.FailWith(c, response.InternalError, err.Error())
	}
	return response.OK(c, rep)
}

// ImportStream 处理 POST /v1/admin/migrations/vanblog/import/stream。
// 以 NDJSON over HTTP 的形式流式推送 ProgressEvent 序列；和 EventSource 协议兼容
// （每行前缀 `data: `，末尾 `\n\n`），前端用 fetch + ReadableStream 消费。
func (h *MigrationHandler) ImportStream(c echo.Context) error {
	callerID, err := requireAdmin(c)
	if err != nil {
		return err
	}
	backup, opts, err := parseVanBlogUpload(c)
	if err != nil {
		return err
	}

	res := c.Response()
	res.Header().Set(echo.HeaderContentType, "text/event-stream")
	res.Header().Set("Cache-Control", "no-cache")
	res.Header().Set("Connection", "keep-alive")
	// X-Accel-Buffering: no 让 nginx 不做缓冲，否则 SSE 会被聚合成整块推送。
	res.Header().Set("X-Accel-Buffering", "no")
	res.WriteHeader(http.StatusOK)

	flush := func() {
		if f, ok := res.Writer.(http.Flusher); ok {
			f.Flush()
		}
	}

	emit := func(ev service.ProgressEvent) {
		buf, err := json.Marshal(ev)
		if err != nil {
			// 理论上 Marshal 不会失败；若失败就吞掉，避免污染流。
			return
		}
		_, _ = fmt.Fprintf(res.Writer, "data: %s\n\n", buf)
		flush()
	}

	// 15s 心跳，防止代理误判连接空闲断开。
	ctx, cancel := context.WithCancel(c.Request().Context())
	defer cancel()
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				// SSE comment 行以冒号开头，不会被当成事件。
				_, _ = res.Writer.Write([]byte(": heartbeat\n\n"))
				flush()
			}
		}
	}()

	// 先发开场 event，让前端拿到连接确认。
	emit(service.ProgressEvent{Type: "phase", Phase: "start"})

	sum, err := h.svc.Execute(c.Request().Context(), backup, *opts, callerID, emit)
	if err != nil {
		emit(service.ProgressEvent{Type: "fatal", Error: err.Error()})
		return nil
	}
	h.svc.LogMigrationSummary(sum)
	return nil
}

// LegacyImport 兼容原 `/vanblog/import?mode=dry-run|execute` 路径。
// execute 模式不走 SSE，直接 Execute + 一次性返回 JSON summary（老 ImportVanBlogResult 形状的超集）。
func (h *MigrationHandler) LegacyImport(c echo.Context) error {
	callerID, err := requireAdmin(c)
	if err != nil {
		return err
	}
	backup, opts, err := parseVanBlogUpload(c)
	if err != nil {
		return err
	}
	mode := c.QueryParam("mode")
	if mode == "" {
		mode = "dry-run"
	}
	if mode == "dry-run" {
		rep, err := h.svc.Analyze(c.Request().Context(), backup, *opts)
		if err != nil {
			return response.FailWith(c, response.InternalError, err.Error())
		}
		return response.OK(c, rep)
	}
	// execute：非流式走法，整批跑完一次性返回。
	events := make([]service.ProgressEvent, 0)
	emit := func(ev service.ProgressEvent) { events = append(events, ev) }
	sum, err := h.svc.Execute(c.Request().Context(), backup, *opts, callerID, emit)
	if err != nil {
		return response.FailWith(c, response.InternalError, err.Error())
	}
	h.svc.LogMigrationSummary(sum)
	return response.OK(c, echo.Map{"summary": sum, "events": events})
}

// parseVanBlogUpload 从 multipart 表单解析：
//   - file 字段 → JSON 解码成 VanBlogBackup（刻意不使用 DisallowUnknownFields，
//     以兼容不同 VanBlog 版本导出）
//   - options 字段（可选）→ JSON 解码成 ImportOptions
//
// 上限 500MB 由 maxVanBlogUploadBytes 控制。
func parseVanBlogUpload(c echo.Context) (*service.VanBlogBackup, *service.ImportOptions, error) {
	fh, err := c.FormFile("file")
	if err != nil {
		return nil, nil, response.FailWith(c, response.BadRequest, "未找到文件，请上传 VanBlog 备份 JSON 文件")
	}
	if fh.Size > maxVanBlogUploadBytes {
		return nil, nil, response.FailWith(c, response.BadRequest,
			fmt.Sprintf("文件超过 %d MB 上限", maxVanBlogUploadBytes/1024/1024))
	}
	f, err := fh.Open()
	if err != nil {
		return nil, nil, response.FailWith(c, response.InternalError, "无法打开上传文件")
	}
	defer f.Close()

	// 用 LimitReader 加 1 字节，读完后若长度超出即判断为超限。
	data, err := io.ReadAll(io.LimitReader(f, maxVanBlogUploadBytes+1))
	if err != nil {
		return nil, nil, response.FailWith(c, response.InternalError, "读取文件失败")
	}
	if int64(len(data)) > maxVanBlogUploadBytes {
		return nil, nil, response.FailWith(c, response.BadRequest,
			fmt.Sprintf("文件超过 %d MB 上限", maxVanBlogUploadBytes/1024/1024))
	}

	var backup service.VanBlogBackup
	dec := json.NewDecoder(bytes.NewReader(data))
	// 故意不调用 dec.DisallowUnknownFields() —— VanBlog 不同版本会新增顶层/文章字段，
	// 严格模式会导致能正常使用的备份直接 400。未知字段让 decoder 安静丢弃，
	// 已知重要字段通过结构体显式接住。
	if err := dec.Decode(&backup); err != nil {
		return nil, nil, response.FailWith(c, response.BadRequest,
			"JSON 解析失败，请确认文件格式正确: "+err.Error())
	}

	opts := &service.ImportOptions{}
	if raw := c.FormValue("options"); raw != "" {
		if err := json.Unmarshal([]byte(raw), opts); err != nil {
			return nil, nil, response.FailWith(c, response.BadRequest,
				"options 字段 JSON 解析失败: "+err.Error())
		}
	}
	opts.ApplyDefaults()

	log.Info().
		Int("articles", len(backup.Articles)).
		Int("drafts", len(backup.Drafts)).
		Int("categories", len(backup.Categories)).
		Int("tags", len(backup.Tags)).
		Str("conflict_strategy", opts.ConflictStrategy).
		Bool("preserve_timestamps", *opts.PreserveTimestamps).
		Msg("VanBlog upload parsed")

	return &backup, opts, nil
}

// requireAdmin 统一认证检查 —— 所有 /vanblog/* 端点都需要登录用户，返回其 UserID。
func requireAdmin(c echo.Context) (int64, error) {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return 0, response.FailWith(c, response.Unauthorized, "未登录")
	}
	return lu.UserID, nil
}
