package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/ctxutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// providerProxyBodyLimit 限制 /providers/* 写操作请求体上限。
// 这些端点的负载是 provider/model/credential/路由 配置 JSON,正常 < 10KB;
// 5MB 给图片/批量 import 类未来扩展留余量,同时阻止 admin token 被滥用做
// OOM-DoS (审计 §4.1.1)。AI 生成端点 (summary/tags/...) 不在此限制内,
// 它们的 body 由 ai-service 侧 _enforce_content_limit 控制。
const providerProxyBodyLimit = "5M"

// aiResponse 是 FastAPI AI 服务返回的标准响应信封结构。
type aiResponse struct {
	Success   bool            `json:"success"`
	Data      json.RawMessage `json:"data"`
	RequestID string          `json:"requestId,omitempty"`
	Message   string          `json:"message,omitempty"`
}

// activityRecorder 是 *service.ActivityService 的 Create 子集接口。
// 用接口而非具体类型让 handler 在单测里能注入 fake recorder; 生产链路
// *service.ActivityService 隐式满足该接口,无需适配器。
type activityRecorder interface {
	Create(ctx context.Context, e *model.ActivityEvent) error
}

// AiHandler 负责将 AI 请求代理转发至外部 FastAPI 服务。
type AiHandler struct {
	client      *service.AIClient
	activitySvc activityRecorder
}

// NewAiHandler 根据配置创建一个新的 AiHandler，内部使用配置好的 HTTP 客户端。
// 传入 activitySvc 后,/providers/* 写操作会写入 activity_events 表用于事后审计;
// nil 时跳过审计但不阻塞主流程,兼容旧调用方与无审计开关的场景。
func NewAiHandler(cfg *config.Config, activitySvc activityRecorder) *AiHandler {
	return &AiHandler{
		client:      service.NewAIClient(cfg.AI),
		activitySvc: activitySvc,
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
//
// 安全：在路由层应用 5MB body limit (审计 §4.1.1),防止 admin token 被滥用做
// OOM-DoS。Echo 的 BodyLimit 触发时返回 413，由 Echo 错误处理器统一映射。
func (h *AiHandler) MountProviders(g *echo.Group) {
	bodyLimit := echomw.BodyLimit(providerProxyBodyLimit)
	// 通配符捕获：任意方法、/providers 下的任意子路径
	g.Any("", h.ProxyProviders, bodyLimit)
	g.Any("/*", h.ProxyProviders, bodyLimit)
}

// ProxyProviders 将 AI 提供商管理请求转发至 FastAPI AI 服务。
//
// 安全 / 透明代理要点（汇总 Gemini code-review 5 条反馈）：
//  1. 必须使用 *已编码* 的子路径。`c.Param("*")` 返回的是 Echo 已 URL-decode
//     后的值，若直接拼回 targetPath，`?` `#` `;` 会被下游误解析为查询串 /
//     片段 / matrix 分隔符（参数注入 / SSRF 绕过），`%2F` 会被还原成真正
//     的 `/`、空格等字符让下游 URL 非法。改用 `c.Request().URL.EscapedPath()`
//     去掉前缀，原始编码完整透传给 FastAPI。
//  2. 多级解码循环只用于探测 `..` 路径穿越。循环不应把"解码失败"升级为
//     400 —— 合法的 `%` 字面量（如 `100%25`）不可一竿子打死。decode 失败
//     直接 break，用当前最新解码结果做 `..` 匹配。
//  3. 前缀从 `c.Path()` 动态提取而非硬编码。Echo 在通配符路由下返回的
//     `c.Path()` 形如 `/api/v1/admin/providers/*`，去尾部 `/*` 即得到稳定前缀；
//     未来若把 `/providers` 改成 `/providers-v2` 无需同步修改处理器。
//  4. 保留 subPath 的前导斜杠并直接拼接，让尾斜杠等原始 URL 结构
//     （如 `/providers/` vs `/providers`）完整透传给下游路由器。
func (h *AiHandler) ProxyProviders(c echo.Context) error {
	// 动态提取代理前缀：c.Path() = "/api/v1/admin/providers/*" → 去掉 "*" 再去掉尾 "/"
	proxyPrefix := strings.TrimSuffix(strings.TrimSuffix(c.Path(), "*"), "/")

	// 使用 EscapedPath() 保留客户端原始编码，避免 Echo 自动解码带来的注入/绕过
	escapedFull := c.Request().URL.EscapedPath()
	// subPath 保留前导斜杠；`/providers` → "" / `/providers/` → "/" / `/providers/foo/` → "/foo/"
	encodedSubPath := strings.TrimPrefix(escapedFull, proxyPrefix)

	// 多级解码，尽力发现隐藏的 `..`；遇到非法百分号编码时 break 而非 400
	probe := encodedSubPath
	for {
		decoded, err := url.PathUnescape(probe)
		if err != nil {
			break
		}
		if decoded == probe {
			break
		}
		probe = decoded
	}
	if strings.Contains(probe, "..") {
		return response.FailWith(c, response.BadRequest, "invalid path traversal")
	}

	// 透明转发：直接拼接已编码 subPath（含前导斜杠 / 尾斜杠），不走 path.Clean
	targetPath := proxyPrefix + encodedSubPath

	method := c.Request().Method

	// 分发到具体代理；err 与最终响应状态都用于事后审计。
	var err error
	switch method {
	case http.MethodGet:
		err = h.proxyGet(c, targetPath)
	case http.MethodDelete:
		// DELETE 请求可能携带或不携带请求体；转发查询参数
		queryString := c.QueryString()
		fullPath := targetPath
		if queryString != "" {
			fullPath = targetPath + "?" + queryString
		}
		err = h.proxySyncRequest(c, http.MethodDelete, fullPath)
	default:
		// POST、PUT、PATCH — 携带请求体转发
		err = h.proxySyncRequest(c, method, targetPath)
	}

	// 审计 §4.1.1：写操作必须可追溯。GET 是只读查询，不产生审计记录。
	// 写操作(包括失败)都登记，借助 activity_events 把"谁改了什么"沉淀到 DB。
	if method != http.MethodGet {
		h.recordProviderProxyActivity(c, method, encodedSubPath)
	}
	return err
}

// statusFromHTTP 把 HTTP 响应状态码映射到 activity_events.status 枚举
// (INFO/SUCCESS/WARNING/ERROR)。注意必须严格遵守 chk_activity_event_status，
// 早期版本曾使用 "FAILED" 直接被 CHECK 拒绝、审计静默丢失；这里把 4xx 归为
// WARNING(客户端错误，多为参数 / 鉴权问题)，5xx 归为 ERROR (上游 / 系统错误)，
// 让 admin 在前端筛选「警告 / 错误」时能区分严重程度。
func statusFromHTTP(httpStatus int) string {
	switch {
	case httpStatus >= 500:
		return "ERROR"
	case httpStatus >= 400:
		return "WARNING"
	default:
		return "SUCCESS"
	}
}

// recordAIEvent 是所有 AI 子模块写审计的统一入口。任意 nil 字段安全省略。
// 成功插入失败仅 log.Warn 不阻塞主响应路径，让审计写入永远不会成为 LLM 路径
// 的故障源。所有 AI 类事件在此处统一打 EventCategory="ai"。
func (h *AiHandler) recordAIEvent(ctx context.Context, c echo.Context, eventType, title, description string, httpStatus int) {
	if h.activitySvc == nil {
		return
	}
	var userID *int64
	if lu := middleware.GetLoginUser(c); lu != nil {
		userID = &lu.UserID
	}
	ip := c.RealIP()
	evtCat := "ai"
	statusText := statusFromHTTP(httpStatus)
	var descPtr *string
	if description != "" {
		descPtr = &description
	}
	evt := &model.ActivityEvent{
		EventType:     eventType,
		EventCategory: &evtCat,
		Title:         title,
		Description:   descPtr,
		UserID:        userID,
		IP:            &ip,
		Status:        &statusText,
	}
	if err := h.activitySvc.Create(ctx, evt); err != nil {
		log.Warn().Err(err).Str("eventType", eventType).Msg("record AI activity failed")
	}
}

// recordProviderProxyActivity 把一次 /providers/* 写操作写入 activity_events，
// 失败仅 log.Warn 不阻塞主代理流程。Description 同时记下子路径与 HTTP
// 状态码，方便事后定位"管理员 X 在 T 时间向 /providers/credentials/Y 发了 PUT
// 失败 HTTP 401"这种细节。
//
// 注意:必须用 readUpstreamStatus 而非 c.Response().Status —— ai_handler 的所有
// proxy 方法都把错误包装成 R{} 信封 (HTTP 200),直接读 response status 会把上游
// 5xx 失败误记成 SUCCESS (codex review P1)。
func (h *AiHandler) recordProviderProxyActivity(c echo.Context, method, subPath string) {
	respStatus := readUpstreamStatus(c)
	desc := fmt.Sprintf("%s /providers%s → 上游 HTTP %d", method, subPath, respStatus)
	title := fmt.Sprintf("AI 提供商代理 %s %s", method, subPath)
	h.recordAIEvent(c.Request().Context(), c, "ai.provider_proxy_write", title, desc, respStatus)
}

// --- 同步 AI 生成接口 ---

// generationTaskLabels 把内部 task code 映射成给运维 / 管理员看的中文标题，
// 让 activity_events 列表里的「AI 生成 - 摘要 / 标签 / ...」一眼就能识别出
// 是哪个面板触发的调用。Source of truth：与前端 ActivitiesPage eventTypeOptions.ai
// 对齐 (`ai.generation.<task>`)。
var generationTaskLabels = map[string]string{
	"summary":   "摘要",
	"tags":      "标签",
	"titles":    "标题建议",
	"polish":    "文章润色",
	"outline":   "大纲",
	"translate": "翻译",
}

// runGeneration 是六个同步 AI 生成端点的共用骨架：
//   - 先把客户端请求体大小记下来 (Content-Length)，用作 Description 一行流水；
//   - 走 proxySyncPost 转发给 ai-service；
//   - 不论成功或失败都写一条 ai.generation.<task> 审计，让管理员能在
//     Activities 页面按「AI」分类筛选出每次 LLM 调用。
//
// 关键 (codex review P1):必须用 readUpstreamStatus 拿上游真实状态;客户端响应一律
// 是 R{} 信封包装的 HTTP 200,直接读 c.Response().Status 会把所有失败都记成 SUCCESS。
//
// 不打 metadata JSONB —— 当前 ActivityRepo / 前端没有展示 metadata，多写了
// 也只是字节占用，等需要时再开。
func (h *AiHandler) runGeneration(c echo.Context, task, path string) error {
	contentLen := c.Request().ContentLength
	err := h.proxySyncPost(c, path)
	upstreamStatus := readUpstreamStatus(c)
	taskLabel := generationTaskLabels[task]
	if taskLabel == "" {
		taskLabel = task
	}
	desc := fmt.Sprintf("POST %s · 请求体 %d B · 上游 HTTP %d", path, contentLen, upstreamStatus)
	h.recordAIEvent(
		c.Request().Context(), c,
		"ai.generation."+task,
		"AI 生成 - "+taskLabel,
		desc,
		upstreamStatus,
	)
	return err
}

// Summary 处理 POST /ai/summary 请求，代理至 AI 服务生成文章摘要。
func (h *AiHandler) Summary(c echo.Context) error {
	return h.runGeneration(c, "summary", "/api/v1/ai/summary")
}

// Tags 处理 POST /ai/tags 请求，代理至 AI 服务生成文章标签。
func (h *AiHandler) Tags(c echo.Context) error {
	return h.runGeneration(c, "tags", "/api/v1/ai/tags")
}

// Titles 处理 POST /ai/titles 请求，代理至 AI 服务生成文章标题建议。
func (h *AiHandler) Titles(c echo.Context) error {
	return h.runGeneration(c, "titles", "/api/v1/ai/titles")
}

// Polish 处理 POST /ai/polish 请求，代理至 AI 服务进行文章润色。
func (h *AiHandler) Polish(c echo.Context) error {
	return h.runGeneration(c, "polish", "/api/v1/ai/polish")
}

// Outline 处理 POST /ai/outline 请求，代理至 AI 服务生成文章大纲。
func (h *AiHandler) Outline(c echo.Context) error {
	return h.runGeneration(c, "outline", "/api/v1/ai/outline")
}

// Translate 处理 POST /ai/translate 请求，代理至 AI 服务进行翻译。
func (h *AiHandler) Translate(c echo.Context) error {
	return h.runGeneration(c, "translate", "/api/v1/ai/translate")
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
		// 客户端 / 上游连接层错误：不知道 HTTP 状态码，按 503 落审计 (Status=ERROR)。
		h.recordAIEvent(c.Request().Context(), c, "ai.generation.summary_stream",
			"AI 生成 - 摘要(流式)", "POST /api/v1/ai/summary/stream · 上游连接失败", http.StatusServiceUnavailable)
		return h.handleClientError(c, err)
	}
	defer respBody.Close()

	if statusCode != http.StatusOK {
		h.recordAIEvent(c.Request().Context(), c, "ai.generation.summary_stream",
			"AI 生成 - 摘要(流式)", fmt.Sprintf("POST /api/v1/ai/summary/stream · 上游 HTTP %d", statusCode), statusCode)
		return h.handleUpstreamError(c, respBody, statusCode)
	}

	// 上游已 200，准备开流。这里就把成功事件写下；后续 SSE 行级转发若中途
	// 异常会留 log.Warn，不再补审计 —— 否则一次会话最多 2 条 ai 事件，列表噪声大。
	h.recordAIEvent(c.Request().Context(), c, "ai.generation.summary_stream",
		"AI 生成 - 摘要(流式)", "POST /api/v1/ai/summary/stream · 流式开始", http.StatusOK)

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
		if !validateSSELine(line) {
			continue
		}
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
		h.recordAIEvent(c.Request().Context(), c, "ai.generation.summary_stream",
			"AI 生成 - 摘要(流式 GET)", "GET /ai/summary/stream · 上游连接失败", http.StatusServiceUnavailable)
		return h.handleClientError(c, err)
	}
	defer respBody.Close()

	if statusCode != http.StatusOK {
		h.recordAIEvent(c.Request().Context(), c, "ai.generation.summary_stream",
			"AI 生成 - 摘要(流式 GET)", fmt.Sprintf("GET /ai/summary/stream · 上游 HTTP %d", statusCode), statusCode)
		return h.handleUpstreamError(c, respBody, statusCode)
	}

	h.recordAIEvent(c.Request().Context(), c, "ai.generation.summary_stream",
		"AI 生成 - 摘要(流式 GET)", "GET /ai/summary/stream · 流式开始", http.StatusOK)

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
		if !validateSSELine(line) {
			continue
		}
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
// 审计读 readUpstreamStatus,避免 R{} 信封 HTTP 200 把上游失败误记 SUCCESS。
func (h *AiHandler) UpdatePrompt(c echo.Context) error {
	taskType := c.Param("taskType")
	err := h.proxySyncRequest(c, http.MethodPut, "/api/v1/admin/ai/prompts/"+taskType)
	upstreamStatus := readUpstreamStatus(c)
	desc := fmt.Sprintf("PUT /ai/prompts/%s → 上游 HTTP %d", taskType, upstreamStatus)
	h.recordAIEvent(c.Request().Context(), c, "ai.prompt_update",
		"AI 提示词更新: "+taskType, desc, upstreamStatus)
	return err
}

// --- 任务 CRUD ---

// ListTasks 处理 GET /ai/tasks 请求，返回所有 AI 任务配置列表。
func (h *AiHandler) ListTasks(c echo.Context) error {
	return h.proxyGet(c, "/api/v1/admin/ai/tasks")
}

// CreateTask 处理 POST /ai/tasks 请求，创建新的 AI 任务配置。
// 审计读 readUpstreamStatus (R{} 信封下 c.Response().Status 恒为 200)。
func (h *AiHandler) CreateTask(c echo.Context) error {
	err := h.proxySyncPost(c, "/api/v1/admin/ai/tasks")
	upstreamStatus := readUpstreamStatus(c)
	h.recordAIEvent(c.Request().Context(), c, "ai.task_create",
		"AI 任务创建", fmt.Sprintf("POST /ai/tasks → 上游 HTTP %d", upstreamStatus), upstreamStatus)
	return err
}

// UpdateTask 处理 PUT /ai/tasks/:code 请求，更新指定 code 的 AI 任务配置。
func (h *AiHandler) UpdateTask(c echo.Context) error {
	code := c.Param("code")
	err := h.proxySyncRequest(c, http.MethodPut, "/api/v1/admin/ai/tasks/"+code)
	upstreamStatus := readUpstreamStatus(c)
	h.recordAIEvent(c.Request().Context(), c, "ai.task_update",
		"AI 任务更新: "+code,
		fmt.Sprintf("PUT /ai/tasks/%s → 上游 HTTP %d", code, upstreamStatus), upstreamStatus)
	return err
}

// DeleteTask 处理 DELETE /ai/tasks/:code 请求，删除指定 code 的 AI 任务配置。
func (h *AiHandler) DeleteTask(c echo.Context) error {
	code := c.Param("code")
	err := h.proxySyncRequest(c, http.MethodDelete, "/api/v1/admin/ai/tasks/"+code)
	upstreamStatus := readUpstreamStatus(c)
	h.recordAIEvent(c.Request().Context(), c, "ai.task_delete",
		"AI 任务删除: "+code,
		fmt.Sprintf("DELETE /ai/tasks/%s → 上游 HTTP %d", code, upstreamStatus), upstreamStatus)
	return err
}

// --- SSE 事件验证 ---

// allowedSSETypes 定义了允许转发的 SSE 事件类型白名单。
// `start` / `progress` 是 search profile reindex stream 端点专属，
// 其他通用 AI 流（summary/tags/...）不会发送，对它们而言相当于 no-op。
var allowedSSETypes = map[string]bool{
	"delta": true, "result": true, "done": true, "error": true,
	"start": true, "progress": true,
	// agent 多轮对话：think 段折叠展示，sources RAG 引用，与 search.qa 对齐。
	"think": true, "sources": true,
}

// sseEvent 用于解析 SSE data 行中的 JSON 负载以提取 type 字段。
type sseEvent struct {
	Type string `json:"type"`
}

// validateSSELine 检查一行 SSE 数据是否合法。
// 对于 "data: " 开头的行，解析 JSON 并验证 type 字段在白名单中。
// 空行（SSE 事件分隔符）和非 data 行（如 "event:" "id:" "retry:"）直接放行。
// 返回 true 表示该行应被转发，false 表示应被丢弃。
func validateSSELine(line string) bool {
	// 空行是 SSE 事件分隔符，必须放行
	if line == "" {
		return true
	}

	// 只验证 "data: " 开头的行；其它 SSE 字段（event/id/retry/注释）直接放行
	if !strings.HasPrefix(line, "data: ") && !strings.HasPrefix(line, "data:") {
		return true
	}

	// 提取 JSON 负载
	payload := line
	if strings.HasPrefix(line, "data: ") {
		payload = strings.TrimPrefix(line, "data: ")
	} else {
		payload = strings.TrimPrefix(line, "data:")
	}
	payload = strings.TrimSpace(payload)

	// 空 data 行放行（某些 SSE 实现用作心跳）
	if payload == "" {
		return true
	}

	var evt sseEvent
	if err := json.Unmarshal([]byte(payload), &evt); err != nil {
		// JSON 解析失败：丢弃此事件
		log.Warn().Str("line", line).Msg("SSE validation: malformed JSON, dropping event")
		return false
	}

	if !allowedSSETypes[evt.Type] {
		log.Warn().Str("type", evt.Type).Msg("SSE validation: unknown event type, dropping event")
		return false
	}

	return true
}

// --- 内部代理辅助函数 ---

// upstreamStatusKey 是 echo.Context 上「上游 ai-service 真实 HTTP 状态」的存键。
// 必须存在 context 上 (而非 AiHandler 字段),因为同一 *AiHandler 会被多个并发请求
// 共享 —— 写入 handler 字段会跨请求互相覆盖。
const upstreamStatusKey = "ai.upstreamStatus"

// stashUpstreamStatus 把上游 ai-service 返回的 HTTP 状态码记到 echo.Context,
// 让审计代码 (runGeneration / recordProviderProxyActivity / 各 prompt/task 端点)
// 能读到「真实失败」而不是被 response.Fail(...) 包装后恒为 200 的客户端响应状态。
//
// 背景:codex review 指出原实现用 c.Response().Status 推断成败 —— 但本系统的
// response.Fail / mapStatusToError 都用 R{code, message} 信封承载错误,HTTP 一律
// 200,导致 5xx/502 上游故障被审计成 SUCCESS。这里在 proxySyncRequest / proxyGet /
// SSE 流路径上调用 stashUpstreamStatus,保证 readUpstreamStatus 永远能拿到上游真值。
func stashUpstreamStatus(c echo.Context, status int) {
	c.Set(upstreamStatusKey, status)
}

// readUpstreamStatus 取出上游 HTTP 状态;未被 stash 过(理论上不会发生在已走代理
// 的端点上)时回退到 c.Response().Status,再不济回 500 —— 永不返回 0,避免被
// statusFromHTTP 误判为 SUCCESS。
func readUpstreamStatus(c echo.Context) int {
	if v, ok := c.Get(upstreamStatusKey).(int); ok && v > 0 {
		return v
	}
	if s := c.Response().Status; s > 0 {
		return s
	}
	return http.StatusInternalServerError
}

// upstreamStatusFromClientErr 从 AIClientError 取真实状态码,用于 DoSync/DoStream
// 在拨号 / 解码层就失败、根本拿不到上游 HTTP 状态时给审计一个有意义的回退值。
// 非 AIClientError 一律落 503 (服务不可用) —— 与「上游连接失败」语义对齐。
func upstreamStatusFromClientErr(err error) int {
	if clientErr, ok := err.(*service.AIClientError); ok && clientErr.StatusCode > 0 {
		return clientErr.StatusCode
	}
	return http.StatusServiceUnavailable
}

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
//
// 在返回前会把上游 ai-service 的真实 HTTP 状态码 stash 到 echo.Context;DoSync 自身
// 出错时(连接 / 超时)按 AIClientError.StatusCode 回退,默认 503。审计代码必须用
// readUpstreamStatus 读取,而不是 c.Response().Status —— 后者被 response.Fail 包装
// 后恒为 200,会把上游 5xx 误记成 SUCCESS。
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
		stashUpstreamStatus(c, upstreamStatusFromClientErr(err))
		return h.handleClientError(c, err)
	}
	defer respBody.Close()

	stashUpstreamStatus(c, statusCode)

	if statusCode == http.StatusNoContent {
		return response.OKEmpty(c)
	}

	return h.parseAndRespond(c, respBody, statusCode)
}

// proxyGet 将 GET 请求（含查询字符串）转发至 AI 服务。
// 上游真实状态 stash 规则同 proxySyncRequest。
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
		stashUpstreamStatus(c, upstreamStatusFromClientErr(err))
		return h.handleClientError(c, err)
	}
	defer respBody.Close()

	stashUpstreamStatus(c, statusCode)
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
// 注意：本地 HTTP 客户端层面的超时（DeadlineExceeded / net.Error.Timeout）
// 在 ai_client 中被包装为 StatusCode=504。这里必须映射成 GatewayTimeout 业务码，
// 而不是 TooManyRequests —— 后者会让前端误显示"请求过于频繁"，掩盖真实超时。
func (h *AiHandler) handleClientError(c echo.Context, err error) error {
	if clientErr, ok := err.(*service.AIClientError); ok {
		switch clientErr.StatusCode {
		case http.StatusGatewayTimeout:
			return response.FailCodeMsg(c, response.GatewayTimeout.Code, clientErr.Message)
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
	msg := strings.TrimSpace(message)
	switch {
	case statusCode == http.StatusTooManyRequests:
		return response.FailCodeMsg(c, response.TooManyRequests.Code, "AI 服务请求过于频繁，请稍后重试")
	case statusCode == http.StatusGatewayTimeout || statusCode == http.StatusRequestTimeout:
		if msg == "" {
			msg = "AI 服务请求超时"
		}
		return response.FailCodeMsg(c, response.GatewayTimeout.Code, msg)
	case statusCode == http.StatusBadGateway || statusCode == http.StatusServiceUnavailable:
		if msg == "" {
			msg = "AI 上游模型服务不可用"
		}
		return response.Fail(c, msg)
	case statusCode == http.StatusUnauthorized:
		return response.FailCode(c, response.Unauthorized)
	case statusCode == http.StatusNotFound:
		return response.FailCode(c, response.NotFound)
	case statusCode >= 500:
		if msg != "" && !strings.EqualFold(msg, "Internal server error") && msg != "AI 服务内部错误" {
			return response.Fail(c, msg)
		}
		return response.Fail(c, "AI 服务内部错误")
	default:
		return response.Fail(c, msg)
	}
}
