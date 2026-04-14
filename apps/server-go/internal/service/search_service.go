package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// SearchService 编排关键词搜索和语义搜索，支持 RRF 融合和优雅降级。
type SearchService struct {
	postRepo      *repository.PostRepo
	aiClient      *AIClient
	settingSvc    *SiteSettingService
	rdb           *redis.Client
	internalToken string
}

// NewSearchService 创建 SearchService 实例。
func NewSearchService(
	postRepo *repository.PostRepo,
	aiClient *AIClient,
	settingSvc *SiteSettingService,
	rdb *redis.Client,
	internalToken string,
) *SearchService {
	return &SearchService{
		postRepo:      postRepo,
		aiClient:      aiClient,
		settingSvc:    settingSvc,
		rdb:           rdb,
		internalToken: internalToken,
	}
}

// GetSearchConfig 从 site_settings 读取搜索配置。
// 使用 GetByKeyPrefix 单次查询 "search." 前缀的所有配置项，
// 不依赖 group_name 或 setting_type，兼容各种写入场景。
func (s *SearchService) GetSearchConfig(ctx context.Context) dto.SearchConfig {
	cfg := dto.SearchConfig{
		KeywordEnabled:       true,
		SemanticEnabled:      false,
		AiQAEnabled:          false,
		AnonSearchRatePerMin: 10,
		AnonQARatePerMin:     3,
		AutoIndexOnPublish:   true,
	}

	m, err := s.settingSvc.GetByKeyPrefix(ctx, "search.")
	if err != nil || len(m) == 0 {
		return cfg
	}

	if v, ok := m["search.keyword_enabled"]; ok {
		cfg.KeywordEnabled = parseBool(v)
	}
	if v, ok := m["search.semantic_enabled"]; ok {
		cfg.SemanticEnabled = parseBool(v)
	}
	if v, ok := m["search.ai_qa_enabled"]; ok {
		cfg.AiQAEnabled = parseBool(v)
	}
	if v, ok := m["search.anon_search_rate_per_min"]; ok {
		if n, e := strconv.Atoi(v); e == nil {
			cfg.AnonSearchRatePerMin = n
		}
	}
	if v, ok := m["search.anon_qa_rate_per_min"]; ok {
		if n, e := strconv.Atoi(v); e == nil {
			cfg.AnonQARatePerMin = n
		}
	}
	if v, ok := m["search.auto_index_on_publish"]; ok {
		cfg.AutoIndexOnPublish = parseBool(v)
	}

	return cfg
}

// parseBool 将字符串解析为布尔值，兼容各种大小写和格式。
func parseBool(s string) bool {
	b, _ := strconv.ParseBool(s)
	return b || s == "yes"
}

// UpdateSearchConfig 批量更新搜索配置。
func (s *SearchService) UpdateSearchConfig(ctx context.Context, kv map[string]string) error {
	return s.settingSvc.SetBatch(ctx, kv)
}

// ListPostsEmbedding 返回已发布文章的向量索引状态列表。
func (s *SearchService) ListPostsEmbedding(ctx context.Context, statusFilter string, limit, offset int) (*dto.EmbeddingPostListResponse, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	items, total, err := s.postRepo.ListEmbeddingStatus(ctx, statusFilter, limit, offset)
	if err != nil {
		return nil, err
	}
	return &dto.EmbeddingPostListResponse{Items: items, Total: total}, nil
}

// IndexBatchPosts 批量索引指定文章（同步执行，逐篇调用 AI service）。
func (s *SearchService) IndexBatchPosts(ctx context.Context, postIDs []int64) (*dto.IndexBatchResult, error) {
	if s.aiClient == nil {
		return nil, ErrAIClientNil
	}

	posts, err := s.postRepo.FindByIDs(ctx, postIDs)
	if err != nil {
		return nil, fmt.Errorf("query posts: %w", err)
	}

	// 使用独立上下文调用 AI 服务，避免客户端断开连接后取消索引操作。
	// 索引是后台任务，不应因手机端断开（HTTP 499）而中断。
	aiCtx, aiCancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer aiCancel()

	headers := map[string]string{
		"X-Internal-Service": s.internalToken,
	}

	result := &dto.IndexBatchResult{Total: len(posts)}
	var lastErr string
	for _, post := range posts {
		content := ""
		if post.ContentMarkdown != nil {
			content = *post.ContentMarkdown
		}
		payload, _ := json.Marshal(map[string]any{
			"postId":  post.ID,
			"title":   post.Title,
			"slug":    post.Slug,
			"content": content,
			"action":  "upsert",
		})
		body, statusCode, err := s.aiClient.DoStream(aiCtx, http.MethodPost, "/api/v1/admin/search/index",
			strings.NewReader(string(payload)), headers)
		if err != nil {
			result.Failed++
			lastErr = err.Error()
			log.Warn().Int64("postId", post.ID).Err(err).Msg("index post request failed")
			continue
		}
		if statusCode != http.StatusOK {
			result.Failed++
			lastErr = fmt.Sprintf("AI 服务返回状态码 %d", statusCode)
			log.Warn().Int64("postId", post.ID).Int("status", statusCode).Msg("index post failed")
			body.Close()
			continue
		}
		body.Close()
		result.Indexed++
	}
	if result.Failed > 0 && result.Indexed == 0 && lastErr != "" {
		result.Reason = lastErr
	}
	return result, nil
}

// Search 执行搜索，支持 keyword / semantic / hybrid 三种模式。
func (s *SearchService) Search(ctx context.Context, query, mode string, limit int) (*dto.SearchResponse, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	if mode == "" {
		mode = "hybrid"
	}

	cfg := s.GetSearchConfig(ctx)

	var kwResults, semResults []dto.SearchResultItem
	var wg sync.WaitGroup
	var kwErr, semErr error

	// 关键词搜索
	if cfg.KeywordEnabled && (mode == "keyword" || mode == "hybrid") {
		wg.Add(1)
		go func() {
			defer wg.Done()
			kwResults, kwErr = s.keywordSearch(ctx, query, limit)
		}()
	}

	// 语义搜索
	if cfg.SemanticEnabled && (mode == "semantic" || mode == "hybrid") && s.aiClient != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			semResults, semErr = s.semanticSearch(ctx, query, limit)
		}()
	}

	wg.Wait()

	// 语义搜索失败时静默降级
	if semErr != nil {
		log.Warn().Err(semErr).Msg("semantic search failed, degrading to keyword-only")
		semResults = nil
	}

	// 确定实际使用的模式
	actualMode := mode
	if len(kwResults) > 0 && len(semResults) > 0 {
		actualMode = "hybrid"
		items := fusionRRF(kwResults, semResults, 60, limit)
		return &dto.SearchResponse{Items: items, Total: len(items), Mode: actualMode}, nil
	}
	if len(semResults) > 0 {
		actualMode = "semantic"
		return &dto.SearchResponse{Items: semResults, Total: len(semResults), Mode: actualMode}, nil
	}
	if len(kwResults) > 0 {
		actualMode = "keyword"
		return &dto.SearchResponse{Items: kwResults, Total: len(kwResults), Mode: actualMode}, nil
	}

	// 关键词搜索也出错，返回错误
	if kwErr != nil {
		return nil, kwErr
	}

	return &dto.SearchResponse{Items: []dto.SearchResultItem{}, Total: 0, Mode: actualMode}, nil
}

// keywordSearch 使用 PostgreSQL 全文搜索。
func (s *SearchService) keywordSearch(ctx context.Context, query string, limit int) ([]dto.SearchResultItem, error) {
	rows, err := s.postRepo.SearchPublished(ctx, query, limit, 0)
	if err != nil {
		return nil, err
	}

	items := make([]dto.SearchResultItem, len(rows))
	for i, r := range rows {
		highlight := ""
		if r.Summary != nil {
			highlight = *r.Summary
		}
		items[i] = dto.SearchResultItem{
			ID:          r.ID,
			Title:       r.Title,
			Slug:        r.Slug,
			Summary:     r.Summary,
			Highlight:   highlight,
			Category:    r.CategoryName,
			Score:       r.Rank,
			Source:      "keyword",
			PublishedAt: r.PublishedAt,
		}
	}
	return items, nil
}

// semanticSearchResult 是 AI service 语义搜索的响应结构。
// AI service 的 PostRef schema 返回 id（字符串）, title, slug。
type semanticSearchResult struct {
	Code int `json:"code"`
	Data struct {
		Results []struct {
			Post struct {
				ID    string `json:"id"`
				Title string `json:"title"`
				Slug  string `json:"slug"`
			} `json:"post"`
			Similarity float64 `json:"similarity"`
			Highlight  string  `json:"highlight"`
		} `json:"results"`
	} `json:"data"`
}

// semanticSearch 通过 AI service 执行语义搜索。
func (s *SearchService) semanticSearch(ctx context.Context, query string, limit int) ([]dto.SearchResultItem, error) {
	path := fmt.Sprintf("/api/v1/search/semantic/internal?q=%s&limit=%d",
		url.QueryEscape(query), limit)

	body, statusCode, err := s.aiClient.DoSync(ctx, http.MethodGet, path, nil,
		map[string]string{"X-Internal-Service": s.internalToken})
	if err != nil {
		return nil, err
	}
	defer body.Close()

	if statusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(body)
		return nil, fmt.Errorf("semantic search returned %d: %s", statusCode, string(respBytes))
	}

	var result semanticSearchResult
	if err := json.NewDecoder(body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode semantic search response: %w", err)
	}

	items := make([]dto.SearchResultItem, 0, len(result.Data.Results))
	for _, r := range result.Data.Results {
		postID, _ := strconv.ParseInt(r.Post.ID, 10, 64)
		items = append(items, dto.SearchResultItem{
			ID:        postID,
			Title:     r.Post.Title,
			Slug:      r.Post.Slug,
			Highlight: r.Highlight,
			Score:     r.Similarity,
			Source:    "semantic",
		})
	}
	return items, nil
}

// fusionRRF 使用 Reciprocal Rank Fusion 合并两组搜索结果。
func fusionRRF(kwResults, semResults []dto.SearchResultItem, k, limit int) []dto.SearchResultItem {
	type scored struct {
		item  dto.SearchResultItem
		score float64
	}

	scores := make(map[int64]*scored)

	for rank, r := range kwResults {
		scores[r.ID] = &scored{
			item:  r,
			score: 1.0 / float64(k+rank+1),
		}
	}

	for rank, r := range semResults {
		if existing, ok := scores[r.ID]; ok {
			existing.score += 1.0 / float64(k+rank+1)
		} else {
			scores[r.ID] = &scored{
				item:  r,
				score: 1.0 / float64(k+rank+1),
			}
		}
	}

	results := make([]scored, 0, len(scores))
	for _, s := range scores {
		results = append(results, *s)
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].score > results[j].score
	})

	if len(results) > limit {
		results = results[:limit]
	}

	items := make([]dto.SearchResultItem, len(results))
	for i, r := range results {
		r.item.Score = r.score
		r.item.Source = "hybrid"
		items[i] = r.item
	}
	return items
}

// ErrAIClientNil 在 aiClient 未配置时返回给调用方的错误。
var ErrAIClientNil = fmt.Errorf("AI service client is not configured")

// ProxyQA 代理 QA 请求到 AI service 并返回 SSE 流。
func (s *SearchService) ProxyQA(ctx context.Context, query string) (io.ReadCloser, int, error) {
	if s.aiClient == nil {
		return nil, http.StatusServiceUnavailable, ErrAIClientNil
	}
	path := fmt.Sprintf("/api/v1/search/qa?q=%s", url.QueryEscape(query))
	return s.aiClient.DoStream(ctx, http.MethodGet, path, nil,
		map[string]string{"X-Internal-Service": s.internalToken})
}

// ProxySearchStats 代理索引统计请求到 AI service。
func (s *SearchService) ProxySearchStats(ctx context.Context, headers map[string]string) (io.ReadCloser, int, error) {
	if s.aiClient == nil {
		return nil, http.StatusServiceUnavailable, ErrAIClientNil
	}
	return s.aiClient.DoSync(ctx, http.MethodGet, "/api/v1/admin/search/stats", nil, headers)
}

// ProxyReindex 代理全量重建索引请求到 AI service。
// 使用 DoStream（长超时客户端）因为全量重建索引可能耗时数分钟。
func (s *SearchService) ProxyReindex(ctx context.Context, body io.Reader, headers map[string]string) (io.ReadCloser, int, error) {
	if s.aiClient == nil {
		return nil, http.StatusServiceUnavailable, ErrAIClientNil
	}
	return s.aiClient.DoStream(ctx, http.MethodPost, "/api/v1/admin/search/reindex", body, headers)
}

// ProxyRetryFailed 代理重试失败索引请求到 AI service。
// 使用 DoStream（长超时客户端）因为批量重试可能耗时数分钟。
func (s *SearchService) ProxyRetryFailed(ctx context.Context, headers map[string]string) (io.ReadCloser, int, error) {
	if s.aiClient == nil {
		return nil, http.StatusServiceUnavailable, ErrAIClientNil
	}
	return s.aiClient.DoStream(ctx, http.MethodPost, "/api/v1/admin/search/retry-failed", nil, headers)
}

// ProxyEmbeddingStatus 代理 embedding 路由状态查询到 AI service。
func (s *SearchService) ProxyEmbeddingStatus(ctx context.Context, headers map[string]string) (io.ReadCloser, int, error) {
	if s.aiClient == nil {
		return nil, http.StatusServiceUnavailable, ErrAIClientNil
	}
	return s.aiClient.DoSync(ctx, http.MethodGet, "/api/v1/admin/providers/routing/embedding", nil, headers)
}
