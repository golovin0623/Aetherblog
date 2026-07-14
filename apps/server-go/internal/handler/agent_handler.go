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
//
//	POST /chat              SSE 多轮对话（透传到 ai-service）
//	GET  /models            可用模型列表（用户级隔离，透传到 ai-service）
//	GET  /articles          文章选择器搜索（@ picker 用，本地 DB 查询）
//	GET  /tags              标签选择器列表（# picker 用，本地 DB 查询）
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
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/dto"
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

var (
	errAgentAtlasReadDenied   = errors.New("agent atlas scope requires content.atlas.read")
	errAgentKBSelectionDenied = errors.New("agent selected knowledge bases are not usable")
)

type agentAtlasPermissionChecker interface {
	UserHasPermission(ctx context.Context, userID int64, legacyRole string, permissionCode string) (bool, error)
}

type agentKBService interface {
	BuildUserContext(ctx context.Context, userID int64, legacyRole string) (*service.KBUserContext, error)
	FilterAuthorizedKBIDs(ctx context.Context, ids []int64, uc *service.KBUserContext) []int64
	ListForPicker(ctx context.Context, uc *service.KBUserContext, keyword string) ([]dto.AgentKnowledgeBaseVO, error)
}

// AgentHandler 处理 /api/v1/agent/* 端点。
type AgentHandler struct {
	client        *service.AIClient
	internalToken string
	postRepo      *repository.PostRepo
	tagRepo       *repository.TagRepo
	activitySvc   activityRecorder
	// kbSvc 用于在转发 chat body 之前过滤 kbIds（SECURITY：防客户端拼装未授权 KB id）。
	// nil 时跳过过滤（兼容旧 wire；正式部署必须注入）。
	kbSvc     agentKBService
	atlasPerm agentAtlasPermissionChecker
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

// SetKBService 注入 KBService。server.go 在 wire 时调用一次。
func (h *AgentHandler) SetKBService(kb *service.KBService) {
	h.kbSvc = kb
}

// SetAtlasPermissionChecker 注入 Atlas read permission checker。
func (h *AgentHandler) SetAtlasPermissionChecker(checker agentAtlasPermissionChecker) {
	h.atlasPerm = checker
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

	contextContract, err := normalizeAgentKnowledgeContextBody(bodyBytes)
	if err != nil {
		log.Warn().Err(err).Int64("user_id", lu.UserID).Msg("agent: invalid knowledge context contract")
		h.recordChatActivity(c, len(bodyBytes), http.StatusBadRequest, "知识上下文契约无效")
		return response.FailWith(c, response.BadRequest, "知识上下文模式或来源格式无效")
	}
	bodyBytes = contextContract.Body
	// Explicit selections are authorization-sensitive. If the permission service
	// is not wired, fail closed instead of forwarding unchecked IDs to Python.
	if contextContract.Mode == dto.AgentKnowledgeContextModeSelected &&
		contextContract.HasKnowledgeBaseRefs && h.kbSvc == nil {
		log.Warn().Int64("user_id", lu.UserID).Msg("agent: selected kb rejected because permission service is unavailable")
		h.recordChatActivity(c, len(bodyBytes), http.StatusForbidden, "所选知识库不可用")
		return response.FailWith(c, response.Forbidden, "无法使用所选知识库")
	}

	// SECURITY (review chatgpt-codex P1)：客户端可能塞任意 kbIds 绕过 picker 限制
	// 把未授权库内容注入 prompt。在转发到 ai-service 前校验所有显式 kbIds
	// 仍具备权限（≥ USE）且可用于检索；任一失败都拒绝整个选择。
	//
	// SECURITY · fail-closed（review chatgpt-codex 第二轮）：filterBodyKBIDs 解析
	// 失败时**绝不**透传原 body（否则攻击者可故意构造畸形 kbIds 让解析失败、
	// 绕过权限过滤把未授权 KB 投放给 ai-service）。返回 400 拒绝整个请求。
	if h.kbSvc != nil {
		filtered, ferr := h.filterBodyKBIDs(c.Request().Context(), bodyBytes, lu.UserID, lu.Role)
		if ferr != nil {
			if errors.Is(ferr, errAgentKBSelectionDenied) {
				// Do not distinguish missing, revoked, unreadable, or not-yet-ready KBs in
				// the response: all explicit-selection failures share one opaque contract.
				log.Warn().Int64("user_id", lu.UserID).Msg("agent: explicit kb selection rejected")
				h.recordChatActivity(c, len(bodyBytes), http.StatusForbidden, "所选知识库不可用")
				return response.FailWith(c, response.Forbidden, "无法使用所选知识库")
			}
			log.Warn().Err(ferr).Int64("user_id", lu.UserID).Msg("agent: kbIds permission filter failed, rejecting request")
			h.recordChatActivity(c, len(bodyBytes), http.StatusBadRequest, "kbIds 解析或权限过滤失败")
			return response.FailWith(c, response.BadRequest, "kbIds 字段格式无效或权限解析失败")
		}
		if filtered != nil {
			bodyBytes = filtered
		}
	}
	if filtered, ferr := h.filterBodyAtlasScope(c.Request().Context(), bodyBytes, lu.UserID, lu.Role); ferr != nil {
		if errors.Is(ferr, errAgentAtlasReadDenied) {
			log.Warn().Int64("user_id", lu.UserID).Msg("agent: atlasScope rejected by content.atlas.read")
			h.recordChatActivity(c, len(bodyBytes), http.StatusForbidden, "atlasScope 无读取权限")
			return response.FailWith(c, response.Forbidden, "无权使用 Atlas 上下文")
		}
		log.Warn().Err(ferr).Int64("user_id", lu.UserID).Msg("agent: atlasScope permission filter failed, rejecting request")
		h.recordChatActivity(c, len(bodyBytes), http.StatusBadRequest, "atlasScope 解析或权限过滤失败")
		return response.FailWith(c, response.BadRequest, "atlasScope 字段格式无效或权限解析失败")
	} else if filtered != nil {
		bodyBytes = filtered
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

// articleListResponse 是 picker @ 列表 / 搜索结果的统一返回信封。
//
// 前端 ArticlePicker 用 total 推算总页数（10 / 页），用 page / pageSize 回填
// 当前页码 —— 信封形态比裸数组更利于将来扩展（例如 hasMore、cursor）。
type articleListResponse struct {
	Items    []articleItem `json:"items"`
	Total    int64         `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"pageSize"`
}

// Articles 处理 GET /api/v1/agent/articles?q=&page=&pageSize=
//
//   - q 缺省 / 空 → 走 FindPublishedNoPassword 分页（按 page / pageSize），
//     返回真实 total，前端用于驱动分页 UI（10 / 页固定）。
//   - q 非空      → 走 SearchPublished（tsvector + ILIKE 兜底）；搜索结果
//     不做分页，固定返回前 pageSize*3 (≤30) 条候选，total = 返回条数。
//     原因：搜索本身就是收敛过程，强行翻页容易让用户错过相关结果，体验
//     不如让用户继续打字精化查询。
//   - 兼容旧 `limit` 参数：若指定 `limit` 而未指定 `pageSize`，使用 limit
//     作为 pageSize。
//   - pageSize 上限 30，避免一次性灌大数据；page 最小为 1。
//
// 安全过滤（必读，不要在没读完之前合并）：
//
//	ai_articles 公共列表共有 4 类需要剔除：
//	  · deleted = TRUE                     —— 软删
//	  · status != 'PUBLISHED'              —— 草稿 / 定时未到 / 归档
//	  · is_hidden = TRUE                   —— 仅作者可见
//	  · password IS NOT NULL               —— 密码保护，正常访问要先验密码
//
//	FindPublishedNoPassword 一次性把 4 项全过滤了（SQL 层），分页 total 就
//	是"用户可见"的真实数。SearchPublished 路径仍由 filterPublicArticleIDs
//	做兜底密码过滤。ai-service 那边 _build_picker_context 也有
//	`password IS NULL` 二次防御。
func (h *AgentHandler) Articles(c echo.Context) error {
	if middleware.GetLoginUser(c) == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	q := strings.TrimSpace(c.QueryParam("q"))

	// 解析 pageSize：优先用显式 pageSize；否则回退到旧 limit（兼容老前端）；
	// 都没有就默认 10（picker 现在固定 10/页）。
	pageSize := parseIntDefault(c.QueryParam("pageSize"), 0)
	if pageSize <= 0 {
		pageSize = parseIntDefault(c.QueryParam("limit"), 10)
	}
	if pageSize < 1 {
		pageSize = 10
	}
	if pageSize > 30 {
		pageSize = 30
	}
	page := parseIntDefault(c.QueryParam("page"), 1)
	if page < 1 {
		page = 1
	}

	ctx := c.Request().Context()

	if q == "" {
		rows, total, err := h.postRepo.FindPublishedNoPassword(ctx, page, pageSize)
		if err != nil {
			log.Warn().Err(err).Msg("agent.articles: FindPublishedNoPassword failed")
			return response.FailWith(c, response.InternalError, "查询失败")
		}
		out := make([]articleItem, 0, len(rows))
		for _, r := range rows {
			out = append(out, articleItem{
				ID:          r.ID,
				Slug:        r.Slug,
				Title:       r.Title,
				Summary:     truncate(derefStr(r.Summary), 140),
				Category:    derefStr(r.CategoryName),
				PublishedAt: formatTimePtr(r.PublishedAt),
			})
		}
		return response.OK(c, articleListResponse{
			Items:    out,
			Total:    total,
			Page:     page,
			PageSize: pageSize,
		})
	}

	if len(q) > 200 {
		return response.FailWith(c, response.BadRequest, "查询过长 (上限 200 字符)")
	}
	// 搜索路径不分页：拉多一点候选 (≤30) 后过滤密码保护，截断到 pageSize*3
	// 上限。SearchResultRow 没有 Password 字段，需要在拿到 ID 后做一次
	// 批量 password 过滤兜底。
	searchLimit := pageSize * 3
	if searchLimit > 30 {
		searchLimit = 30
	}
	candidates, err := h.postRepo.SearchPublished(ctx, q, searchLimit*2, 0)
	if err != nil {
		log.Warn().Err(err).Msg("agent.articles: SearchPublished failed")
		return response.FailWith(c, response.InternalError, "搜索失败")
	}
	if len(candidates) == 0 {
		return response.OK(c, articleListResponse{
			Items:    []articleItem{},
			Total:    0,
			Page:     1,
			PageSize: pageSize,
		})
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

	out := make([]articleItem, 0, searchLimit)
	for _, r := range candidates {
		if !publicIDs[r.ID] {
			continue
		}
		if len(out) >= searchLimit {
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
	return response.OK(c, articleListResponse{
		Items:    out,
		Total:    int64(len(out)),
		Page:     1,
		PageSize: pageSize,
	})
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
// 只返回至少关联一篇公开、未隐藏、无密码文章的标签。前端按 postCount 倒序展示。
func (h *AgentHandler) Tags(c echo.Context) error {
	if middleware.GetLoginUser(c) == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	tags, err := h.tagRepo.FindPublicNoPassword(c.Request().Context())
	if err != nil {
		log.Warn().Err(err).Msg("agent.tags: FindPublicNoPassword failed")
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

type agentKnowledgeContextContract struct {
	Mode                 dto.AgentKnowledgeContextMode
	Body                 []byte
	HasKnowledgeBaseRefs bool
	HasAtlasRefs         bool
	LegacyInferred       bool
}

type agentAtlasContextSelection struct {
	KPIDs          []int64 `json:"kpIds"`
	CarrierIDs     []int64 `json:"carrierIds"`
	SemanticRecall *bool   `json:"semanticRecall"`
}

// normalizeAgentKnowledgeContextBody turns the UI's three-state selector into
// an unambiguous wire contract before any source injection happens. Legacy
// requests are inferred only from shapes emitted by the previous UI:
//   - omitted fields -> auto
//   - explicit null/empty opt-out -> none
//   - explicit positive IDs -> selected
//   - empty semantic Atlas scope -> auto
//
// Selected mode also writes null sentinels for every unselected source family,
// preventing the downstream filters from treating an omitted family as auto.
func normalizeAgentKnowledgeContextBody(body []byte) (agentKnowledgeContextContract, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return agentKnowledgeContextContract{}, fmt.Errorf("parse chat body: %w", err)
	}
	if raw == nil {
		return agentKnowledgeContextContract{}, errors.New("parse chat body: expected JSON object")
	}

	kbField, kbExists := raw["kbIds"]
	kbIsNull := kbExists && strings.TrimSpace(string(kbField)) == "null"
	var kbIDs []int64
	if kbExists && !kbIsNull {
		if err := json.Unmarshal(kbField, &kbIDs); err != nil {
			return agentKnowledgeContextContract{}, fmt.Errorf("parse kbIds: %w", err)
		}
		if err := validateAgentContextIDs(kbIDs, 10, "kbIds"); err != nil {
			return agentKnowledgeContextContract{}, err
		}
	}
	hasKBRefs := len(kbIDs) > 0

	atlasField, atlasExists := raw["atlasScope"]
	atlasIsNull := atlasExists && strings.TrimSpace(string(atlasField)) == "null"
	var atlasSelection agentAtlasContextSelection
	if atlasExists && !atlasIsNull {
		if err := json.Unmarshal(atlasField, &atlasSelection); err != nil {
			return agentKnowledgeContextContract{}, fmt.Errorf("parse atlasScope: %w", err)
		}
		if err := validateAgentContextIDs(atlasSelection.KPIDs, 12, "atlasScope.kpIds"); err != nil {
			return agentKnowledgeContextContract{}, err
		}
		if err := validateAgentContextIDs(atlasSelection.CarrierIDs, 6, "atlasScope.carrierIds"); err != nil {
			return agentKnowledgeContextContract{}, err
		}
	}
	hasAtlasRefs := len(atlasSelection.KPIDs) > 0 || len(atlasSelection.CarrierIDs) > 0

	modeField, modeExists := raw["knowledgeContextMode"]
	legacyInferred := !modeExists
	var mode dto.AgentKnowledgeContextMode
	if modeExists {
		if err := json.Unmarshal(modeField, &mode); err != nil || !mode.Valid() {
			return agentKnowledgeContextContract{}, errors.New("invalid knowledgeContextMode")
		}
	} else {
		switch {
		case hasKBRefs || hasAtlasRefs:
			mode = dto.AgentKnowledgeContextModeSelected
		case kbExists && (kbIsNull || len(kbIDs) == 0):
			// The old AetherHub opt-out always sent both null fields. Treating the
			// one-sided or mixed shape as none is the conservative no-private-data
			// fallback; an explicit empty KB sentinel must never enable auto KBs.
			mode = dto.AgentKnowledgeContextModeNone
		case atlasExists && (atlasIsNull ||
			(atlasSelection.SemanticRecall == nil || !*atlasSelection.SemanticRecall)):
			mode = dto.AgentKnowledgeContextModeNone
		default:
			mode = dto.AgentKnowledgeContextModeAuto
		}
	}

	switch mode {
	case dto.AgentKnowledgeContextModeAuto:
		if modeExists && (hasKBRefs || hasAtlasRefs) {
			return agentKnowledgeContextContract{}, errors.New("auto mode cannot carry explicit source IDs")
		}
		// Mode is authoritative: an empty/null kbIds sentinel must not disable
		// automatic permission-scoped injection.
		delete(raw, "kbIds")
	case dto.AgentKnowledgeContextModeNone:
		if hasKBRefs || hasAtlasRefs {
			return agentKnowledgeContextContract{}, errors.New("none mode cannot carry source IDs")
		}
		raw["kbIds"] = json.RawMessage("null")
		raw["atlasScope"] = json.RawMessage("null")
	case dto.AgentKnowledgeContextModeSelected:
		if !hasKBRefs && !hasAtlasRefs {
			return agentKnowledgeContextContract{}, errors.New("selected mode requires explicit source IDs")
		}
		if !hasKBRefs {
			raw["kbIds"] = json.RawMessage("null")
		}
		if !hasAtlasRefs {
			raw["atlasScope"] = json.RawMessage("null")
		} else {
			selectedScope, err := forceSelectedAtlasSemanticRecallOff(atlasField)
			if err != nil {
				return agentKnowledgeContextContract{}, err
			}
			raw["atlasScope"] = selectedScope
		}
	default:
		return agentKnowledgeContextContract{}, errors.New("invalid knowledgeContextMode")
	}

	modeJSON, err := json.Marshal(mode)
	if err != nil {
		return agentKnowledgeContextContract{}, fmt.Errorf("marshal knowledgeContextMode: %w", err)
	}
	raw["knowledgeContextMode"] = modeJSON
	normalized, err := json.Marshal(raw)
	if err != nil {
		return agentKnowledgeContextContract{}, fmt.Errorf("re-encode chat body: %w", err)
	}
	return agentKnowledgeContextContract{
		Mode:                 mode,
		Body:                 normalized,
		HasKnowledgeBaseRefs: hasKBRefs,
		HasAtlasRefs:         hasAtlasRefs,
		LegacyInferred:       legacyInferred,
	}, nil
}

func validateAgentContextIDs(ids []int64, limit int, field string) error {
	if len(ids) > limit {
		return fmt.Errorf("%s exceeds limit", field)
	}
	for _, id := range ids {
		if id <= 0 {
			return fmt.Errorf("%s contains invalid ID", field)
		}
	}
	return nil
}

func forceSelectedAtlasSemanticRecallOff(scope json.RawMessage) (json.RawMessage, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(scope, &raw); err != nil || raw == nil {
		return nil, errors.New("parse selected atlasScope")
	}
	raw["semanticRecall"] = json.RawMessage("false")
	raw["neighborhoodDepth"] = json.RawMessage("0")
	normalized, err := json.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("re-encode selected atlasScope: %w", err)
	}
	return normalized, nil
}

// filterBodyKBIDs 在转发到 ai-service 前，校验 chat 请求 body 里的 kbIds。
// 如果客户端没有显式传 kbIds，自动注入当前用户可用的 KB，
// 让 Agent 默认具备“读可见知识库”的能力，而不是必须先经过 KB picker。
// 显式 null / [] 表示用户选择不使用任何知识库，不做自动注入。
// 显式非空数组表示用户要求使用这些 KB：必须全部仍有 USE 以上权限且已可用；
// 任一项不存在、权限被撤销或尚未就绪时，整体拒绝，绝不降级成部分选择继续回答。
//
// 返回值约定：
//   - (newBody, nil)：body 已自动注入 kbIds
//   - (nil, nil)：无可注入/无需重写
//   - (nil, err)：JSON/权限解析/编码失败；调用方应拒绝请求，避免绕过过滤
//
// 实现要点：使用 map[string]json.RawMessage 解析能保留未知字段顺序与精度（avoid
// 反序列化丢失 float / 长 number），仅替换 kbIds 字段后重新编码。
func (h *AgentHandler) filterBodyKBIDs(ctx context.Context, body []byte, userID int64, legacyRole string) ([]byte, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse chat body: %w", err)
	}
	if raw == nil {
		return nil, fmt.Errorf("parse chat body: expected JSON object")
	}
	kbField, exists := raw["kbIds"]

	// kbIds 可能是 missing / null / [] / [ids...]。只有 missing 走自动
	// 可用 KB 注入；显式 null / [] 表示不使用任何知识库。
	if !exists {
		uc, err := h.kbSvc.BuildUserContext(ctx, userID, legacyRole)
		if err != nil {
			return nil, fmt.Errorf("build user context: %w", err)
		}
		return h.rewriteBodyWithAutoKBIDs(ctx, raw, uc, userID)
	}
	if strings.TrimSpace(string(kbField)) == "null" {
		return nil, nil
	}

	var ids []int64
	if err := json.Unmarshal(kbField, &ids); err != nil {
		return nil, fmt.Errorf("parse kbIds: %w", err)
	}
	if len(ids) == 0 {
		return nil, nil
	}

	uc, err := h.kbSvc.BuildUserContext(ctx, userID, legacyRole)
	if err != nil {
		return nil, fmt.Errorf("build user context: %w", err)
	}

	requested := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		if id <= 0 {
			return nil, errAgentKBSelectionDenied
		}
		requested[id] = struct{}{}
	}

	allowed := h.kbSvc.FilterAuthorizedKBIDs(ctx, ids, uc)
	allowedSet := make(map[int64]struct{}, len(allowed))
	for _, id := range allowed {
		allowedSet[id] = struct{}{}
	}
	for id := range requested {
		if _, ok := allowedSet[id]; !ok {
			return nil, errAgentKBSelectionDenied
		}
	}

	// Authorization alone is insufficient for an explicit handoff. A custom KB
	// without an active profile/chunks cannot answer the promised scoped query.
	// Reuse the picker projection because it carries both current permission and
	// readiness facts; missing rows intentionally collapse into the same denial.
	rows, err := h.kbSvc.ListForPicker(ctx, uc, "")
	if err != nil {
		return nil, fmt.Errorf("list agent kb picker for explicit selection: %w", err)
	}
	usable := make(map[int64]struct{}, len(rows))
	for _, kb := range rows {
		if agentKBUsable(kb) {
			usable[kb.ID] = struct{}{}
		}
	}
	for id := range requested {
		if _, ok := usable[id]; !ok {
			return nil, errAgentKBSelectionDenied
		}
	}

	return nil, nil
}

func (h *AgentHandler) rewriteBodyWithAutoKBIDs(
	ctx context.Context,
	raw map[string]json.RawMessage,
	uc *service.KBUserContext,
	userID int64,
) ([]byte, error) {
	autoIDs, err := h.agentAutoKBIDs(ctx, uc)
	if err != nil {
		return nil, err
	}
	if len(autoIDs) == 0 {
		return nil, nil
	}
	buf, mErr := json.Marshal(autoIDs)
	if mErr != nil {
		return nil, fmt.Errorf("marshal auto kbIds: %w", mErr)
	}
	raw["kbIds"] = json.RawMessage(buf)
	rewrote, err := json.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("re-encode body: %w", err)
	}
	log.Info().
		Int("auto_kb_count", len(autoIDs)).
		Int64("user_id", userID).
		Msg("agent: auto kbIds injected")
	return rewrote, nil
}

func (h *AgentHandler) agentAutoKBIDs(ctx context.Context, uc *service.KBUserContext) ([]int64, error) {
	rows, err := h.kbSvc.ListForPicker(ctx, uc, "")
	if err != nil {
		return nil, fmt.Errorf("list agent kb picker: %w", err)
	}
	ids := make([]int64, 0, 10)
	seen := map[int64]bool{}
	for _, kb := range rows {
		if kb.ID <= 0 || seen[kb.ID] || !agentKBUsable(kb) {
			continue
		}
		seen[kb.ID] = true
		ids = append(ids, kb.ID)
		if len(ids) >= 10 {
			break
		}
	}
	return ids, nil
}

func agentKBUsable(kb dto.AgentKnowledgeBaseVO) bool {
	if kb.Kind == model.KBKindSystemPosts {
		return true
	}
	return kb.ActiveProfile != nil && kb.ChunkCount > 0
}

func (h *AgentHandler) filterBodyAtlasScope(ctx context.Context, body []byte, userID int64, legacyRole string) ([]byte, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse chat body: %w", err)
	}
	scope, exists := raw["atlasScope"]
	if !exists || string(scope) == "null" {
		return nil, nil
	}
	var selection struct {
		KPIDs      []int64 `json:"kpIds"`
		CarrierIDs []int64 `json:"carrierIds"`
	}
	if err := json.Unmarshal(scope, &selection); err != nil {
		return nil, fmt.Errorf("parse atlasScope: %w", err)
	}
	hasExplicitSelection := len(selection.KPIDs) > 0 || len(selection.CarrierIDs) > 0
	stripAutomaticScope := func() ([]byte, error) {
		delete(raw, "atlasScope")
		filtered, err := json.Marshal(raw)
		if err != nil {
			return nil, fmt.Errorf("rewrite chat body without atlasScope: %w", err)
		}
		return filtered, nil
	}
	if h.atlasPerm == nil {
		if !hasExplicitSelection {
			return stripAutomaticScope()
		}
		return nil, errAgentAtlasReadDenied
	}
	ok, err := h.atlasPerm.UserHasPermission(ctx, userID, legacyRole, "content.atlas.read")
	if err != nil {
		return nil, fmt.Errorf("check atlas read permission: %w", err)
	}
	if !ok {
		// An empty scope is the UI's automatic-discovery request. Atlas is not an
		// available source for this user, so remove only that optional scope and
		// keep the rest of the chat request (including automatic KB injection).
		// Explicit KP/carrier selections still fail closed below.
		if !hasExplicitSelection {
			return stripAutomaticScope()
		}
		return nil, errAgentAtlasReadDenied
	}
	return nil, nil
}
