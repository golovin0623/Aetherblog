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
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// SearchHandler 处理博客搜索相关的 HTTP 请求。
//
// 并发/取消模型：
//   - reindexing 作为"是否有任务在跑"的原子锁，保证同一时刻最多一个重建类任务
//   - activeMu 保护 activeCancel/activeKind：任务启动时写入，停止/完成时清零
//   - activeCancel 是任务 goroutine 所用 context 的 CancelFunc——Cancel 端点
//     调用它即可同时中止本地循环 + 已发出去的 ai-service HTTP 请求（HTTP 客户端
//     感知 ctx，会立刻关掉连接，让 ai-service 那边的 SELECT/embed 也尽早释放）
type SearchHandler struct {
	svc          *service.SearchService
	reindexing   atomic.Bool
	activeMu     sync.Mutex
	activeCancel context.CancelFunc
	activeKind   string // "full" | "retry" | "batch" —— 仅用于日志和 API 响应

	// lastBatch 缓存最近一次 batch / single 索引完成后的摘要（含失败原因 +
	// failedIds），让前端进度面板结束时不必翻 docker 日志就能展示
	// 「失败 N 篇 — 具体原因」。仅 in-memory，restart 后丢失（可接受）。
	lastBatchMu sync.RWMutex
	lastBatch   *dto.LastBatchSummary
}

// NewSearchHandler 创建 SearchHandler 实例。
func NewSearchHandler(svc *service.SearchService) *SearchHandler {
	return &SearchHandler{svc: svc}
}

// setActiveJob 由任务启动 goroutine 调用，把 cancel 绑定到 handler。
func (h *SearchHandler) setActiveJob(kind string, cancel context.CancelFunc) {
	h.activeMu.Lock()
	h.activeCancel = cancel
	h.activeKind = kind
	h.activeMu.Unlock()
}

// clearActiveJob 由任务 goroutine 在退出前调用，释放 cancel 引用。
func (h *SearchHandler) clearActiveJob() {
	h.activeMu.Lock()
	h.activeCancel = nil
	h.activeKind = ""
	h.activeMu.Unlock()
}

// cancelActiveJob 由 Cancel 端点调用，返回被取消的任务类型（空串表示无活跃任务）。
func (h *SearchHandler) cancelActiveJob() string {
	h.activeMu.Lock()
	cancel := h.activeCancel
	kind := h.activeKind
	h.activeMu.Unlock()
	if cancel != nil {
		cancel()
	}
	return kind
}

// recordLastBatch 在 batch 任务的 goroutine 退出前调用，把结果摘要存到内存。
// 前端进度面板结束时通过 GET /v1/admin/search/last-batch 拉取这条摘要，
// 配合 finishedAt > job.startTime 判定"是不是这次任务的结果"，把 reason /
// failedIds 带到 toast，让管理员不必翻日志就能看到失败原因。
func (h *SearchHandler) recordLastBatch(startedAt time.Time, result *dto.IndexBatchResult) {
	if result == nil {
		return
	}
	h.lastBatchMu.Lock()
	h.lastBatch = &dto.LastBatchSummary{
		Kind:       "batch",
		StartedAt:  startedAt,
		FinishedAt: time.Now(),
		Total:      result.Total,
		Indexed:    result.Indexed,
		Failed:     result.Failed,
		Reason:     result.Reason,
		FailedIDs:  append([]int64(nil), result.FailedIDs...),
	}
	h.lastBatchMu.Unlock()
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
		// AI 问答是可选能力, 未启用不是客户端错误, 也不是请求合法性问题.
		// 用 204 No Content 表达 "这个能力暂不可用, 没东西给你". EventSource
		// 会触发 onerror 被前端静默处理; 前端理想情况下先查 /features 自己
		// gate 掉本次调用 (SearchPanel 已实现), 这里是兜底 —— 直接命中 /qa
		// 也不刷 4xx 错误日志.
		return c.NoContent(http.StatusNoContent)
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
	jobStart := time.Now()
	go func() {
		// 单批最多 100 篇，每篇 90s，预留 3 倍余量给重试/慢请求
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		h.setActiveJob("batch", cancel)
		defer func() {
			cancel()
			h.clearActiveJob()
			h.reindexing.Store(false)
		}()
		result, err := h.svc.IndexBatchPosts(ctx, postIDs)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				log.Info().Msg("async index-batch canceled by admin")
				return
			}
			log.Error().Err(err).Msg("async index-batch failed")
			return
		}
		log.Info().
			Int("total", result.Total).
			Int("indexed", result.Indexed).
			Int("failed", result.Failed).
			Msg("async index-batch completed")
		h.recordLastBatch(jobStart, result)
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
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		h.setActiveJob("full", cancel)
		defer func() {
			cancel()
			h.clearActiveJob()
			h.reindexing.Store(false)
		}()
		body, _, err := h.svc.ProxyReindex(ctx, bytes.NewReader(reqBody), headers)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				log.Info().Msg("async reindex canceled by admin")
				return
			}
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
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		h.setActiveJob("retry", cancel)
		defer func() {
			cancel()
			h.clearActiveJob()
			h.reindexing.Store(false)
		}()
		body, _, err := h.svc.ProxyRetryFailed(ctx, headers)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				log.Info().Msg("async retry-failed canceled by admin")
				return
			}
			log.Error().Err(err).Msg("async retry-failed failed")
			return
		}
		defer body.Close()
		io.ReadAll(body)
		log.Info().Msg("async retry-failed completed")
	}()

	return response.OK(c, map[string]string{"status": "started", "message": "重试失败任务已在后台启动"})
}

// Cancel 处理 POST /v1/admin/search/cancel 请求，取消当前活跃的索引任务。
//
// 语义：
//   - 若当前无活跃任务 → 返回 200 + {status:"idle"}，前端据此清理本地 job 面板
//   - 若有任务 → 触发 context.CancelFunc，任务 goroutine 会尽快退出:
//       * IndexBatchPosts 内部的逐篇 http 调用发现 ctx.Done 后立刻返回 context.Canceled
//       * ProxyReindex / ProxyRetryFailed 基于 aiClient.DoStream(ctx, …) 也会立即断开
//     残留的 PENDING 文章保持 PENDING 状态（下次触发索引时仍会被选中），
//     避免"取消后状态被强改成 FAILED"引起用户混淆
func (h *SearchHandler) Cancel(c echo.Context) error {
	kind := h.cancelActiveJob()
	if kind == "" {
		return response.OK(c, map[string]string{
			"status":  "idle",
			"message": "当前没有进行中的索引任务",
		})
	}
	log.Info().Str("kind", kind).Msg("search indexing job cancel requested")
	return response.OK(c, map[string]string{
		"status":  "canceling",
		"kind":    kind,
		"message": "索引任务正在取消，稍后生效",
	})
}

// LastBatch 处理 GET /v1/admin/search/last-batch 请求，返回最近一次 batch
// 索引完成后的摘要（含 reason / failedIds）。仅 in-memory 缓存，restart 后清空。
//
// 前端在进度面板结束（done >= jobTotal）时调用此端点，结合 finishedAt 与
// job.startTime 比对，判断是不是本次任务的结果。从而把"失败原因"做成 toast
// 上的可读字符串，避免管理员去翻 docker 日志（这是 codex review #577 的痛点）。
func (h *SearchHandler) LastBatch(c echo.Context) error {
	h.lastBatchMu.RLock()
	summary := h.lastBatch
	h.lastBatchMu.RUnlock()
	if summary == nil {
		return response.OK(c, nil)
	}
	return response.OK(c, summary)
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

// ProxyProfiles 通配代理 ``/v1/admin/search/profiles[/*]`` 到 ai-service。
//
// 设计取舍：
//   - profile CRUD（list / create / activate / deprecate / delete）走同步代理 DoSync
//   - 唯一的流式端点 ``POST /{code}/reindex/stream`` 走 DoStream + line-by-line forward
//     （借用 ai_handler 的 validateSSELine 白名单 + bufio.Scanner 实现，避免代码重复）
//   - 路径提取使用 c.Param("*")，与 ai_handler.ProxyProviders 一致，防止
//     手动 `EscapedPath()` 提取带来的路由绕过和 `..` / `%2F` 注入
//
// SSE 帧通过 nginx 时已在 ``/api/v1/admin/search`` location 配 ``proxy_buffering off``
// + ``proxy_read_timeout 600s``，浏览器看到的延迟仅是 ai-service emit 间隔。
func (h *SearchHandler) ProxyProfiles(c echo.Context) error {
	// 动态提取代理前缀
	proxyPrefix := strings.TrimSuffix(strings.TrimSuffix(c.Path(), "*"), "/")

	// 使用 c.Param("*") 提取子路径，保留原始编码
	param := c.Param("*")
	encodedSubPath := ""
	if param != "" {
		encodedSubPath = "/" + param
	} else if strings.HasSuffix(c.Request().URL.EscapedPath(), "/") {
		encodedSubPath = "/"
	}

	// AI service 的路由前缀已包含完整 ``/api/v1/admin/search/profiles``，
	// 这里需要完整的前缀加上子路径。
	targetPath := proxyPrefix + encodedSubPath

	// 多级解码尝试，发现 `..` 后整体拒绝（深度防御）
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

	queryString := c.QueryString()
	if queryString != "" {
		targetPath = targetPath + "?" + queryString
	}

	method := c.Request().Method
	headers := searchProxyHeaders(c)

	// SSE 流式端点：路径以 ``/reindex/stream`` 结尾且方法为 POST
	isStream := method == http.MethodPost &&
		strings.HasSuffix(c.Request().URL.Path, "/reindex/stream")

	if isStream {
		return h.proxyProfileStream(c, method, targetPath, headers)
	}

	var reqBody io.Reader
	if method != http.MethodGet && method != http.MethodDelete {
		reqBody = c.Request().Body
		defer c.Request().Body.Close()
	}
	body, statusCode, err := h.svc.ProxyProfileSync(c.Request().Context(), method, targetPath, reqBody, headers)
	if err != nil {
		return handleSearchError(c, err)
	}
	defer body.Close()
	return searchProxyResponse(c, body, statusCode)
}

// proxyProfileStream 处理 POST /{code}/reindex/stream，将 ai-service 的 SSE
// 帧逐行透传给浏览器。复用 ai_handler 的 validateSSELine 白名单（已扩展
// 支持 start / progress 事件类型）。
//
// 并发约束（codex review #552）：复用 reindexing 原子锁，防止与 Reindex /
// RetryFailed / IndexBatch / 另一条 profile reindex 并发执行 —— 这些都对
// post_embeddings 与 posts.embedding_status 写入，并发会引发竞态、双倍负载
// 与不一致状态。SSE handler 同步阻塞直到流结束，所以锁在 defer 里释放即可
// （不像异步 Reindex 是 goroutine 内释放）。
func (h *SearchHandler) proxyProfileStream(
	c echo.Context, method, targetPath string, headers map[string]string,
) error {
	if !h.reindexing.CompareAndSwap(false, true) {
		// 故意不用 response.Fail —— 它返回 HTTP 200 + 失败 envelope，符合 Java 端
		// 既有约定。但本端点的消费者 (apps/admin/src/hooks/useReindexStream.ts)
		// 是 fetch + SSE reader，``if (!res.ok)`` 判定为错误的唯一信号是
		// HTTP 状态码 ——  200 envelope 会让它继续读 body 当 SSE 帧解析，
		// 找不到 ``data:`` 行 → stream 无声结束 → ProfileActivationFlow 卡在
		// "reindexing" 步永不退出 (codex P1, PR #557 review)。
		// 这里用 409 + 同形 envelope，envelope 让 admin UI 错误解析器拿到 message，
		// 409 让 SSE consumer 正确进入 error 分支。
		return c.JSON(http.StatusConflict, response.R{
			Code:    http.StatusConflict,
			Message: "索引任务正在进行中，请等待完成或取消后重试",
		})
	}
	// SSE 走的是同步阻塞（当前 goroutine 即任务 goroutine），所以这里直接绑定
	// 当前 request 的 ctx cancel —— Cancel 端点调用 cancelActiveJob() 会触发
	// ctx.Done()，DoStream 内部的 http 调用会立即返回，连带让我们退出 scanner 循环。
	//
	// 故意不加 ``context.WithTimeout(..., 30*time.Minute)``：那个 30 分钟硬上限
	// 是 Reindex / IndexBatch 这类 ``异步 goroutine`` 的兜底 circuit breaker，
	// 不适合 SSE 同步流。timeout 触发时 scanner 静默退 EOF，handler 返回 nil，
	// 不会再 emit 终端 ``error`` / ``result`` 帧 —— ProfileActivationFlow 的
	// 状态机只在 ``stream.error`` / ``stream.result`` 翻转时离开 reindexing 步，
	// 静默 EOF 会让 UI 永远卡在 reindexing (codex P2 → PR #557)。
	// "锁被持有过久" 的安全网由其他层覆盖：客户端断开 ⇒ request ctx fire；
	// ai-service hang ⇒ streamClient HTTP 超时；nginx ⇒ proxy_read_timeout。
	streamCtx, cancel := context.WithCancel(c.Request().Context())
	h.setActiveJob("profile-reindex", cancel)
	defer func() {
		cancel()
		h.clearActiveJob()
		h.reindexing.Store(false)
	}()

	body := c.Request().Body
	defer body.Close()

	respBody, statusCode, err := h.svc.ProxyProfileStream(
		streamCtx, method, targetPath, body, headers,
	)
	if err != nil {
		// codex P1 (PR #557): handleSearchError 的 response.Fail 分支会返回
		// HTTP 200 + envelope，对 axios 调用方安全，但对本端点的 SSE 消费者
		// (useReindexStream) 而言 200 = "我开始读 SSE body 了" → 解出空帧 →
		// 静默 EOF → ProfileActivationFlow 卡死。所有 pre-stream 错误必须
		// 走非 2xx 路径，让 useReindexStream 的 ``!res.ok`` 走 error 分支。
		//
		// cancel 优先：如果 streamCtx 在 ProxyProfileStream 内部就被外部
		// /v1/admin/search/cancel 端点取消，专门返回 409 + cancel 文案。
		// 其它情况用 502 + 上游错误透传。
		httpStatus := http.StatusBadGateway
		msg := "上游 AI 服务错误"
		if streamCtx.Err() != nil {
			httpStatus = http.StatusConflict
			msg = "重建索引已被取消"
		} else if errors.Is(err, service.ErrAIClientNil) {
			httpStatus = http.StatusServiceUnavailable
			msg = "AI 服务未配置，请检查服务端 AI 配置"
		} else if clientErr, ok := err.(*service.AIClientError); ok {
			msg = clientErr.Message
		}
		return c.JSON(httpStatus, response.R{
			Code:    httpStatus,
			Message: msg,
		})
	}
	defer respBody.Close()

	if statusCode != http.StatusOK {
		// 上游返回非 200（如 404/400），按同步响应透传
		return searchProxyResponse(c, respBody, statusCode)
	}

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

	// 跟踪上游是否已经 emit 终态帧（done / result / error）。
	// codex P2 review (PR #557): 如果是被外部 cancel 端点中断，scanner 会安静退
	// 出，handler 返回 nil，但 useReindexStream 没看到任何 ``error`` /
	// ``result`` 帧 → ProfileActivationFlow 永远不会离开 ``reindexing`` 步。
	// 必须在这里补一个 error 帧让前端状态机能转移。
	sawTerminalUpstream := false
	for scanner.Scan() {
		line := scanner.Text()
		if !validateSSELine(line) {
			continue
		}
		// 复用 validateSSELine 的解析逻辑判定终态。validateSSELine 内部已经
		// 解过一次 JSON，这里再解一次确实有重复成本，但 SSE 事件量级（数 K）
		// 完全可承受，换来跨 handler 复用比抽出共享 helper 更简单。
		if strings.HasPrefix(line, "data:") {
			payload := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(line, "data: "), "data:"))
			if payload != "" {
				var evt sseEvent
				if err := json.Unmarshal([]byte(payload), &evt); err == nil {
					if evt.Type == "done" || evt.Type == "result" || evt.Type == "error" {
						sawTerminalUpstream = true
					}
				}
			}
		}
		fmt.Fprintf(w, "%s\n", line)
		flusher.Flush()
	}
	scanErr := scanner.Err()
	if scanErr != nil {
		log.Warn().Err(scanErr).Msg("profile reindex SSE scanner error")
	}

	// 如果上游在终态前就被中断（cancel 端点 / 客户端断开 / 上游连接错误），
	// 而上游又没自己 emit 终态，这里替它 emit 一个 error 帧，让前端能转移
	// 出 reindexing 步。区分 cancel vs upstream-error 让前端 toast 文案能差异化。
	if !sawTerminalUpstream {
		var fallback string
		switch {
		case streamCtx.Err() != nil:
			fallback = `data: {"type":"error","code":"cancelled","message":"重建索引已被取消"}` + "\n\n"
		case scanErr != nil:
			fallback = `data: {"type":"error","code":"upstream","message":"上游连接中断"}` + "\n\n"
		}
		if fallback != "" {
			fmt.Fprint(w, fallback)
			flusher.Flush()
		}
	}
	return nil
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
