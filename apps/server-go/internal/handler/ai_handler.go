package handler

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/pkg/ctxutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// aiResponse 是 FastAPI AI 服务返回的标准响应信封结构。
type aiResponse struct {
	Success   bool            `json:"success"`
	Data      json.RawMessage `json:"data"`
	RequestID string          `json:"requestId,omitempty"`
	Message   string          `json:"message,omitempty"`
}

// AiHandler 负责将 AI 请求代理转发至外部 FastAPI 服务。
type AiHandler struct {
	client *service.AIClient
}

// NewAiHandler 根据配置创建一个新的 AiHandler，内部使用配置好的 HTTP 客户端。
func NewAiHandler(cfg *config.Config) *AiHandler {
	return &AiHandler{
		client: service.NewAIClient(cfg.AI),
	}
}

// Mount 在指定路由组（预期为 /ai）上注册所有 AI 代理路由。
func (h *AiHandler) Mount(g *echo.Group) {
	// 同步 AI 生成接口
	g.POST("/summary", h.Summary)
	g.POST("/summary/stream", h.SummaryStream)
	g.GET("/summary/stream", h.SummaryStreamGET)
	g.POST("/tags", h.Tags)
	g.POST("/titles", h.Titles)
	g.POST("/polish", h.Polish)
	g.POST("/outline", h.Outline)
	g.POST("/translate", h.Translate)

	// 健康检查
	g.GET("/health", h.Health)

	// 提示词 CRUD
	g.GET("/prompts", h.ListPrompts)
	g.GET("/prompts/:taskType", h.GetPrompt)
	g.PUT("/prompts/:taskType", h.UpdatePrompt)

	// 任务 CRUD
	g.GET("/tasks", h.ListTasks)
	g.POST("/tasks", h.CreateTask)
	g.PUT("/tasks/:code", h.UpdateTask)
	g.DELETE("/tasks/:code", h.DeleteTask)
}

// MountProviders 为 /providers/* 下的所有路由注册通配符代理。
// 这些请求将被转发至 FastAPI AI 服务，由其管理提供商、模型、凭证和路由。
func (h *AiHandler) MountProviders(g *echo.Group) {
	// 通配符捕获：任意方法、/providers 下的任意子路径
	g.Any("", h.ProxyProviders)
	g.Any("/*", h.ProxyProviders)
}

// ProxyProviders 将 AI 提供商管理请求转发至 FastAPI AI 服务。
func (h *AiHandler) ProxyProviders(c echo.Context) error {
	// 重建 FastAPI 目标路径：/api/v1/admin/providers + 子路径
	subPath := c.Param("*")

	// 循环进行 URL 解码，彻底防御多重编码的路径穿越攻击（如 %2e%2e、%252e%252e）
	unescapedPath := subPath
	for {
		decoded, err := url.PathUnescape(unescapedPath)
		if err != nil {
			return response.FailWith(c, response.BadRequest, "invalid path encoding")
		}
		if decoded == unescapedPath {
			break
		}
		unescapedPath = decoded
	}
	if strings.Contains(unescapedPath, "..") {
		return response.FailWith(c, response.BadRequest, "invalid path traversal")
	}

	// 使用原始编码路径构建目标 URL，避免解码后的特殊字符破坏 URL 结构
	targetPath := "/api/v1/admin/providers"
	if subPath != "" {
		targetPath += "/" + path.Clean(subPath)
	}

	method := c.Request().Method

	switch method {
	case http.MethodGet:
		return h.proxyGet(c, targetPath)
	case http.MethodDelete:
		// DELETE 请求可能携带或不携带请求体；转发查询参数
		queryString := c.QueryString()
		fullPath := targetPath
		if queryString != "" {
			fullPath = targetPath + "?" + queryString
		}
		return h.proxySyncRequest(c, http.MethodDelete, fullPath)
	default:
		// POST、PUT、PATCH — 携带请求体转发
		return h.proxySyncRequest(c, method, targetPath)
	}
}

// --- 同步 AI 生成接口 ---

// Summary 处理 POST /ai/summary 请求，代理至 AI 服务生成文章摘要。
func (h *AiHandler) Summary(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/ai/summary")
}

// Tags 处理 POST /ai/tags 请求，代理至 AI 服务生成文章标签。
func (h *AiHandler) Tags(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/ai/tags")
}

// Titles 处理 POST /ai/titles 请求，代理至 AI 服务生成文章标题建议。
func (h *AiHandler) Titles(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/ai/titles")
}

// Polish 处理 POST /ai/polish 请求，代理至 AI 服务进行文章润色。
func (h *AiHandler) Polish(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/ai/polish")
}

// Outline 处理 POST /ai/outline 请求，代理至 AI 服务生成文章大纲。
func (h *AiHandler) Outline(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/ai/outline")
}

// Translate 处理 POST /ai/translate 请求，代理至 AI 服务进行翻译。
func (h *AiHandler) Translate(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/ai/translate")
}

// --- SSE 流式接口 ---

// SummaryStream 处理 POST /ai/summary/stream 请求，
// 以 SSE（Server-Sent Events）方式流式返回摘要生成结果。
func (h *AiHandler) SummaryStream(c echo.Context) error {
	body := c.Request().Body
	defer body.Close()

	respBody, statusCode, err := h.client.DoStream(
		c.Request().Context(),
		http.MethodPost,
		"/api/v1/ai/summary/stream",
		body,
		proxyHeaders(c),
	)
	if err != nil {
		return h.handleClientError(c, err)
	}
	defer respBody.Close()

	if statusCode != http.StatusOK {
		return h.handleUpstreamError(c, respBody, statusCode)
	}

	// 设置 SSE 响应头
	w := c.Response()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.Writer.(http.Flusher)
	if !ok {
		return response.Fail(c, "streaming not supported")
	}

	scanner := bufio.NewScanner(respBody)
	// 扩大缓冲区以容纳较大的 SSE 数据行
	scanner.Buffer(make([]byte, 0, 64*1024), 256*1024)

	for scanner.Scan() {
		line := scanner.Text()
		fmt.Fprintf(w, "%s\n", line)
		flusher.Flush()
	}

	if err := scanner.Err(); err != nil {
		log.Warn().Err(err).Msg("SSE stream scanner error")
	}

	return nil
}

// SummaryStreamGET 处理 GET /ai/summary/stream 请求，支持 EventSource SSE 流式摘要。
// 前端使用 `new EventSource(url)` 发送 GET 请求并通过查询参数传递内容。
func (h *AiHandler) SummaryStreamGET(c echo.Context) error {
	content := c.QueryParam("content")
	maxLength := c.QueryParam("maxLength")
	style := c.QueryParam("style")

	// 将查询参数构建为 JSON 请求体
	payload := map[string]any{"content": content}
	if maxLength != "" {
		if v, err := strconv.Atoi(maxLength); err == nil {
			payload["maxLength"] = v
		}
	}
	if style != "" {
		payload["style"] = style
	}

	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return response.Fail(c, "failed to build request body")
	}

	respBody, statusCode, err := h.client.DoStream(
		c.Request().Context(),
		http.MethodPost,
		"/api/v1/ai/summary/stream",
		strings.NewReader(string(jsonBody)),
		proxyHeaders(c),
	)
	if err != nil {
		return h.handleClientError(c, err)
	}
	defer respBody.Close()

	if statusCode != http.StatusOK {
		return h.handleUpstreamError(c, respBody, statusCode)
	}

	// 设置 SSE 响应头
	w := c.Response()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.Writer.(http.Flusher)
	if !ok {
		return response.Fail(c, "streaming not supported")
	}

	scanner := bufio.NewScanner(respBody)
	scanner.Buffer(make([]byte, 0, 64*1024), 256*1024)

	for scanner.Scan() {
		line := scanner.Text()
		fmt.Fprintf(w, "%s\n", line)
		flusher.Flush()
	}

	if err := scanner.Err(); err != nil {
		log.Warn().Err(err).Msg("SSE GET stream scanner error")
	}

	return nil
}

// --- 健康检查接口 ---

// Health 处理 GET /ai/health 请求，探测 AI 服务健康状态并透传结果。
func (h *AiHandler) Health(c echo.Context) error {
	body, statusCode, err := h.client.DoSync(c.Request().Context(), http.MethodGet, "/health", nil, proxyHeaders(c))
	if err != nil {
		return response.OK(c, map[string]string{"status": "DOWN"})
	}
	defer body.Close()
	if statusCode >= 400 {
		return response.OK(c, map[string]string{"status": "DOWN"})
	}
	// 透传原始健康检查响应（例如 {"status":"ok"}）
	data, _ := io.ReadAll(body)
	var raw any
	if json.Unmarshal(data, &raw) == nil {
		return response.OK(c, raw)
	}
	return response.OK(c, map[string]string{"status": "UP"})
}

// --- 提示词 CRUD ---

// ListPrompts 处理 GET /ai/prompts 请求，返回所有提示词配置列表。
func (h *AiHandler) ListPrompts(c echo.Context) error {
	return h.proxyGet(c, "/api/v1/admin/ai/prompts")
}

// GetPrompt 处理 GET /ai/prompts/:taskType 请求，返回指定任务类型的提示词。
func (h *AiHandler) GetPrompt(c echo.Context) error {
	taskType := c.Param("taskType")
	return h.proxyGet(c, "/api/v1/admin/ai/prompts/"+taskType)
}

// UpdatePrompt 处理 PUT /ai/prompts/:taskType 请求，更新指定任务类型的提示词。
func (h *AiHandler) UpdatePrompt(c echo.Context) error {
	taskType := c.Param("taskType")
	return h.proxySyncRequest(c, http.MethodPut, "/api/v1/admin/ai/prompts/"+taskType)
}

// --- 任务 CRUD ---

// ListTasks 处理 GET /ai/tasks 请求，返回所有 AI 任务配置列表。
func (h *AiHandler) ListTasks(c echo.Context) error {
	return h.proxyGet(c, "/api/v1/admin/ai/tasks")
}

// CreateTask 处理 POST /ai/tasks 请求，创建新的 AI 任务配置。
func (h *AiHandler) CreateTask(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/admin/ai/tasks")
}

// UpdateTask 处理 PUT /ai/tasks/:code 请求，更新指定 code 的 AI 任务配置。
func (h *AiHandler) UpdateTask(c echo.Context) error {
	code := c.Param("code")
	return h.proxySyncRequest(c, http.MethodPut, "/api/v1/admin/ai/tasks/"+code)
}

// DeleteTask 处理 DELETE /ai/tasks/:code 请求，删除指定 code 的 AI 任务配置。
func (h *AiHandler) DeleteTask(c echo.Context) error {
	code := c.Param("code")
	return h.proxySyncRequest(c, http.MethodDelete, "/api/v1/admin/ai/tasks/"+code)
}

// --- 内部代理辅助函数 ---

// proxyHeaders 构建转发至 AI 服务的请求头映射。
// 优先从 Authorization 头提取 JWT，若不存在则尝试读取 ab_access_token HttpOnly Cookie，
// 确保 FastAPI 服务始终能收到有效的 Authorization 头。
func proxyHeaders(c echo.Context) map[string]string {
	auth := c.Request().Header.Get("Authorization")
	// 若无 Authorization 头，则尝试从 HttpOnly Cookie 获取（与 JWT 中间件逻辑相同）
	if auth == "" {
		if cookie, err := c.Cookie("ab_access_token"); err == nil && cookie.Value != "" {
			auth = "Bearer " + cookie.Value
		}
	}
	return map[string]string{
		"Authorization": auth,
		"X-Request-ID":  ctxutil.TraceID(c),
	}
}

// proxySyncPost 将 POST 请求体转发至 AI 服务，并将响应包装成统一格式返回。
func (h *AiHandler) proxySyncPost(c echo.Context, path string) error {
	return h.proxySyncRequest(c, http.MethodPost, path)
}

// proxySyncRequest 将带请求体的请求转发至 AI 服务。
func (h *AiHandler) proxySyncRequest(c echo.Context, method, path string) error {
	var body io.Reader
	if method != http.MethodGet && method != http.MethodDelete {
		body = c.Request().Body
		defer c.Request().Body.Close()
	}

	respBody, statusCode, err := h.client.DoSync(
		c.Request().Context(),
		method,
		path,
		body,
		proxyHeaders(c),
	)
	if err != nil {
		return h.handleClientError(c, err)
	}
	defer respBody.Close()

	if statusCode == http.StatusNoContent {
		return response.OKEmpty(c)
	}

	return h.parseAndRespond(c, respBody, statusCode)
}

// proxyGet 将 GET 请求（含查询字符串）转发至 AI 服务。
func (h *AiHandler) proxyGet(c echo.Context, path string) error {
	// 透传查询参数
	queryString := c.QueryString()
	fullPath := path
	if queryString != "" {
		fullPath = path + "?" + queryString
	}

	respBody, statusCode, err := h.client.DoSync(
		c.Request().Context(),
		http.MethodGet,
		fullPath,
		nil,
		proxyHeaders(c),
	)
	if err != nil {
		return h.handleClientError(c, err)
	}
	defer respBody.Close()

	return h.parseAndRespond(c, respBody, statusCode)
}

// parseAndRespond 读取 AI 服务的响应并将其包装为统一的 R{} 格式返回。
func (h *AiHandler) parseAndRespond(c echo.Context, body io.ReadCloser, statusCode int) error {
	data, err := io.ReadAll(body)
	if err != nil {
		log.Error().Err(err).Msg("failed to read AI service response")
		return response.Fail(c, "读取 AI 服务响应失败")
	}

	// 尝试解析为 AI 服务的标准信封格式
	var aiResp aiResponse
	if err := json.Unmarshal(data, &aiResp); err != nil {
		// 若无法解析，则根据状态码判断
		if statusCode >= 400 {
			return h.mapStatusToError(c, statusCode, string(data))
		}
		// 原样返回原始数据
		var raw any
		if json.Unmarshal(data, &raw) == nil {
			return response.OK(c, raw)
		}
		return response.OK(c, string(data))
	}

	// 若 AI 服务标记为失败
	if !aiResp.Success && statusCode >= 400 {
		msg := aiResp.Message
		if msg == "" {
			msg = "AI 服务请求失败"
		}
		return h.mapStatusToError(c, statusCode, msg)
	}

	// 从信封中提取 data 字段，包装为统一格式返回
	if aiResp.Data != nil {
		var parsed any
		if json.Unmarshal(aiResp.Data, &parsed) == nil {
			return response.OK(c, parsed)
		}
	}

	// 兜底处理：返回原始内容
	if !aiResp.Success {
		msg := aiResp.Message
		if msg == "" {
			msg = "AI 服务请求失败"
		}
		return response.Fail(c, msg)
	}

	return response.OKEmpty(c)
}

// handleClientError 将 AIClientError 转换为对应的响应格式。
func (h *AiHandler) handleClientError(c echo.Context, err error) error {
	if clientErr, ok := err.(*service.AIClientError); ok {
		switch clientErr.StatusCode {
		case http.StatusGatewayTimeout:
			return response.FailCodeMsg(c, response.TooManyRequests.Code, clientErr.Message)
		default:
			return response.Fail(c, clientErr.Message)
		}
	}
	log.Error().Err(err).Msg("AI client error")
	return response.Fail(c, "AI 服务不可用")
}

// handleUpstreamError 读取 AI 服务的错误响应体并返回对应的错误响应。
func (h *AiHandler) handleUpstreamError(c echo.Context, body io.ReadCloser, statusCode int) error {
	data, _ := io.ReadAll(body)
	msg := strings.TrimSpace(string(data))
	if msg == "" {
		msg = "AI 服务请求失败"
	}
	return h.mapStatusToError(c, statusCode, msg)
}

// mapStatusToError 将 HTTP 状态码映射为对应的业务错误响应。
func (h *AiHandler) mapStatusToError(c echo.Context, statusCode int, message string) error {
	switch {
	case statusCode == http.StatusTooManyRequests:
		return response.FailCodeMsg(c, response.TooManyRequests.Code, "AI 服务请求过于频繁，请稍后重试")
	case statusCode == http.StatusGatewayTimeout || statusCode == http.StatusRequestTimeout:
		return response.FailCodeMsg(c, response.InternalError.Code, "AI 服务请求超时")
	case statusCode == http.StatusUnauthorized:
		return response.FailCode(c, response.Unauthorized)
	case statusCode == http.StatusNotFound:
		return response.FailCode(c, response.NotFound)
	case statusCode >= 500:
		return response.Fail(c, "AI 服务内部错误")
	default:
		return response.Fail(c, message)
	}
}
