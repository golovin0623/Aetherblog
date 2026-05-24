// Package model · knowledge_base.go — 知识库相关数据库实体。
//
// 详细 schema 见 migrations/000055_knowledge_bases.up.sql。本文件只承载
// Go 侧的字段映射，业务规则由 service 层强制。
package model

import "time"

// KnowledgeBase 对应 knowledge_bases 表。
// CUSTOM 库由用户在 admin UI 自建，物理文件通过 media_files 存于 _system_kb 隐藏子树；
// SYSTEM_POSTS 库是博客文章自动构成的系统库，files 视图反查 posts。
type KnowledgeBase struct {
	ID              int64     `db:"id"`
	Slug            string    `db:"slug"`
	Name            string    `db:"name"`
	Description     *string   `db:"description"`
	Icon            *string   `db:"icon"`
	Color           *string   `db:"color"`
	CoverImage      *string   `db:"cover_image"`
	Kind            string    `db:"kind"`        // 'CUSTOM' | 'SYSTEM_POSTS'
	OwnerID         *int64    `db:"owner_id"`    // SYSTEM_POSTS 为 NULL
	Visibility      string    `db:"visibility"`  // 'PRIVATE' | 'TEAM' | 'PUBLIC'
	FolderID        *int64    `db:"folder_id"`   // 对应 /root/_system_kb/<slug>/ 目录 ID
	ActiveProfileID *int64    `db:"active_profile_id"`
	FileCount       int       `db:"file_count"`
	ChunkCount      int       `db:"chunk_count"`
	VectorizedCount int       `db:"vectorized_count"`
	FailedCount     int       `db:"failed_count"`
	TotalTokens     int64     `db:"total_tokens"`
	IsArchived      bool      `db:"is_archived"`
	CreatedBy       *int64    `db:"created_by"`
	UpdatedBy       *int64    `db:"updated_by"`
	CreatedAt       time.Time `db:"created_at"`
	UpdatedAt       time.Time `db:"updated_at"`
}

// KBProfile 对应 kb_profiles 表。每个 KB 拥有多个 profile，最多一个 status='active'。
type KBProfile struct {
	ID                 int64     `db:"id"`
	KBID               int64     `db:"kb_id"`
	Code               string    `db:"code"`
	Name               string    `db:"name"`
	Description        *string   `db:"description"`
	ModelID            string    `db:"model_id"`
	ChunkerKind        string    `db:"chunker_kind"`
	ChunkSizeTokens    int       `db:"chunk_size_tokens"`
	ChunkOverlapTokens int       `db:"chunk_overlap_tokens"`
	TopK               int       `db:"top_k"`
	ScoreThreshold     float64   `db:"score_threshold"`
	Status             string    `db:"status"` // 'active' | 'shadow' | 'deprecated'
	CreatedAt          time.Time `db:"created_at"`
	UpdatedAt          time.Time `db:"updated_at"`
}

// KBMember 对应 kb_members 表。三种 principal 类型 + 四级权限。
// 所有者隐式 MANAGE，不入此表。
type KBMember struct {
	ID              int64      `db:"id"`
	KBID            int64      `db:"kb_id"`
	PrincipalType   string     `db:"principal_type"`   // 'USER' | 'TEAM' | 'ROLE'
	PrincipalID     int64      `db:"principal_id"`
	PermissionLevel string     `db:"permission_level"` // 'VIEW' | 'USE' | 'EDIT' | 'MANAGE'
	GrantedBy       *int64     `db:"granted_by"`
	GrantedAt       time.Time  `db:"granted_at"`
	ExpiresAt       *time.Time `db:"expires_at"`
}

// KBFile 对应 kb_files 表。CUSTOM 库走 media_file_id；SYSTEM_POSTS 走 post_id（互斥）。
type KBFile struct {
	ID              int64      `db:"id"`
	KBID            int64      `db:"kb_id"`
	MediaFileID     *int64     `db:"media_file_id"`
	PostID          *int64     `db:"post_id"`
	Category        *string    `db:"category"`
	Title           *string    `db:"title"`
	SourceURL       *string    `db:"source_url"`
	DocChars        *int       `db:"doc_chars"`
	DocTokens       *int       `db:"doc_tokens"`
	ChunkCount      int        `db:"chunk_count"`
	VectorStatus    string     `db:"vector_status"`  // PENDING / RUNNING / SUCCEEDED / FAILED / STALE
	VectorError     *string    `db:"vector_error"`
	VectorProfileID *int64     `db:"vector_profile_id"`
	VectorizedAt    *time.Time `db:"vectorized_at"`
	AttemptCount    int        `db:"attempt_count"`
	ArchivedYear    *int       `db:"archived_year"`
	ArchivedMonth   *int       `db:"archived_month"`
	ArchivedDay     *int       `db:"archived_day"`
	CreatedBy       *int64     `db:"created_by"`
	CreatedAt       time.Time  `db:"created_at"`
	UpdatedAt       time.Time  `db:"updated_at"`
}

// KBEmbedding 对应 kb_embeddings 表。embedding 列由 ai-service 写入，Go 侧通常只
// 用作管理面板的状态/数量查询，不直接读取向量数据。
type KBEmbedding struct {
	ID           int64     `db:"id"`
	KBFileID     int64     `db:"kb_file_id"`
	KBID         int64     `db:"kb_id"`
	ProfileID    int64     `db:"profile_id"`
	ChunkIndex   int       `db:"chunk_index"`
	ChunkText    string    `db:"chunk_text"`
	ParentText   *string   `db:"parent_text"`
	EmbeddingDim int       `db:"embedding_dim"`
	Status       string    `db:"status"`
	TokenCount   *int      `db:"token_count"`
	CreatedAt    time.Time `db:"created_at"`
}

// KB Permission level 常量。
const (
	KBKindCustom      = "CUSTOM"
	KBKindSystemPosts = "SYSTEM_POSTS"

	KBPermissionView   = "VIEW"
	KBPermissionUse    = "USE"
	KBPermissionEdit   = "EDIT"
	KBPermissionManage = "MANAGE"

	KBPrincipalUser = "USER"
	KBPrincipalTeam = "TEAM"
	KBPrincipalRole = "ROLE"

	KBVectorStatusPending   = "PENDING"
	KBVectorStatusRunning   = "RUNNING"
	KBVectorStatusSucceeded = "SUCCEEDED"
	KBVectorStatusFailed    = "FAILED"
	KBVectorStatusStale     = "STALE"

	KBProfileStatusActive     = "active"
	KBProfileStatusShadow     = "shadow"
	KBProfileStatusDeprecated = "deprecated"
)
