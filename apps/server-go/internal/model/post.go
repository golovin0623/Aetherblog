// Package model 定义与 PostgreSQL 数据库表一一对应的数据模型结构体。
// 字段通过 sqlx 的 `db` 标签与数据库列名对应，可空列使用指针类型表示。
package model

import "time"

// Post 对应数据库 `posts` 表，是博客系统的核心内容单元。
type Post struct {
	ID                 int64      `db:"id"`
	Title              string     `db:"title"`
	Slug               string     `db:"slug"`                 // URL 友好的唯一标识符，不可为空
	ContentMarkdown    *string    `db:"content_markdown"`     // Markdown 原始源文，导入的外部文章可能为 nil
	ContentHTML        *string    `db:"content_html"`         // 预渲染的 HTML 内容；尚未渲染时为 nil
	Summary            *string    `db:"summary"`              // 文章摘要；nil 时由系统在展示时自动生成
	CoverImage         *string    `db:"cover_image"`          // 封面图片 URL；无封面时为 nil
	Status             string     `db:"status"`               // 文章状态：DRAFT（草稿）| PUBLISHED（已发布）| ARCHIVED（已归档）| SCHEDULED（定时发布）
	CategoryID         *int64     `db:"category_id"`          // 所属分类 ID（外键）；nil 表示未分类
	AuthorID           *int64     `db:"author_id"`            // 作者用户 ID（外键）；历史导入文章可能为 nil
	ViewCount          int64      `db:"view_count"`           // 文章浏览次数
	CommentCount       int64      `db:"comment_count"`        // 文章评论数
	LikeCount          int64      `db:"like_count"`           // 文章点赞数
	WordCount          int        `db:"word_count"`           // Markdown 内容的字符数（保存时计算）
	ReadingTime        int        `db:"reading_time"`         // 预估阅读时间（分钟），按 300 字/分钟计算
	IsPinned           bool       `db:"is_pinned"`            // 是否置顶；置顶文章在列表中优先显示
	PinPriority        int        `db:"pin_priority"`         // 置顶排序权重；值越大越靠前
	IsFeatured         bool       `db:"is_featured"`          // 是否为精选文章
	IsHidden           bool       `db:"is_hidden"`            // 是否隐藏；隐藏文章不出现在公开列表中
	AllowComment       bool       `db:"allow_comment"`        // 是否允许评论
	Password           *string    `db:"password"`             // 访问密码的 bcrypt 哈希值；nil 表示公开文章
	SEOTitle           *string    `db:"seo_title"`            // SEO 自定义标题，可为空
	SEODescription     *string    `db:"seo_description"`      // SEO 元描述，可为空
	SEOKeywords        *string    `db:"seo_keywords"`         // SEO 关键词，可为空
	EmbeddingStatus    string     `db:"embedding_status"`     // 向量嵌入状态：PENDING（待处理）| INDEXED（已索引）| FAILED（失败）
	Deleted            bool       `db:"deleted"`              // 软删除标志；已删除文章在所有查询中被排除
	ScheduledAt        *time.Time `db:"scheduled_at"`         // 定时发布的未来时间点；仅 SCHEDULED 状态文章有效
	PublishedAt        *time.Time `db:"published_at"`         // 实际发布时间戳；未发布文章为 nil
	SourceKey          *string    `db:"source_key"`           // 可选的外部来源标识符（如导入任务 ID）
	LegacyAuthorName   *string    `db:"legacy_author_name"`   // 从旧系统迁移时保留的作者名称
	LegacyVisitedCount int64      `db:"legacy_visited_count"` // 从旧系统迁移时保留的历史访问计数
	LegacyCopyright    *string    `db:"legacy_copyright"`     // 从旧系统迁移时保留的版权文本
	CreatedAt          time.Time  `db:"created_at"`           // 记录创建时间
	UpdatedAt          time.Time  `db:"updated_at"`           // 记录最后更新时间
}
