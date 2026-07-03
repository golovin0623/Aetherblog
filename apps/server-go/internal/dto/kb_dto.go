// Package dto · kb_dto.go — 知识库相关 HTTP DTO（请求体 + 响应 VO）。
package dto

import "time"

// =====================================================================
// 知识库主体
// =====================================================================

// KnowledgeBaseVO 列表 / 详情通用 VO。
type KnowledgeBaseVO struct {
	ID              int64     `json:"id"`
	Slug            string    `json:"slug"`
	Name            string    `json:"name"`
	Description     *string   `json:"description,omitempty"`
	Icon            *string   `json:"icon,omitempty"`
	Color           *string   `json:"color,omitempty"`
	CoverImage      *string   `json:"coverImage,omitempty"`
	Kind            string    `json:"kind"`
	OwnerID         *int64    `json:"ownerId,omitempty"`
	OwnerName       *string   `json:"ownerName,omitempty"`
	Visibility      string    `json:"visibility"`
	FolderID        *int64    `json:"folderId,omitempty"`
	ActiveProfileID *int64    `json:"activeProfileId,omitempty"`
	ActiveProfile   *KBProfileVO `json:"activeProfile,omitempty"`
	FileCount       int       `json:"fileCount"`
	ChunkCount      int       `json:"chunkCount"`
	VectorizedCount int       `json:"vectorizedCount"`
	FailedCount     int       `json:"failedCount"`
	TotalTokens     int64     `json:"totalTokens"`
	IsArchived      bool      `json:"isArchived"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
	// 当前请求者对该 KB 的有效权限（owner / VIEW / USE / EDIT / MANAGE）。
	// SYSTEM_POSTS 库对 admin 始终返回 MANAGE。
	EffectivePermission string `json:"effectivePermission"`
}

// CreateKnowledgeBaseRequest 新建知识库。slug 留空时由 service 从 name 生成。
type CreateKnowledgeBaseRequest struct {
	Slug        string  `json:"slug" validate:"omitempty,max=120"`
	Name        string  `json:"name" validate:"required,max=120"`
	Description *string `json:"description"`
	Icon        *string `json:"icon"  validate:"omitempty,max=50"`
	Color       *string `json:"color" validate:"omitempty,max=20"`
	Visibility  string  `json:"visibility" validate:"omitempty,oneof=PRIVATE TEAM PUBLIC"`
	// 可选：创建库时同时创建一个非默认 profile（很少用，主要为脚本场景）。
	InitialProfile *CreateKBProfileRequest `json:"initialProfile,omitempty"`
}

// UpdateKnowledgeBaseRequest 更新知识库可变属性。
type UpdateKnowledgeBaseRequest struct {
	Name            *string `json:"name"        validate:"omitempty,max=120"`
	Description     *string `json:"description"`
	Icon            *string `json:"icon"        validate:"omitempty,max=50"`
	Color           *string `json:"color"       validate:"omitempty,max=20"`
	CoverImage      *string `json:"coverImage"`
	Visibility      *string `json:"visibility"  validate:"omitempty,oneof=PRIVATE TEAM PUBLIC"`
	ActiveProfileID *int64  `json:"activeProfileId"`
}

// =====================================================================
// 知识库简介
// =====================================================================

type KBProfileVO struct {
	ID                 int64     `json:"id"`
	KBID               int64     `json:"kbId"`
	Code               string    `json:"code"`
	Name               string    `json:"name"`
	Description        *string   `json:"description,omitempty"`
	ModelID            string    `json:"modelId"`
	ChunkerKind        string    `json:"chunkerKind"`
	ChunkSizeTokens    int       `json:"chunkSizeTokens"`
	ChunkOverlapTokens int       `json:"chunkOverlapTokens"`
	TopK               int       `json:"topK"`
	ScoreThreshold     float64   `json:"scoreThreshold"`
	Status             string    `json:"status"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type CreateKBProfileRequest struct {
	Code               string  `json:"code"               validate:"required,max=64"`
	Name               string  `json:"name"               validate:"required,max=120"`
	Description        *string `json:"description"`
	ModelID            string  `json:"modelId"            validate:"required,max=120"`
	ChunkerKind        string  `json:"chunkerKind"        validate:"required,oneof=recursive fixed markdown qa parent_child"`
	ChunkSizeTokens    int     `json:"chunkSizeTokens"    validate:"required,min=64,max=8192"`
	ChunkOverlapTokens int      `json:"chunkOverlapTokens" validate:"min=0"`
	TopK               int      `json:"topK"               validate:"omitempty,min=1,max=50"`
	// 用 *float64 区分"未提供"和"显式 0"。0 是 valid 值（拉满召回不过滤）；
	// 缺省时由 repo 用 0.200 兜底（review chatgpt-codex P2 修复：之前 float64
	// 的 0 值被误当成缺省替换为 0.200）。
	ScoreThreshold     *float64 `json:"scoreThreshold"     validate:"omitempty,min=0,max=1"`
}

type UpdateKBProfileRequest struct {
	Name               *string  `json:"name"               validate:"omitempty,max=120"`
	Description        *string  `json:"description"`
	ModelID            *string  `json:"modelId"            validate:"omitempty,max=120"`
	ChunkerKind        *string  `json:"chunkerKind"        validate:"omitempty,oneof=recursive fixed markdown qa parent_child"`
	ChunkSizeTokens    *int     `json:"chunkSizeTokens"    validate:"omitempty,min=64,max=8192"`
	ChunkOverlapTokens *int     `json:"chunkOverlapTokens" validate:"omitempty,min=0"`
	TopK               *int     `json:"topK"               validate:"omitempty,min=1,max=50"`
	ScoreThreshold     *float64 `json:"scoreThreshold"     validate:"omitempty,min=0,max=1"`
}

// =====================================================================
// 知识库会员
// =====================================================================

type KBMemberVO struct {
	ID              int64      `json:"id"`
	KBID            int64      `json:"kbId"`
	PrincipalType   string     `json:"principalType"` // USER / TEAM / ROLE
	PrincipalID     int64      `json:"principalId"`
	PrincipalName   *string    `json:"principalName,omitempty"`
	PermissionLevel string     `json:"permissionLevel"`
	GrantedBy       *int64     `json:"grantedBy,omitempty"`
	GrantedByName   *string    `json:"grantedByName,omitempty"`
	GrantedAt       time.Time  `json:"grantedAt"`
	ExpiresAt       *time.Time `json:"expiresAt,omitempty"`
}

type CreateKBMemberRequest struct {
	PrincipalType   string     `json:"principalType"   validate:"required,oneof=USER TEAM ROLE"`
	PrincipalID     int64      `json:"principalId"     validate:"required,gt=0"`
	PermissionLevel string     `json:"permissionLevel" validate:"required,oneof=VIEW USE EDIT MANAGE"`
	ExpiresAt       *time.Time `json:"expiresAt"`
}

type UpdateKBMemberRequest struct {
	PermissionLevel string     `json:"permissionLevel" validate:"required,oneof=VIEW USE EDIT MANAGE"`
	ExpiresAt       *time.Time `json:"expiresAt"`
}

// =====================================================================
// 知识库文件
// =====================================================================

type KBFileVO struct {
	ID              int64      `json:"id"`
	KBID            int64      `json:"kbId"`
	MediaFileID     *int64     `json:"mediaFileId,omitempty"`
	PostID          *int64     `json:"postId,omitempty"`
	Category        *string    `json:"category,omitempty"`
	Title           *string    `json:"title,omitempty"`
	SourceURL       *string    `json:"sourceUrl,omitempty"`
	// 引用字段（service 层 join 后回填）
	Filename        *string    `json:"filename,omitempty"`
	FileSize        *int64     `json:"fileSize,omitempty"`
	MimeType        *string    `json:"mimeType,omitempty"`
	FileURL         *string    `json:"fileUrl,omitempty"`
	DocChars        *int       `json:"docChars,omitempty"`
	DocTokens       *int       `json:"docTokens,omitempty"`
	ChunkCount      int        `json:"chunkCount"`
	VectorStatus    string     `json:"vectorStatus"`
	VectorError     *string    `json:"vectorError,omitempty"`
	VectorProfileID *int64     `json:"vectorProfileId,omitempty"`
	VectorizedAt    *time.Time `json:"vectorizedAt,omitempty"`
	AttemptCount    int        `json:"attemptCount"`
	ArchivedYear    *int       `json:"archivedYear,omitempty"`
	ArchivedMonth   *int       `json:"archivedMonth,omitempty"`
	ArchivedDay     *int       `json:"archivedDay,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

type KBFileListQuery struct {
	Status   string `query:"status"`
	Category string `query:"category"`
	Keyword  string `query:"q"`
	Year     int    `query:"year"`
	Month    int    `query:"month"`
	Day      int    `query:"day"`
	PageNum  int    `query:"page"`
	PageSize int    `query:"pageSize"`
}

// KBStatsVO 详情页头部聚合卡。
type KBStatsVO struct {
	FileCount       int   `json:"fileCount"`
	ChunkCount      int   `json:"chunkCount"`
	VectorizedCount int   `json:"vectorizedCount"`
	FailedCount     int   `json:"failedCount"`
	PendingCount    int   `json:"pendingCount"`
	TotalTokens     int64 `json:"totalTokens"`
	// 时间轴桶：按年月聚合的文件计数（最多近 24 个月）
	TimelineBuckets []KBTimelineBucket `json:"timelineBuckets,omitempty"`
}

type KBTimelineBucket struct {
	Year  int `json:"year"`
	Month int `json:"month"`
	Count int `json:"count"`
}

// =====================================================================
// 代理选择器
// =====================================================================

// AgentKnowledgeBaseVO 灵境 KB picker 的轻量 VO（仅含用户可用的 KB）。
type AgentKnowledgeBaseVO struct {
	ID            int64  `json:"id"`
	Slug          string `json:"slug"`
	Name          string `json:"name"`
	Icon          *string `json:"icon,omitempty"`
	Color         *string `json:"color,omitempty"`
	Kind          string `json:"kind"`
	ActiveProfile *KBProfileVO `json:"activeProfile,omitempty"`
	FileCount     int    `json:"fileCount"`
	ChunkCount    int    `json:"chunkCount"`
}
