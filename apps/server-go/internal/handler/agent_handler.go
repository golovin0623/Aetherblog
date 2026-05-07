// Package handler · agent_handler.go
//
// AgentHandler 暴露 /api/v1/agent/* 端点，专供前台 /agent/workspace 使用。
//
// 与 /v1/admin/ai/* 的差异：
//   - 鉴权只要求"已登录"，不再强制 role==admin。
//     原因：Agent 工作台对所有注册用户开放（CLAUDE.md §7 默认凭据 +
//     普通注册用户）。Admin 后台仍走 /v1/admin/ai/*，与本端点互不影响。
//   - 由于下游 ai-service 的 /api/v1/agent/chat 走 require_admin_or_internal，
//     这里强制注入 X-Internal-Service token 让后端以"内部服务"身份代理。
//   - 走 streamClient（StreamReadTimeout 较长），SSE 行级转发，复用
//     validateSSELine 白名单（已加入 think / sources）。
//
// 端点：
//   POST /chat              SSE 多轮对话（透传到 ai-service）
//   GET  /models            可用模型列表（用户级隔离，透传到 ai-service）
//   GET  /articles          文章选择器搜索（@ picker 用，本地 DB 查询）
//   GET  /tags              标签选择器列表（# picker 用，本地 DB 查询）
package handler

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/ctxutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// agentChatBodyLimit 限制 /agent/chat 请求体上限。Python 侧已对单条 8K /
// 总长 32K 做了硬封顶；这里给 64KB 余量覆盖头部 + JSON 编码膨胀，
// 同时给 articleIds / tagSlugs context 留缓冲。
const agentChatBodyLimit = 96 * 1024

// AgentHandler 处理 /api/v1/agent/* 端点。
type AgentHandler struct {
	client        *service.AIClient
	internalToken string
	postRepo      *repository.PostRepo
	tagRepo       *repository.TagRepo
	activitySvc   activityRecorder
}

// NewAgentHandler 注入 AI client、token 与本地查询所需 repo（@/# picker 走本地 DB，
// 不再 round-trip 到 ai-service —— 那些只是名录类只读查询，没必要让 Python 进程介入）。
// activitySvc 用于把 /chat 调用写入 activity_events 表 (审计 LLM 真正费 token 的路径);
// nil 时跳过审计但不阻塞主流程，兼容旧调用方与单测。
func NewAgentHandler(
	cfg *config.Config,
	postRepo *repository.PostRepo,
	tagRepo *repository.TagRepo,
	activitySvc activityRecorder,
) *AgentHandler {
	return &AgentHandler{
		client:        service.NewAIClient(cfg.AI),
		internalToken: cfg.AI.InternalServiceToken,
		postRepo:      postRepo,
		tagRepo:       tagRepo,
		activitySvc:   activitySvc,
	}
}

// Mount 注册到给定的路由组（约定为 /api/v1/agent，已套上 JWT 中间件）。
//
// 两种限流分开传入，原因：把限流挂在 group 上会让 GET /articles 这类 picker
// 端点和 POST /chat 共享同一桶。`@` picker 一边输入一边搜，单次拉一长串
// articles 可能在用户还没发出第一条消息前就把 chat 桶用光，下一条 chat
// 直接拿 429。chatLimit 单独门 LLM 这条贵路径；pickerLimit 给 GET 路径一个
// 较松的桶（picker 反正只查本地 DB，瓶颈在 SQL 不在 LLM）。
func (h *AgentHandler) Mount(g *echo.Group, chatLimit, pickerLimit echo.MiddlewareFunc) {
	g.POST("/chat", h.Chat, chatLimit)
	g.GET("/models", h.Models, pickerLimit)
	g.GET("/articles", h.Articles, pickerLimit)
	g.GET("/tags", h.Tags, pickerLimit)
}

// ============================================================================
// /chat —— SSE 流式多轮对话
// ============================================================================

// Chat 处理 POST /api/v1/agent/chat。把客户端 JSON 请求体透传给
// ai-service 的同名端点，并以 SSE 行级方式回写给客户端。
//
// 安全：
//   - 中间件已校验 JWT，确保上下文里有 LoginUser（任意 role）；
//   - body 上限 96KB，避免 admin token 被滥用做 OOM；
//   - SSE 输出复用 validateSSELine 白名单，不放未知 type 透传。
//
// 审计：每次 /chat 调用写一条 ai.agent_chat 事件 (流开始时入库一次)。
// 不在每条 SSE 事件上写审计 —— 一次问答几十条 think/delta/sources，过细只会
// 把 activity_events 表灌爆。
func (h *AgentHandler) Chat(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	if h.internalToken == "" {
		log.Error().Msg("agent: internal service token not configured")
		return response.FailWith(c, response.InternalError, "AI 服务未配置")
	}

	limited := http.MaxBytesReader(c.Response(), c.Request().Body, agentChatBodyLimit)
	defer limited.Close()
	bodyBytes, err := io.ReadAll(limited)
	if err != nil {
		h.recordChatActivity(c, len(bodyBytes), http.StatusBadRequest, "请求体过大或无法读取")
		return response.FailWith(c, response.BadRequest, "请求体过大或无法读取")
	}

	headers := map[string]string{
		"X-Internal-Service":  h.internalToken,
		"X-Request-ID":        ctxutil.TraceID(c),
		"X-Forwarded-User-ID": fmt.Sprintf("%d", lu.UserID),
	}

	respBody, statusCode, err := h.client.DoStream(
		c.Request().Context(),
		http.MethodPost,
		"/api/v1/agent/chat",
		bytes.NewReader(bodyBytes),
		headers,
	)
	if err != nil {
		if aiErr, ok := err.(*service.AIClientError); ok {
			h.recordChatActivity(c, len(bodyBytes), aiErr.StatusCode, aiErr.Message)
			return c.JSON(aiErr.StatusCode, map[string]any{"code": aiErr.StatusCode, "message": aiErr.Message})
		}
		h.recordChatActivity(c, len(bodyBytes), http.StatusServiceUnavailable, "AI 服务调用失败")
		return response.FailWith(c, response.InternalError, "AI 服务调用失败")
	}
	defer respBody.Close()

	if statusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(respBody)
		h.recordChatActivity(c, len(bodyBytes), statusCode, fmt.Sprintf("上游 HTTP %d", statusCode))
		return c.Blob(statusCode, "application/json", respBytes)
	}

	// 上游 200，开流前写一条「开始」审计 —— 这里写入是 fire-and-forget，
	// 不计算 token 或耗时（耗时统计应当在 ai-service 自己的 metrics 里做）。
	h.recordChatActivity(c, len(bodyBytes), http.StatusOK, "流式开始")

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
		log.Warn().Err(err).Msg("agent SSE scanner error")
	}
	return nil
}

// ============================================================================
// /models —— 模型清单（透传 ai-service）
// ============================================================================

// Models 处理 GET /api/v1/agent/models。
func (h *AgentHandler) Models(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	if h.internalToken == "" {
		log.Error().Msg("agent: internal service token not configured")
		return response.FailWith(c, response.InternalError, "AI 服务未配置")
	}
	headers := map[string]string{
		"X-Internal-Service":  h.internalToken,
		"X-Request-ID":        ctxutil.TraceID(c),
		"X-Forwarded-User-ID": fmt.Sprintf("%d", lu.UserID),
	}
	respBody, statusCode, err := h.client.DoSync(
		c.Request().Context(),
		http.MethodGet,
		"/api/v1/agent/models",
		nil,
		headers,
	)
	if err != nil {
		if aiErr, ok := err.(*service.AIClientError); ok {
			return c.JSON(aiErr.StatusCode, map[string]any{"code": aiErr.StatusCode, "message": aiErr.Message})
		}
		return response.FailWith(c, response.InternalError, "AI 服务调用失败")
	}
	defer respBody.Close()
	body, _ := io.ReadAll(respBody)
	return c.Blob(statusCode, "application/json", body)
}

// ============================================================================
// /articles —— 给 @ picker 用的文章搜索 / 列表
// ============================================================================

// articleItem 是 @ picker 单条返回项。
// 字段精简到展示必需 + 用于上下文注入的 slug —— 不下发完整 content。
type articleItem struct {
	ID          int64  `json:"id"`
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Summary     string `json:"summary,omitempty"`
	Category    string `json:"category,omitempty"`
	PublishedAt string `json:"publishedAt,omitempty"`
}

// Articles 处理 GET /api/v1/agent/articles?q=&limit=
//
//   - q 缺省 / 空 → 返回最近发布的 limit 条（默认 12）；
//   - q 非空      → 走 SearchPublished（tsvector + ILIKE 兜底，对中文友好）；
//   - limit 上限 30，避免一次性灌大数据。
//
// 安全过滤（必读，不要在没读完之前合并）：
//
//   ai_articles 公共列表共有 4 类需要剔除：
//     · deleted = TRUE                     —— 软删
//     · status != 'PUBLISHED'              —— 草稿 / 定时未到 / 归档
//     · is_hidden = TRUE                   —— 仅作者可见
//     · password IS NOT NULL               —— 密码保护，正常访问要先验密码
//
//   `FindPublished` / `SearchPublished` 已经处理了前 3 项，但**没过滤 password**
//   —— 这是 IDOR / 信息泄露同类风险。一旦在 picker 里允许选中一篇密码保护
//   文章，后端 RAG context builder 又会读它的 content_markdown 注入 prompt，
//   等同于绕过密码门把正文送给 LLM（且后续可能在 Agent 回答里复述出来）。
//   因此本端点必须在 Repo 调用之后再做一次本地 password 过滤，
//   ai-service 那边 _build_picker_context 也有 `password IS NULL` 二次防御。
func (h *AgentHandler) Articles(c echo.Context) error {
	if middleware.GetLoginUser(c) == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	q := strings.TrimSpace(c.QueryParam("q"))
	limit := parseIntDefault(c.QueryParam("limit"), 12)
	if limit < 1 {
		limit = 12
	}
	if limit > 30 {
		limit = 30
	}

	ctx := c.Request().Context()

	if q == "" {
		// 拉多一些再过滤密码保护，避免过滤后剩一半导致前端误以为没结果。
		// 取 limit*2 作为缓冲，绝大多数站点密码保护文章占比 < 5%，足够。
		rows, _, err := h.postRepo.FindPublished(ctx, 1, limit*2)
		if err != nil {
			log.Warn().Err(err).Msg("agent.articles: FindPublished failed")
			return response.FailWith(c, response.InternalError, "查询失败")
		}
		out := make([]articleItem, 0, limit)
		for _, r := range rows {
			if r.Password != nil { // 密码保护：前端不展示
				continue
			}
			if len(out) >= limit {
				break
			}
			out = append(out, articleItem{
				ID:          r.ID,
				Slug:        r.Slug,
				Title:       r.Title,
				Summary:     truncate(derefStr(r.Summary), 140),
				Category:    derefStr(r.CategoryName),
				PublishedAt: formatTimePtr(r.PublishedAt),
			})
		}
		return response.OK(c, out)
	}

	if len(q) > 200 {
		return response.FailWith(c, response.BadRequest, "查询过长 (上限 200 字符)")
	}
	// SearchResultRow 没有 Password 字段（只返必要列做相关性排序），需要在
	// 拿到 ID 之后再做一次 password 过滤批量查询。先 SearchPublished 拿候选，
	// 再用 batch SELECT 把密码保护的剔除。
	candidates, err := h.postRepo.SearchPublished(ctx, q, limit*2, 0)
	if err != nil {
		log.Warn().Err(err).Msg("agent.articles: SearchPublished failed")
		return response.FailWith(c, response.InternalError, "搜索失败")
	}
	if len(candidates) == 0 {
		return response.OK(c, []articleItem{})
	}

	ids := make([]int64, 0, len(candidates))
	for _, r := range candidates {
		ids = append(ids, r.ID)
	}
	publicIDs, err := h.filterPublicArticleIDs(ctx, ids)
	if err != nil {
		log.Warn().Err(err).Msg("agent.articles: password filter failed")
		return response.FailWith(c, response.InternalError, "查询失败")
	}

	out := make([]articleItem, 0, limit)
	for _, r := range candidates {
		if !publicIDs[r.ID] {
			continue
		}
		if len(out) >= limit {
			break
		}
		out = append(out, articleItem{
			ID:          r.ID,
			Slug:        r.Slug,
			Title:       r.Title,
			Summary:     truncate(derefStr(r.Summary), 140),
			Category:    derefStr(r.CategoryName),
			PublishedAt: formatTimePtr(r.PublishedAt),
		})
	}
	return response.OK(c, out)
}

// filterPublicArticleIDs 输入候选 id 列表，输出真正"无密码 + 已发布 +
// 未隐藏 + 未删除"的 id 集合。供 Articles search 路径做密码过滤兜底。
//
// 理论上 SearchPublished 已经保证了 status / is_hidden / deleted，但显式重新
// 校验等于一次端到端断言：未来 SearchPublished 实现变化也不会让该端点静默
// 退化成"用 password 列裸暴露"的状态。
func (h *AgentHandler) filterPublicArticleIDs(
	ctx context.Context,
	ids []int64,
) (map[int64]bool, error) {
	if len(ids) == 0 {
		return map[int64]bool{}, nil
	}
	rows, err := h.postRepo.FilterPublicNoPassword(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]bool, len(rows))
	for _, id := range rows {
		out[id] = true
	}
	return out, nil
}

// ============================================================================
// /tags —— 给 # picker 用的标签清单
// ============================================================================

type tagItem struct {
	ID        int64  `json:"id"`
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	PostCount int    `json:"postCount"`
}

// Tags 处理 GET /api/v1/agent/tags
//
// 全量返回（站点标签量级有限，几百以内）。前端按 postCount 倒序展示。
func (h *AgentHandler) Tags(c echo.Context) error {
	if middleware.GetLoginUser(c) == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	tags, err := h.tagRepo.FindAll(c.Request().Context())
	if err != nil {
		log.Warn().Err(err).Msg("agent.tags: FindAll failed")
		return response.FailWith(c, response.InternalError, "查询失败")
	}
	out := make([]tagItem, 0, len(tags))
	for _, t := range tags {
		out = append(out, tagItem{
			ID:        t.ID,
			Slug:      t.Slug,
			Name:      t.Name,
			PostCount: t.PostCount,
		})
	}
	return response.OK(c, out)
}

// ============================================================================
// 审计
// ============================================================================

// recordChatActivity 把一次 /chat 调用写入 activity_events。bodySize 是请求体
// 字节数 (粗略反映用户问答 + context 上下文规模)，httpStatus 决定 status 列：
// 2xx → SUCCESS, 4xx → WARNING, 5xx → ERROR (与 ai_handler.statusFromHTTP 一致)。
// 失败仅 log.Warn，不阻塞主链路。
func (h *AgentHandler) recordChatActivity(c echo.Context, bodySize, httpStatus int, note string) {
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
	desc := fmt.Sprintf("POST /agent/chat · 请求体 %d B · → HTTP %d (%s)", bodySize, httpStatus, note)
	evt := &model.ActivityEvent{
		EventType:     "ai.agent_chat",
		EventCategory: &evtCat,
		Title:         "Agent 工作台对话",
		Description:   &desc,
		UserID:        userID,
		IP:            &ip,
		Status:        &statusText,
	}
	if err := h.activitySvc.Create(c.Request().Context(), evt); err != nil {
		log.Warn().Err(err).Msg("record agent chat activity failed")
	}
}

// ============================================================================
// 工具
// ============================================================================

// truncate 按 rune 截断 + ellipsis，避免在多字节中文里把字截一半。
func truncate(s string, n int) string {
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return string(rs[:n]) + "…"
}

// derefStr 安全展开 *string，nil 返回空串。
func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// formatTimePtr 输出 YYYY-MM-DD（UTC）；nil 返回 ""。
func formatTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format("2006-01-02")
}
