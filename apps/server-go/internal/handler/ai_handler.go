package handler

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// aiResponse is the envelope returned by the FastAPI AI service.
type aiResponse struct {
	Success   bool            `json:"success"`
	Data      json.RawMessage `json:"data"`
	RequestID string          `json:"requestId,omitempty"`
	Message   string          `json:"message,omitempty"`
}

// AiHandler proxies AI requests to the external FastAPI service.
type AiHandler struct {
	client *service.AIClient
}

// NewAiHandler creates a new AiHandler with an HTTP client configured from cfg.
func NewAiHandler(cfg *config.Config) *AiHandler {
	return &AiHandler{
		client: service.NewAIClient(cfg.AI),
	}
}

// Mount registers all AI proxy routes on the given group (expected: /ai).
func (h *AiHandler) Mount(g *echo.Group) {
	// Sync AI generation endpoints
	g.POST("/summary", h.Summary)
	g.POST("/summary/stream", h.SummaryStream)
	g.GET("/summary/stream", h.SummaryStreamGET)
	g.POST("/tags", h.Tags)
	g.POST("/titles", h.Titles)
	g.POST("/polish", h.Polish)
	g.POST("/outline", h.Outline)
	g.POST("/translate", h.Translate)

	// Health
	g.GET("/health", h.Health)

	// Prompts CRUD
	g.GET("/prompts", h.ListPrompts)
	g.GET("/prompts/:taskType", h.GetPrompt)
	g.PUT("/prompts/:taskType", h.UpdatePrompt)

	// Tasks CRUD
	g.GET("/tasks", h.ListTasks)
	g.POST("/tasks", h.CreateTask)
	g.PUT("/tasks/:code", h.UpdateTask)
	g.DELETE("/tasks/:code", h.DeleteTask)
}

// --- Sync AI generation endpoints ---

func (h *AiHandler) Summary(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/ai/summary")
}

func (h *AiHandler) Tags(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/ai/tags")
}

func (h *AiHandler) Titles(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/ai/titles")
}

func (h *AiHandler) Polish(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/ai/polish")
}

func (h *AiHandler) Outline(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/ai/outline")
}

func (h *AiHandler) Translate(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/ai/translate")
}

// --- SSE streaming endpoint ---

func (h *AiHandler) SummaryStream(c echo.Context) error {
	body := c.Request().Body
	defer body.Close()

	auth := c.Request().Header.Get("Authorization")

	respBody, statusCode, err := h.client.DoStream(
		c.Request().Context(),
		http.MethodPost,
		"/api/v1/ai/summary/stream",
		body,
		auth,
	)
	if err != nil {
		return h.handleClientError(c, err)
	}
	defer respBody.Close()

	if statusCode != http.StatusOK {
		return h.handleUpstreamError(c, respBody, statusCode)
	}

	// Set SSE headers
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
	// Increase buffer for potentially large SSE lines
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

// SummaryStreamGET handles GET requests for SSE streaming (EventSource).
// The frontend uses `new EventSource(url)` which sends GET with query params.
func (h *AiHandler) SummaryStreamGET(c echo.Context) error {
	content := c.QueryParam("content")
	maxLength := c.QueryParam("maxLength")
	style := c.QueryParam("style")

	// Build JSON body from query params
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

	auth := c.Request().Header.Get("Authorization")

	respBody, statusCode, err := h.client.DoStream(
		c.Request().Context(),
		http.MethodPost,
		"/api/v1/ai/summary/stream",
		strings.NewReader(string(jsonBody)),
		auth,
	)
	if err != nil {
		return h.handleClientError(c, err)
	}
	defer respBody.Close()

	if statusCode != http.StatusOK {
		return h.handleUpstreamError(c, respBody, statusCode)
	}

	// Set SSE headers
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

// --- Health endpoint ---

func (h *AiHandler) Health(c echo.Context) error {
	auth := c.Request().Header.Get("Authorization")
	body, statusCode, err := h.client.DoSync(c.Request().Context(), http.MethodGet, "/health", nil, auth)
	if err != nil {
		return response.OK(c, map[string]string{"status": "DOWN"})
	}
	defer body.Close()
	if statusCode >= 400 {
		return response.OK(c, map[string]string{"status": "DOWN"})
	}
	// Forward the raw health response (e.g. {"status":"ok"})
	data, _ := io.ReadAll(body)
	var raw any
	if json.Unmarshal(data, &raw) == nil {
		return response.OK(c, raw)
	}
	return response.OK(c, map[string]string{"status": "UP"})
}

// --- Prompts CRUD ---

func (h *AiHandler) ListPrompts(c echo.Context) error {
	return h.proxyGet(c, "/api/v1/admin/ai/prompts")
}

func (h *AiHandler) GetPrompt(c echo.Context) error {
	taskType := c.Param("taskType")
	return h.proxyGet(c, "/api/v1/admin/ai/prompts/"+taskType)
}

func (h *AiHandler) UpdatePrompt(c echo.Context) error {
	taskType := c.Param("taskType")
	return h.proxySyncRequest(c, http.MethodPut, "/api/v1/admin/ai/prompts/"+taskType)
}

// --- Tasks CRUD ---

func (h *AiHandler) ListTasks(c echo.Context) error {
	return h.proxyGet(c, "/api/v1/admin/ai/tasks")
}

func (h *AiHandler) CreateTask(c echo.Context) error {
	return h.proxySyncPost(c, "/api/v1/admin/ai/tasks")
}

func (h *AiHandler) UpdateTask(c echo.Context) error {
	code := c.Param("code")
	return h.proxySyncRequest(c, http.MethodPut, "/api/v1/admin/ai/tasks/"+code)
}

func (h *AiHandler) DeleteTask(c echo.Context) error {
	code := c.Param("code")
	return h.proxySyncRequest(c, http.MethodDelete, "/api/v1/admin/ai/tasks/"+code)
}

// --- Internal proxy helpers ---

// proxySyncPost forwards a POST request body to the AI service and wraps the response.
func (h *AiHandler) proxySyncPost(c echo.Context, path string) error {
	return h.proxySyncRequest(c, http.MethodPost, path)
}

// proxySyncRequest forwards a request with body to the AI service.
func (h *AiHandler) proxySyncRequest(c echo.Context, method, path string) error {
	var body io.Reader
	if method != http.MethodGet && method != http.MethodDelete {
		body = c.Request().Body
		defer c.Request().Body.Close()
	}

	auth := c.Request().Header.Get("Authorization")

	respBody, statusCode, err := h.client.DoSync(
		c.Request().Context(),
		method,
		path,
		body,
		auth,
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

// proxyGet forwards a GET request (with query string) to the AI service.
func (h *AiHandler) proxyGet(c echo.Context, path string) error {
	// Forward query parameters
	queryString := c.QueryString()
	fullPath := path
	if queryString != "" {
		fullPath = path + "?" + queryString
	}

	auth := c.Request().Header.Get("Authorization")

	respBody, statusCode, err := h.client.DoSync(
		c.Request().Context(),
		http.MethodGet,
		fullPath,
		nil,
		auth,
	)
	if err != nil {
		return h.handleClientError(c, err)
	}
	defer respBody.Close()

	return h.parseAndRespond(c, respBody, statusCode)
}

// parseAndRespond reads the AI service response and wraps it in the standard R{} format.
func (h *AiHandler) parseAndRespond(c echo.Context, body io.ReadCloser, statusCode int) error {
	data, err := io.ReadAll(body)
	if err != nil {
		log.Error().Err(err).Msg("failed to read AI service response")
		return response.Fail(c, "读取 AI 服务响应失败")
	}

	// Try to parse as the AI service envelope
	var aiResp aiResponse
	if err := json.Unmarshal(data, &aiResp); err != nil {
		// If we can't parse it, check status code
		if statusCode >= 400 {
			return h.mapStatusToError(c, statusCode, string(data))
		}
		// Return raw data as-is
		var raw any
		if json.Unmarshal(data, &raw) == nil {
			return response.OK(c, raw)
		}
		return response.OK(c, string(data))
	}

	// If the AI service indicates failure
	if !aiResp.Success && statusCode >= 400 {
		msg := aiResp.Message
		if msg == "" {
			msg = "AI 服务请求失败"
		}
		return h.mapStatusToError(c, statusCode, msg)
	}

	// Extract data from the AI service envelope and wrap in our R{}
	if aiResp.Data != nil {
		var parsed any
		if json.Unmarshal(aiResp.Data, &parsed) == nil {
			return response.OK(c, parsed)
		}
	}

	// Fallback: return whatever we got
	if !aiResp.Success {
		msg := aiResp.Message
		if msg == "" {
			msg = "AI 服务请求失败"
		}
		return response.Fail(c, msg)
	}

	return response.OKEmpty(c)
}

// handleClientError converts an AIClientError to the appropriate response.
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

// handleUpstreamError reads the error body from the AI service and returns an appropriate error response.
func (h *AiHandler) handleUpstreamError(c echo.Context, body io.ReadCloser, statusCode int) error {
	data, _ := io.ReadAll(body)
	msg := strings.TrimSpace(string(data))
	if msg == "" {
		msg = "AI 服务请求失败"
	}
	return h.mapStatusToError(c, statusCode, msg)
}

// mapStatusToError maps an HTTP status code to the appropriate response code.
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
