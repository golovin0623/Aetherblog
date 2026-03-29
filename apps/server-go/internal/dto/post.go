package dto

import "time"

// CreatePostRequest is used for POST and PUT /admin/posts.
type CreatePostRequest struct {
	Title      string  `json:"title"      validate:"required,max=200"`
	Content    string  `json:"content"    validate:"required"`
	Summary    *string `json:"summary"    validate:"omitempty,max=500"`
	CoverImage *string `json:"coverImage"`
	CategoryID *int64  `json:"categoryId"`
	TagIDs     []int64 `json:"tagIds"`
	Status     string  `json:"status"` // DRAFT | PUBLISHED | ARCHIVED
	Slug       *string `json:"slug"`
	Password   *string `json:"password"`
	IsHidden   *bool   `json:"isHidden"`
	IsPinned   *bool   `json:"isPinned"`
	PinPriority *int   `json:"pinPriority"`
	AllowComment *bool `json:"allowComment"`
	PublishedAt *time.Time `json:"publishedAt"`
}

// UpdatePostPropertiesRequest is used for PATCH /admin/posts/{id}/properties.
type UpdatePostPropertiesRequest struct {
	Title        *string    `json:"title"        validate:"omitempty,max=200"`
	Summary      *string    `json:"summary"      validate:"omitempty,max=500"`
	CoverImage   *string    `json:"coverImage"`
	CategoryID   *int64     `json:"categoryId"`
	TagIDs       []int64    `json:"tagIds"`
	Status       *string    `json:"status"`
	IsPinned     *bool      `json:"isPinned"`
	PinPriority  *int       `json:"pinPriority"`
	AllowComment *bool      `json:"allowComment"`
	Password     *string    `json:"password"`
	IsHidden     *bool      `json:"isHidden"`
	Slug         *string    `json:"slug"`
	CreatedAt    *time.Time `json:"createdAt"`
	UpdatedAt    *time.Time `json:"updatedAt"`
	PublishedAt  *time.Time `json:"publishedAt"`
	ViewCount    *int64     `json:"viewCount"`
}

// PostPasswordRequest verifies a password-protected post.
type PostPasswordRequest struct {
	Password string `json:"password" validate:"required"`
}

// CategoryInfo is the embedded category in post responses.
type CategoryInfo struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// TagInfo is the embedded tag in post responses.
type TagInfo struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	Color string `json:"color"`
}

// PostListItem is the item in paginated post lists.
type PostListItem struct {
	ID              int64      `json:"id"`
	Title           string     `json:"title"`
	Slug            string     `json:"slug"`
	Summary         *string    `json:"summary"`
	CoverImage      *string    `json:"coverImage"`
	Status          string     `json:"status"`
	CategoryName    *string    `json:"categoryName"`
	TagNames        []string   `json:"tagNames"`
	ViewCount       int64      `json:"viewCount"`
	CommentCount    int64      `json:"commentCount"`
	IsPinned        bool       `json:"isPinned"`
	PinPriority     int        `json:"pinPriority"`
	IsHidden        bool       `json:"isHidden"`
	PasswordRequired bool      `json:"passwordRequired"`
	PublishedAt     *time.Time `json:"publishedAt"`
	CreatedAt       time.Time  `json:"createdAt"`
}

// PostDetail is the full post detail response.
type PostDetail struct {
	ID               int64         `json:"id"`
	Title            string        `json:"title"`
	Slug             string        `json:"slug"`
	Content          *string       `json:"content"`
	Summary          *string       `json:"summary"`
	CoverImage       *string       `json:"coverImage"`
	Status           string        `json:"status"`
	Category         *CategoryInfo `json:"category"`
	CategoryID       *int64        `json:"categoryId"`
	CategoryName     *string       `json:"categoryName"`
	Tags             []TagInfo     `json:"tags"`
	ViewCount        int64         `json:"viewCount"`
	CommentCount     int64         `json:"commentCount"`
	LikeCount        int64         `json:"likeCount"`
	WordCount        int           `json:"wordCount"`
	ReadingTime      int           `json:"readingTime"`
	IsPinned         bool          `json:"isPinned"`
	PinPriority      int           `json:"pinPriority"`
	IsHidden         bool          `json:"isHidden"`
	AllowComment     bool          `json:"allowComment"`
	PasswordRequired bool          `json:"passwordRequired"`
	Password         *string       `json:"password,omitempty"` // admin-only
	SEOTitle         *string       `json:"seoTitle"`
	SEODescription   *string       `json:"seoDescription"`
	SEOKeywords      *string       `json:"seoKeywords"`
	LegacyAuthorName *string       `json:"legacyAuthorName"`
	LegacyVisitedCount int64       `json:"legacyVisitedCount"`
	PublishedAt      *time.Time    `json:"publishedAt"`
	ScheduledAt      *time.Time    `json:"scheduledAt"`
	CreatedAt        time.Time     `json:"createdAt"`
	UpdatedAt        time.Time     `json:"updatedAt"`
	Draft            *CreatePostRequest `json:"draft,omitempty"`
}

// AdjacentPost holds the prev/next navigation links.
type AdjacentPost struct {
	ID    int64   `json:"id"`
	Title string  `json:"title"`
	Slug  string  `json:"slug"`
}

// AdjacentPostResponse is the response for /{slug}/adjacent.
type AdjacentPostResponse struct {
	PrevPost *AdjacentPost `json:"prevPost"`
	NextPost *AdjacentPost `json:"nextPost"`
}

// ArchiveItem is a single post in the archive list.
type ArchiveItem struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
	Slug  string `json:"slug"`
	Date  string `json:"date"` // "2024-03-15"
}

// ArchiveStats is the monthly archive statistics item.
type ArchiveStats struct {
	YearMonth string `json:"yearMonth"` // "2024-03"
	Count     int    `json:"count"`
}

// PostFilter holds admin post list filter parameters.
type PostFilter struct {
	Status       string
	Keyword      string
	CategoryID   *int64
	TagID        *int64
	MinViewCount *int
	MaxViewCount *int
	StartDate    *time.Time
	EndDate      *time.Time
	Hidden       *bool
	PageNum      int
	PageSize     int
}
