package model

import "time"

// ReadingBook 对应 `reading_books` 表，是「拟真阅读」模块的核心实体。
// 它把某个来源（文章 / 学习笔记 / 知识库文件）预处理成一份已转换的成书格式，
// content_html 为预渲染并净化后的 HTML 缓存，前台阅读器可直接读取、无需二次渲染。
type ReadingBook struct {
	ID          int64      `db:"id"`
	Slug        string     `db:"slug"`
	Title       string     `db:"title"`
	Author      *string    `db:"author"`
	CoverImage  *string    `db:"cover_image"`
	SourceType  string     `db:"source_type"` // POST / NOTE / KB_FILE
	SourceID    int64      `db:"source_id"`
	SourceRef   *string    `db:"source_ref"`
	ContentHTML *string    `db:"content_html"`
	TOC         []byte     `db:"toc"` // JSONB
	WordCount   int        `db:"word_count"`
	ReadingTime int        `db:"reading_time"`
	Status      string     `db:"status"` // PENDING / READY / FAILED
	Error       *string    `db:"error"`
	Theme       string     `db:"theme"`
	CreatedBy   *int64     `db:"created_by"`
	GeneratedAt *time.Time `db:"generated_at"`
	CreatedAt   time.Time  `db:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at"`
}

// ReadingBook 来源类型与状态常量。
const (
	ReadingSourcePost   = "POST"
	ReadingSourceNote   = "NOTE"
	ReadingSourceKBFile = "KB_FILE"

	ReadingStatusPending = "PENDING"
	ReadingStatusReady   = "READY"
	ReadingStatusFailed  = "FAILED"
)
