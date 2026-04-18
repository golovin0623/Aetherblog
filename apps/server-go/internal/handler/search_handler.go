package handler

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// SearchHandler 处理博客搜索相关的 HTTP 请求。
type SearchHandler struct {
	svc        *service.SearchService
	reindexing atomic.Bool // 防止并发重建索引
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
	// SECURITY (VULN-053): 查询字符串长度封顶。搜索接口下挂全文索引 + 向量
	// 检索 + 可能的 LLM 调用，成本与输入长度线性相关。
	if len(q) > 500 {
		return response.FailWith(c, response.BadRequest, "查询过长 (上限 500 字符)")
	}

	mode := c.QueryParam("mode")
	// SECURITY (VULN-046/050): strconv.Atoi 取代 fmt.Sscanf。Sscanf 对 "5abc"
	// 会静默解析出 5，同时允许负数；Atoi 明确失败。再钳位到 [1, 50]。
	limit := 10
	if l := c.QueryParam("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			if n > 50 {
				n = 50
			}
			limit = n
		}
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
	// SECURITY (VULN-053): 同 Search —— QA 会吃 token，长度必须封顶。
	if len(q) > 500 {
		return response.FailWith(c, response.BadRequest, "查询过长 (上限 500 字符)")
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

// Features 处理 GET /v1/public/search/features 请求，返回搜索功能开关状态（公开接口）。
func (h *SearchHandler) Features(c echo.Context) error {
	cfg := h.svc.GetSearchConfig(c.Request().Context())
	return response.OK(c, map[string]bool{
		"keywordEnabled":  cfg.KeywordEnabled,
		"semanticEnabled": cfg.SemanticEnabled,
		"aiQaEnabled":     cfg.AiQAEnabled,
	})
}

// GetConfig 处理 GET /v1/admin/search/config 请求，返回搜索配置。
func (h *SearchHandler) GetConfig(c echo.Context) error {
	cfg := h.svc.GetSearchConfig(c.Request().Context())
	return response.OK(c, cfg)
}

// Diagnostics 处理 GET /v1/admin/search/diagnostics 请求，返回搜索链路状态。
// 聚合 search config、active embedding 指针、AI client 可用性、实际 effective mode。
// 定位"搜索没结果"时不用再翻三处配置，直接看这一个响应。
func (h *SearchHandler) Diagnostics(c echo.Context) error {
	return response.OK(c, h.svc.GetDiagnostics(c.Request().Context()))
}

// UpdateConfig 处理 PATCH /v1/admin/search/config 请求，更新搜索配置。
func (h *SearchHandler) UpdateConfig(c echo.Context) error {
	// 直接使用 json.Decoder 解析，避免 Echo Bind 对 map 类型的兼容性问题
	var kv map[string]string
	if err := json.NewDecoder(c.Request().Body).Decode(&kv); err != nil {
		return response.FailWith(c, response.BadRequest, fmt.Sprintf("请求格式错误: %v", err))
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
		log.Error().Err(err).Msg("search config update failed")
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// ListPostsEmbedding 处理 GET /v1/admin/search/posts 请求，返回文章向量索引状态列表。
func (h *SearchHandler) ListPostsEmbedding(c echo.Context) error {
	statusFilter := c.QueryParam("embeddingStatus") // PENDING | INDEXED | FAILED | ""(全部)
	limit := 20
	offset := 0
	if l := c.QueryParam("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}
	if o := c.QueryParam("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}

	result, err := h.svc.ListPostsEmbedding(c.Request().Context(), statusFilter, limit, offset)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, result)
}

// IndexBatch 处理 POST /v1/admin/search/index-batch 请求，异步批量索引指定文章。
// 立即返回 "已启动" 响应，后台 goroutine 执行实际索引。前端通过轮询 stats/posts 接口感知进度。
//
// 设计要点：
//   - 同步先将目标文章置为 PENDING，保证前端进度条/计数能立即反映。
//   - goroutine 使用 context.Background() 与客户端请求解耦，避免 nginx/浏览器超时中断任务。
//   - 复用 reindexing 原子锁，防止与全量重建 / retry-failed 并发打架。
func (h *SearchHandler) IndexBatch(c echo.Context) error {
	var req dto.IndexBatchRequest
	if err := json.NewDecoder(c.Request().Body).Decode(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	if len(req.PostIDs) == 0 {
		return response.FailWith(c, response.BadRequest, "请提供至少一个文章 ID")
	}
	if len(req.PostIDs) > 100 {
		return response.FailWith(c, response.BadRequest, "单次最多索引 100 篇文章")
	}

	if !h.reindexing.CompareAndSwap(false, true) {
		return response.Fail(c, "索引任务正在进行中，请等待完成")
	}

	// 同步标记为 PENDING，让前端进度面板能立即看到 pending 计数
	if err := h.svc.MarkPostsEmbeddingPending(c.Request().Context(), req.PostIDs); err != nil {
		h.reindexing.Store(false)
		log.Error().Err(err).Msg("mark posts embedding pending failed")
		return response.Error(c, err)
	}

	postIDs := append([]int64(nil), req.PostIDs...)
	go func() {
		defer h.reindexing.Store(false)
		// 单批最多 100 篇，每篇 90s，预留 3 倍余量给重试/慢请求
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		result, err := h.svc.IndexBatchPosts(ctx, postIDs)
		if err != nil {
			log.Error().Err(err).Msg("async index-batch failed")
			return
		}
		log.Info().
			Int("total", result.Total).
			Int("indexed", result.Indexed).
			Int("failed", result.Failed).
			Msg("async index-batch completed")
	}()

	return response.OK(c, map[string]any{
		"status":   "started",
		"accepted": len(postIDs),
		"message":  "索引任务已在后台启动",
	})
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
		return handleSearchError(c, err)
	}
	defer body.Close()
	return searchProxyResponse(c, body, statusCode)
}

// Reindex 处理 POST /v1/admin/search/reindex 请求，异步代理到 AI service。
// 立即返回 "已启动" 响应，后台 goroutine 执行实际重建。前端通过轮询 stats 接口查看进度。
func (h *SearchHandler) Reindex(c echo.Context) error {
	if !h.reindexing.CompareAndSwap(false, true) {
		return response.Fail(c, "重建索引正在进行中，请等待完成")
	}

	reqBody, err := io.ReadAll(c.Request().Body)
	if err != nil {
		h.reindexing.Store(false)
		return response.FailWith(c, response.BadRequest, "读取请求失败")
	}
	headers := searchProxyHeaders(c)

	go func() {
		defer h.reindexing.Store(false)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		body, _, err := h.svc.ProxyReindex(ctx, bytes.NewReader(reqBody), headers)
		if err != nil {
			log.Error().Err(err).Msg("async reindex failed")
			return
		}
		defer body.Close()
		io.ReadAll(body)
		log.Info().Msg("async reindex completed")
	}()

	return response.OK(c, map[string]string{"status": "started", "message": "全量重建索引已在后台启动"})
}

// RetryFailed 处理 POST /v1/admin/search/retry-failed 请求，异步代理到 AI service。
func (h *SearchHandler) RetryFailed(c echo.Context) error {
	if !h.reindexing.CompareAndSwap(false, true) {
		return response.Fail(c, "索引任务正在进行中，请等待完成")
	}

	headers := searchProxyHeaders(c)

	go func() {
		defer h.reindexing.Store(false)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		body, _, err := h.svc.ProxyRetryFailed(ctx, headers)
		if err != nil {
			log.Error().Err(err).Msg("async retry-failed failed")
			return
		}
		defer body.Close()
		io.ReadAll(body)
		log.Info().Msg("async retry-failed completed")
	}()

	return response.OK(c, map[string]string{"status": "started", "message": "重试失败任务已在后台启动"})
}

// EmbeddingStatus 处理 GET /v1/admin/search/embedding-status 请求。
func (h *SearchHandler) EmbeddingStatus(c echo.Context) error {
	body, statusCode, err := h.svc.ProxyEmbeddingStatus(c.Request().Context(), searchProxyHeaders(c))
	if err != nil {
		return handleSearchError(c, err)
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

// handleSearchError 将搜索相关错误转换为用户友好的响应。
// AIClientError 携带已安全的消息（"AI 服务不可用"/"AI 服务请求超时"），可直接暴露。
func handleSearchError(c echo.Context, err error) error {
	if errors.Is(err, service.ErrAIClientNil) {
		return response.Fail(c, "AI 服务未配置，请检查服务端 AI 配置")
	}
	if clientErr, ok := err.(*service.AIClientError); ok {
		return response.Fail(c, clientErr.Message)
	}
	return response.Error(c, err)
}
