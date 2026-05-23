package dto

import "time"

// CreateNoteRequest 是 POST/PUT /admin/notes 的请求体 DTO。
type CreateNoteRequest struct {
	Title           *string        `json:"title" validate:"omitempty,max=200"`
	ContentMarkdown *string        `json:"contentMarkdown"`
	Summary         *string        `json:"summary" validate:"omitempty,max=2000"`
	FolderID        *int64         `json:"folderId"`
	TagNames        []string       `json:"tagNames"`
	SourceType      *string        `json:"sourceType"`
	SourceURL       *string        `json:"sourceUrl"`
	SourceTitle     *string        `json:"sourceTitle"`
	SourceMeta      map[string]any `json:"sourceMeta"`
	IsPinned        *bool          `json:"isPinned"`
	IsFavorite      *bool          `json:"isFavorite"`
}

// UpdateNotePropertiesRequest 是 PATCH /admin/notes/:id/properties 的请求体 DTO。
type UpdateNotePropertiesRequest struct {
	Title       *string        `json:"title" validate:"omitempty,max=200"`
	Summary     *string        `json:"summary" validate:"omitempty,max=2000"`
	FolderID    *int64         `json:"folderId"`
	TagNames    []string       `json:"tagNames"`
	SourceType  *string        `json:"sourceType"`
	SourceURL   *string        `json:"sourceUrl"`
	SourceTitle *string        `json:"sourceTitle"`
	SourceMeta  map[string]any `json:"sourceMeta"`
	IsPinned    *bool          `json:"isPinned"`
	IsFavorite  *bool          `json:"isFavorite"`
	Archived    *bool          `json:"archived"`
}

// AutoSaveNoteRequest 是 POST /admin/notes/:id/auto-save 的请求体 DTO。
type AutoSaveNoteRequest struct {
	Title           *string        `json:"title"`
	ContentMarkdown *string        `json:"contentMarkdown"`
	FolderID        *int64         `json:"folderId"`
	TagNames        []string       `json:"tagNames"`
	SourceMeta      map[string]any `json:"sourceMeta"`
}

// NoteListItem 是后台笔记分页列表中的单条记录。
type NoteListItem struct {
	ID              int64      `json:"id"`
	Title           string     `json:"title"`
	Summary         *string    `json:"summary"`
	FolderID        *int64     `json:"folderId"`
	FolderName      *string    `json:"folderName"`
	TagNames        []string   `json:"tagNames"`
	SourceType      string     `json:"sourceType"`
	IsPinned        bool       `json:"isPinned"`
	IsFavorite      bool       `json:"isFavorite"`
	Archived        bool       `json:"archived"`
	WordCount       int        `json:"wordCount"`
	EmbeddingStatus string     `json:"embeddingStatus"`
	LastOpenedAt    *time.Time `json:"lastOpenedAt"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

// NoteLinkItem 是出链/反链列表中的单条关系。
type NoteLinkItem struct {
	ID            int64  `json:"id"`
	SourceNoteID  int64  `json:"sourceNoteId"`
	SourceTitle   string `json:"sourceTitle"`
	TargetNoteID  *int64 `json:"targetNoteId"`
	TargetTitle   string `json:"targetTitle"`
	LinkText      string `json:"linkText"`
	PositionStart *int   `json:"positionStart"`
	PositionEnd   *int   `json:"positionEnd"`
}

// NoteDetail 是笔记详情接口的完整响应。
type NoteDetail struct {
	NoteListItem
	ContentMarkdown string             `json:"contentMarkdown"`
	SourceURL       *string            `json:"sourceUrl"`
	SourceTitle     *string            `json:"sourceTitle"`
	SourceMeta      map[string]any     `json:"sourceMeta"`
	OutLinks        []NoteLinkItem     `json:"outLinks"`
	BackLinks       []NoteLinkItem     `json:"backLinks"`
	Draft           *CreateNoteRequest `json:"draft,omitempty"`
}

// NoteFolderItem 是笔记文件夹响应 DTO。
type NoteFolderItem struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	ParentID  *int64    `json:"parentId"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CreateNoteFolderRequest 是创建笔记文件夹的请求体。
type CreateNoteFolderRequest struct {
	Name      string `json:"name" validate:"required,max=100"`
	ParentID  *int64 `json:"parentId"`
	SortOrder *int   `json:"sortOrder"`
}

// NoteTagItem 是笔记标签响应 DTO。
type NoteTagItem struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// NoteFilter 是后台笔记列表查询条件。
type NoteFilter struct {
	Keyword    string
	View       string
	FolderID   *int64
	Tag        string
	SourceType string
	Archived   *bool
	PageNum    int
	PageSize   int
}
