package dto

import (
	"encoding/json"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/markdown"
)

// GenerateReadingBookRequest 是后台「导入并生成拟真阅读」的请求体。
type GenerateReadingBookRequest struct {
	// SourceType：POST（文章）/ NOTE（学习笔记）/ KB_FILE（知识库文件）
	SourceType string `json:"sourceType" validate:"required,oneof=POST NOTE KB_FILE"`
	SourceID   int64  `json:"sourceId" validate:"required"`
	// Theme：可选阅读主题 paper / sepia / night，默认 paper。
	Theme string `json:"theme" validate:"omitempty,oneof=paper sepia night"`
}

// ReadingBookListItem 是后台列表项（不含正文 HTML，减小载荷）。
type ReadingBookListItem struct {
	ID          int64      `json:"id"`
	Slug        string     `json:"slug"`
	Title       string     `json:"title"`
	Author      *string    `json:"author"`
	CoverImage  *string    `json:"coverImage"`
	SourceType  string     `json:"sourceType"`
	SourceID    int64      `json:"sourceId"`
	SourceRef   *string    `json:"sourceRef"`
	WordCount   int        `json:"wordCount"`
	ReadingTime int        `json:"readingTime"`
	Status      string     `json:"status"`
	Error       *string    `json:"error"`
	Theme       string     `json:"theme"`
	GeneratedAt *time.Time `json:"generatedAt"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// ReadingBookDetail 是阅读器/后台详情返回，包含预渲染正文与目录。
type ReadingBookDetail struct {
	ReadingBookListItem
	ContentHTML string             `json:"contentHtml"`
	TOC         []markdown.Heading `json:"toc"`
}

// ToListItem 把模型映射为列表 DTO。
func ToReadingBookListItem(b *model.ReadingBook) ReadingBookListItem {
	return ReadingBookListItem{
		ID:          b.ID,
		Slug:        b.Slug,
		Title:       b.Title,
		Author:      b.Author,
		CoverImage:  b.CoverImage,
		SourceType:  b.SourceType,
		SourceID:    b.SourceID,
		SourceRef:   b.SourceRef,
		WordCount:   b.WordCount,
		ReadingTime: b.ReadingTime,
		Status:      b.Status,
		Error:       b.Error,
		Theme:       b.Theme,
		GeneratedAt: b.GeneratedAt,
		CreatedAt:   b.CreatedAt,
		UpdatedAt:   b.UpdatedAt,
	}
}

// ToReadingBookDetail 把模型映射为含正文的详情 DTO。
func ToReadingBookDetail(b *model.ReadingBook) ReadingBookDetail {
	html := ""
	if b.ContentHTML != nil {
		html = *b.ContentHTML
	}
	toc := []markdown.Heading{}
	if len(b.TOC) > 0 {
		_ = json.Unmarshal(b.TOC, &toc)
	}
	return ReadingBookDetail{
		ReadingBookListItem: ToReadingBookListItem(b),
		ContentHTML:         html,
		TOC:                 toc,
	}
}
