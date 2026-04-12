package handler

import (
	"bufio"
	"fmt"
	"io"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// SearchHandler 处理博客搜索相关的 HTTP 请求。
type SearchHandler struct {
	svc *service.SearchService
}

// NewSearchHandler 创建 SearchHandler 实例。
func NewSearchHandler(svc *service.SearchService) *SearchHandler {
	return &SearchHandler{svc: svc}
}

// Search 处理 GET /v1/public/search 请求，执行关键词/语义/混合搜索。
func (h *SearchHandler) Search(c echo.Context) error {
	q := c.QueryParam("q")
	if q == "" {
		return response.FailWith(c, response.BadRequest, "搜索关键词不能为空")
	}

	mode := c.QueryParam("mode")
	limit := 10
	if l := c.QueryParam("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}

	result, err := h.svc.Search(c.Request().Context(), q, mode, limit)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, result)
}

// QA 处理 GET /v1/public/search/qa 请求，代理到 AI service 的 QA SSE 流。
func (h *SearchHandler) QA(c echo.Context) error {
	q := c.QueryParam("q")
	if q == "" {
		return response.FailWith(c, response.BadRequest, "搜索关键词不能为空")
	}

	cfg := h.svc.GetSearchConfig(c.Request().Context())
	if !cfg.AiQAEnabled {
		return response.FailWith(c, response.BadRequest, "AI 问答功能未启用")
	}

	body, statusCode, err := h.svc.ProxyQA(c.Request().Context(), q)
	if err != nil {
		return response.Error(c, err)
	}
	defer body.Close()

	if statusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(body)
		return c.String(statusCode, string(respBytes))
	}

	// SSE 透传
	w := c.Response()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 256*1024)
	flusher, _ := w.Writer.(http.Flusher)
	for scanner.Scan() {
		fmt.Fprintf(w, "%s\n", scanner.Text())
		if flusher != nil {
			flusher.Flush()
		}
	}
	return nil
}

// GetConfig 处理 GET /v1/admin/search/config 请求，返回搜索配置。
func (h *SearchHandler) GetConfig(c echo.Context) error {
	cfg := h.svc.GetSearchConfig(c.Request().Context())
	return response.OK(c, cfg)
}

// UpdateConfig 处理 PATCH /v1/admin/search/config 请求，更新搜索配置。
func (h *SearchHandler) UpdateConfig(c echo.Context) error {
	var kv map[string]string
	if err := c.Bind(&kv); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	// 过滤：只允许 search.* 键
	filtered := make(map[string]string)
	for k, v := range kv {
		if len(k) > 7 && k[:7] == "search." {
			filtered[k] = v
		}
	}
	if len(filtered) == 0 {
		return response.FailWith(c, response.BadRequest, "无有效配置项")
	}
	if err := h.svc.UpdateSearchConfig(c.Request().Context(), filtered); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// searchProxyHeaders 从请求中提取认证头，供搜索管理端点代理使用。
func searchProxyHeaders(c echo.Context) map[string]string {
	auth := c.Request().Header.Get("Authorization")
	if auth == "" {
		if cookie, err := c.Cookie("ab_access_token"); err == nil {
			auth = "Bearer " + cookie.Value
		}
	}
	return map[string]string{
		"Authorization": auth,
	}
}

// GetStats 处理 GET /v1/admin/search/stats 请求，代理到 AI service。
func (h *SearchHandler) GetStats(c echo.Context) error {
	body, statusCode, err := h.svc.ProxySearchStats(c.Request().Context(), searchProxyHeaders(c))
	if err != nil {
		return response.Error(c, err)
	}
	defer body.Close()
	return searchProxyResponse(c, body, statusCode)
}

// Reindex 处理 POST /v1/admin/search/reindex 请求，代理到 AI service。
func (h *SearchHandler) Reindex(c echo.Context) error {
	body, statusCode, err := h.svc.ProxyReindex(c.Request().Context(), c.Request().Body, searchProxyHeaders(c))
	if err != nil {
		return response.Error(c, err)
	}
	defer body.Close()
	return searchProxyResponse(c, body, statusCode)
}

// RetryFailed 处理 POST /v1/admin/search/retry-failed 请求，代理到 AI service。
func (h *SearchHandler) RetryFailed(c echo.Context) error {
	body, statusCode, err := h.svc.ProxyRetryFailed(c.Request().Context(), searchProxyHeaders(c))
	if err != nil {
		return response.Error(c, err)
	}
	defer body.Close()
	return searchProxyResponse(c, body, statusCode)
}

// EmbeddingStatus 处理 GET /v1/admin/search/embedding-status 请求。
func (h *SearchHandler) EmbeddingStatus(c echo.Context) error {
	body, statusCode, err := h.svc.ProxyEmbeddingStatus(c.Request().Context(), searchProxyHeaders(c))
	if err != nil {
		return response.Error(c, err)
	}
	defer body.Close()
	return searchProxyResponse(c, body, statusCode)
}

// searchProxyResponse 将 AI service 的响应透传给客户端。
func searchProxyResponse(c echo.Context, body io.ReadCloser, statusCode int) error {
	respBytes, err := io.ReadAll(body)
	if err != nil {
		return response.Error(c, err)
	}
	return c.JSONBlob(statusCode, respBytes)
}
