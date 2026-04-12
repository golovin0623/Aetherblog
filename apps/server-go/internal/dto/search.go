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
}
