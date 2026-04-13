package dto

import "time"

// CreatePostRequest 是 POST 和 PUT /admin/posts 接口的请求体 DTO，用于创建或全量更新文章。
type CreatePostRequest struct {
	Title        string     `json:"title"      validate:"required,max=200"` // 文章标题，最多 200 个字符（必填）
	Content      string     `json:"content"    validate:"required"`          // 文章正文内容（必填）
	Summary      *string    `json:"summary"    validate:"omitempty,max=500"` // 文章摘要，最多 500 个字符（可选）
	CoverImage   *string    `json:"coverImage"`                              // 封面图片 URL（可选）
	CategoryID   *int64     `json:"categoryId"`                              // 所属分类 ID（可选）
	TagIDs       []int64    `json:"tagIds"`                                  // 文章标签 ID 列表（可选）
	Status       string     `json:"status"`                                  // 文章状态：DRAFT（草稿）| PUBLISHED（已发布）| ARCHIVED（已归档）
	Slug         *string    `json:"slug"`                                    // 自定义 URL 别名（可选，留空则自动生成）
	Password     *string    `json:"password"`                                // 文章访问密码（可选，设置后需验证才可查看）
	IsHidden     *bool      `json:"isHidden"`                                // 是否在文章列表中隐藏（可选）
	IsPinned     *bool      `json:"isPinned"`                                // 是否置顶（可选）
	PinPriority  *int       `json:"pinPriority"`                             // 置顶优先级，数值越大越靠前（可选）
	AllowComment *bool      `json:"allowComment"`                            // 是否允许评论（可选）
	PublishedAt  *time.Time `json:"publishedAt"`                             // 指定发布时间，用于定时发布（可选）
}

// UpdatePostPropertiesRequest 是 PATCH /admin/posts/{id}/properties 接口的请求体 DTO，
// 用于局部更新文章属性，所有字段均为可选（omitempty）。
type UpdatePostPropertiesRequest struct {
	Title        *string    `json:"title"        validate:"omitempty,max=200"` // 文章标题（可选）
	Summary      *string    `json:"summary"      validate:"omitempty,max=500"` // 文章摘要（可选）
	CoverImage   *string    `json:"coverImage"`                                // 封面图片 URL（可选）
	CategoryID   *int64     `json:"categoryId"`                                // 所属分类 ID（可选）
	TagIDs       []int64    `json:"tagIds"`                                    // 文章标签 ID 列表（可选）
	Status       *string    `json:"status"`                                    // 文章状态（可选）
	IsPinned     *bool      `json:"isPinned"`                                  // 是否置顶（可选）
	PinPriority  *int       `json:"pinPriority"`                               // 置顶优先级（可选）
	AllowComment *bool      `json:"allowComment"`                              // 是否允许评论（可选）
	Password     *string    `json:"password"`                                  // 文章访问密码（可选）
	IsHidden     *bool      `json:"isHidden"`                                  // 是否隐藏（可选）
	Slug         *string    `json:"slug"`                                      // URL 别名（可选）
	CreatedAt    *time.Time `json:"createdAt"`                                 // 创建时间（可选，用于手动修正）
	UpdatedAt    *time.Time `json:"updatedAt"`                                 // 更新时间（可选，用于手动修正）
	PublishedAt  *time.Time `json:"publishedAt"`                               // 发布时间（可选）
	ViewCount    *int64     `json:"viewCount"`                                 // 浏览量（可选，用于手动修正）
}

// PostPasswordRequest 是验证加密文章访问密码的请求体 DTO。
type PostPasswordRequest struct {
	Password string `json:"password" validate:"required"` // 文章访问密码（必填）
}

// CategoryInfo 是文章响应中内嵌的分类简要信息。
type CategoryInfo struct {
	ID   int64  `json:"id"`   // 分类 ID
	Name string `json:"name"` // 分类名称
	Slug string `json:"slug"` // 分类 URL 别名
}

// TagInfo 是文章响应中内嵌的标签简要信息。
type TagInfo struct {
	ID    int64  `json:"id"`    // 标签 ID
	Name  string `json:"name"`  // 标签名称
	Slug  string `json:"slug"`  // 标签 URL 别名
	Color string `json:"color"` // 标签颜色
}

// PostListItem 是文章分页列表中的单条文章数据 DTO。
type PostListItem struct {
	ID               int64      `json:"id"`               // 文章 ID
	Title            string     `json:"title"`            // 文章标题
	Slug             string     `json:"slug"`             // URL 别名
	Summary          *string    `json:"summary"`          // 文章摘要（可为空）
	CoverImage       *string    `json:"coverImage"`       // 封面图片 URL（可为空）
	Status           string     `json:"status"`           // 文章状态
	CategoryName     *string    `json:"categoryName"`     // 所属分类名称（可为空）
	TagNames         []string   `json:"tagNames"`         // 标签名称列表
	ViewCount        int64      `json:"viewCount"`        // 浏览量
	CommentCount     int64      `json:"commentCount"`     // 评论数
	IsPinned         bool       `json:"isPinned"`         // 是否置顶
	PinPriority      int        `json:"pinPriority"`      // 置顶优先级
	IsHidden         bool       `json:"isHidden"`         // 是否隐藏
	PasswordRequired bool       `json:"passwordRequired"` // 是否需要密码才能查看
	PublishedAt      *time.Time `json:"publishedAt"`      // 发布时间（未发布则为空）
	CreatedAt        time.Time  `json:"createdAt"`        // 创建时间
}

// PostDetail 是文章详情接口的完整响应 DTO。
type PostDetail struct {
	ID                 int64              `json:"id"`                        // 文章 ID
	Title              string             `json:"title"`                     // 文章标题
	Slug               string             `json:"slug"`                      // URL 别名
	Content            *string            `json:"content"`                   // 文章正文内容（可为空，加密文章未验证时为空）
	Summary            *string            `json:"summary"`                   // 文章摘要（可为空）
	CoverImage         *string            `json:"coverImage"`                // 封面图片 URL（可为空）
	Status             string             `json:"status"`                    // 文章状态
	Category           *CategoryInfo      `json:"category"`                  // 所属分类信息（可为空）
	CategoryID         *int64             `json:"categoryId"`                // 所属分类 ID（可为空）
	CategoryName       *string            `json:"categoryName"`              // 所属分类名称（可为空）
	Tags               []TagInfo          `json:"tags"`                      // 文章标签列表
	ViewCount          int64              `json:"viewCount"`                 // 浏览量
	CommentCount       int64              `json:"commentCount"`              // 评论数
	LikeCount          int64              `json:"likeCount"`                 // 点赞数
	WordCount          int                `json:"wordCount"`                 // 正文字数
	ReadingTime        int                `json:"readingTime"`               // 预计阅读时间（分钟）
	IsPinned           bool               `json:"isPinned"`                  // 是否置顶
	PinPriority        int                `json:"pinPriority"`               // 置顶优先级
	IsHidden           bool               `json:"isHidden"`                  // 是否隐藏
	AllowComment       bool               `json:"allowComment"`              // 是否允许评论
	PasswordRequired   bool               `json:"passwordRequired"`          // 是否需要密码才能查看
	HasPassword        bool               `json:"hasPassword"`               // 文章是否设置了访问密码（管理端用于 UI 显示，不暴露密码值）
	SEOTitle           *string            `json:"seoTitle"`                  // SEO 标题（可为空）
	SEODescription     *string            `json:"seoDescription"`            // SEO 描述（可为空）
	SEOKeywords        *string            `json:"seoKeywords"`               // SEO 关键词（可为空）
	LegacyAuthorName   *string            `json:"legacyAuthorName"`          // 历史遗留作者名称（旧数据迁移用，可为空）
	LegacyVisitedCount int64              `json:"legacyVisitedCount"`        // 历史遗留访问量（旧数据迁移用）
	PublishedAt        *time.Time         `json:"publishedAt"`               // 发布时间（未发布则为空）
	ScheduledAt        *time.Time         `json:"scheduledAt"`               // 定时发布时间（可为空）
	CreatedAt          time.Time          `json:"createdAt"`                 // 创建时间
	UpdatedAt          time.Time          `json:"updatedAt"`                 // 最后更新时间
	Draft              *CreatePostRequest `json:"draft,omitempty"`           // 草稿内容（存在未保存草稿时返回）
}

// AdjacentPost 是文章上一篇/下一篇导航中的文章简要信息。
type AdjacentPost struct {
	ID    int64  `json:"id"`    // 文章 ID
	Title string `json:"title"` // 文章标题
	Slug  string `json:"slug"`  // URL 别名
}

// AdjacentPostResponse 是 /{slug}/adjacent 接口的响应 DTO，包含前后篇文章信息。
type AdjacentPostResponse struct {
	PrevPost *AdjacentPost `json:"prevPost"` // 上一篇文章（无上一篇则为 null）
	NextPost *AdjacentPost `json:"nextPost"` // 下一篇文章（无下一篇则为 null）
}

// ArchiveItem 是文章归档列表中的单篇文章数据。
type ArchiveItem struct {
	ID    int64  `json:"id"`    // 文章 ID
	Title string `json:"title"` // 文章标题
	Slug  string `json:"slug"`  // URL 别名
	Date  string `json:"date"`  // 发布日期，格式为 "2024-03-15"
}

// ArchiveStats 是按月统计的文章归档数据项。
type ArchiveStats struct {
	YearMonth string `json:"yearMonth"` // 年月，格式为 "2024-03"
	Count     int    `json:"count"`     // 该月发布的文章数量
}

// PostFilter 是管理后台文章列表查询的过滤条件参数。
type PostFilter struct {
	Status       string     // 文章状态过滤（DRAFT/PUBLISHED/ARCHIVED，为空则不过滤）
	Keyword      string     // 关键词搜索（匹配标题或正文）
	CategoryID   *int64     // 按分类 ID 过滤（为空则不过滤）
	TagID        *int64     // 按标签 ID 过滤（为空则不过滤）
	MinViewCount *int       // 最小浏览量限制（为空则不过滤）
	MaxViewCount *int       // 最大浏览量限制（为空则不过滤）
	StartDate    *time.Time // 创建时间起始范围（为空则不过滤）
	EndDate      *time.Time // 创建时间结束范围（为空则不过滤）
	Hidden       *bool      // 是否过滤隐藏文章（为空则不过滤）
	PageNum      int        // 当前页码（从 1 开始）
	PageSize     int        // 每页条数
}
