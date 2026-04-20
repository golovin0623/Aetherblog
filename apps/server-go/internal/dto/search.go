package dto

import "time"

// SearchRequest 是公开搜索 API 的查询参数。
type SearchRequest struct {
	Query string `query:"q"    validate:"required,min=1,max=200"`
	Mode  string `query:"mode"` // "keyword" | "semantic" | "hybrid"（默认 hybrid）
	Limit int    `query:"limit" validate:"omitempty,min=1,max=50"`
	Page  int    `query:"page"  validate:"omitempty,min=1"`
}

// SearchResultItem 是搜索结果中的单条记录。
type SearchResultItem struct {
	ID          int64      `json:"id"`
	Title       string     `json:"title"`
	Slug        string     `json:"slug"`
	Summary     *string    `json:"summary,omitempty"`
	Highlight   string     `json:"highlight"`
	Category    *string    `json:"category,omitempty"`
	Score       float64    `json:"score"`
	Source      string     `json:"source"` // "keyword" | "semantic"
	PublishedAt *time.Time `json:"publishedAt,omitempty"`
}

// SearchResponse 是搜索 API 的响应体。
type SearchResponse struct {
	Items []SearchResultItem `json:"items"`
	Total int                `json:"total"`
	Mode  string             `json:"mode"` // 实际使用的搜索模式（可能降级）
}

// SearchConfig 是从 site_settings 读取的搜索配置。
type SearchConfig struct {
	KeywordEnabled       bool `json:"keywordEnabled"`
	SemanticEnabled      bool `json:"semanticEnabled"`
	AiQAEnabled          bool `json:"aiQaEnabled"`
	AnonSearchRatePerMin int  `json:"anonSearchRatePerMin"`
	AnonQARatePerMin     int  `json:"anonQaRatePerMin"`
	AutoIndexOnPublish   bool `json:"autoIndexOnPublish"`
	// IndexPostTimeoutSec 单篇文章索引的超时时间（秒）。生产环境中转 + 大文章
	// 的 embedding 请求偶尔超过 60s，保留充足的单篇超时空间避免误判失败。
	// Go 侧会为每篇文章启动独立 context，AI service 的 aembedding timeout 也
	// 会透传这个值，保证两端一致。
	IndexPostTimeoutSec int `json:"indexPostTimeoutSec"`
	// SemanticTimeoutMs hybrid 模式下语义搜索的单次超时（毫秒）。关键词可以
	// 兜底,不能让慢 embedding 拖慢整次请求。纯 semantic 模式仍走 ctx 原始超时。
	SemanticTimeoutMs int `json:"semanticTimeoutMs"`
}

// EmbeddingPostItem 是管理端文章向量索引列表中的单条记录。
type EmbeddingPostItem struct {
	ID              int64      `json:"id" db:"id"`
	Title           string     `json:"title" db:"title"`
	Slug            string     `json:"slug" db:"slug"`
	Status          string     `json:"status" db:"status"`
	EmbeddingStatus string     `json:"embeddingStatus" db:"embedding_status"`
	PublishedAt     *time.Time `json:"publishedAt,omitempty" db:"published_at"`
	UpdatedAt       time.Time  `json:"updatedAt" db:"updated_at"`
}

// EmbeddingPostListResponse 是文章向量索引列表的分页响应。
type EmbeddingPostListResponse struct {
	Items []EmbeddingPostItem `json:"items"`
	Total int                 `json:"total"`
}

// IndexBatchRequest 是批量索引请求体。
type IndexBatchRequest struct {
	PostIDs []int64 `json:"postIds" validate:"required,min=1"`
}

// IndexBatchResult 是批量索引操作的响应。
type IndexBatchResult struct {
	Indexed int    `json:"indexed"`
	Failed  int    `json:"failed"`
	Total   int    `json:"total"`
	Reason  string `json:"reason,omitempty"`
}
