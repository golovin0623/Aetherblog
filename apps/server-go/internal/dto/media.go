package dto

import "time"

// MediaFileVO is the response for a media file.
type MediaFileVO struct {
	ID           int64      `json:"id"`
	Filename     string     `json:"filename"`
	OriginalName string     `json:"originalName"`
	FileURL      string     `json:"fileUrl"`
	FileSize     int64      `json:"fileSize"`
	MimeType     *string    `json:"mimeType,omitempty"`
	FileType     string     `json:"fileType"`
	StorageType  string     `json:"storageType"`
	Width        *int       `json:"width,omitempty"`
	Height       *int       `json:"height,omitempty"`
	AltText      *string    `json:"altText,omitempty"`
	FolderID     *int64     `json:"folderId,omitempty"`
	Deleted      bool       `json:"deleted"`
	CreatedAt    *time.Time `json:"createdAt"`
}

type UpdateMediaRequest struct {
	AltText      *string `json:"altText"`
	OriginalName *string `json:"originalName"`
	FolderID     *int64  `json:"folderId"`
}

type BatchMoveRequest struct {
	IDs      []int64 `json:"ids"      validate:"required,min=1"`
	FolderID *int64  `json:"folderId"`
}

type BatchIDsRequest struct {
	IDs []int64 `json:"ids" validate:"required,min=1"`
}

type MediaStatsVO struct {
	TotalFiles    int64 `json:"totalFiles"`
	TotalSize     int64 `json:"totalSize"`
	ImageCount    int64 `json:"imageCount"`
	VideoCount    int64 `json:"videoCount"`
	AudioCount    int64 `json:"audioCount"`
	DocumentCount int64 `json:"documentCount"`
	OtherCount    int64 `json:"otherCount"`
}

// MediaFolderVO is the response for a folder.
type MediaFolderVO struct {
	ID          int64           `json:"id"`
	Name        string          `json:"name"`
	Slug        string          `json:"slug"`
	Description *string         `json:"description,omitempty"`
	ParentID    *int64          `json:"parentId,omitempty"`
	Path        string          `json:"path"`
	Depth       int             `json:"depth"`
	Color       *string         `json:"color,omitempty"`
	Icon        *string         `json:"icon,omitempty"`
	Visibility  string          `json:"visibility"`
	FileCount   int             `json:"fileCount"`
	TotalSize   int64           `json:"totalSize"`
	CreatedAt   *time.Time      `json:"createdAt"`
	Children    []MediaFolderVO `json:"children,omitempty"`
}

type FolderRequest struct {
	Name        string  `json:"name"        validate:"required,max=100"`
	Description *string `json:"description"`
	ParentID    *int64  `json:"parentId"`
	Color       *string `json:"color"`
	Icon        *string `json:"icon"`
	Visibility  string  `json:"visibility"  validate:"omitempty,oneof=PRIVATE TEAM PUBLIC"`
}

type MoveFolderRequest struct {
	TargetParentID *int64 `json:"targetParentId"`
	ParentID       *int64 `json:"parentId"` // fallback
}

// GetTargetParentID returns targetParentId if set, otherwise parentId.
func (r *MoveFolderRequest) GetTargetParentID() *int64 {
	if r.TargetParentID != nil {
		return r.TargetParentID
	}
	return r.ParentID
}

// StorageProviderVO is the response for a storage provider.
type StorageProviderVO struct {
	ID           int64      `json:"id"`
	Name         string     `json:"name"`
	ProviderType string     `json:"providerType"`
	ConfigJSON   string     `json:"configJson"`
	IsDefault    bool       `json:"isDefault"`
	IsEnabled    bool       `json:"isEnabled"`
	Priority     int        `json:"priority"`
	CreatedAt    *time.Time `json:"createdAt"`
}

type StorageProviderRequest struct {
	Name         string `json:"name"         validate:"required,max=100"`
	ProviderType string `json:"providerType" validate:"required,oneof=LOCAL S3 MINIO OSS COS"`
	ConfigJSON   string `json:"configJson"   validate:"required"`
	IsEnabled    bool   `json:"isEnabled"`
	Priority     int    `json:"priority"`
}

// --- Media Tags ---

type MediaTagVO struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	Slug        string     `json:"slug"`
	Description *string    `json:"description,omitempty"`
	Color       string     `json:"color"`
	Category    string     `json:"category"`
	UsageCount  int        `json:"usageCount"`
	CreatedAt   *time.Time `json:"createdAt"`
	UpdatedAt   *time.Time `json:"updatedAt"`
}

type CreateMediaTagRequest struct {
	Name        string  `json:"name"        validate:"required,max=50"`
	Description *string `json:"description"`
	Color       *string `json:"color"`
	Category    *string `json:"category"`
}

type TagFileRequest struct {
	TagIDs []int64 `json:"tagIds" validate:"required,min=1"`
}

type BatchTagRequest struct {
	FileIDs []int64 `json:"fileIds" validate:"required,min=1"`
	TagID   int64   `json:"tagId"   validate:"required"`
}

// --- Folder Permissions ---

type FolderPermissionVO struct {
	ID              int64      `json:"id"`
	FolderID        int64      `json:"folderId"`
	UserID          int64      `json:"userId"`
	PermissionLevel string     `json:"permissionLevel"`
	GrantedBy       *int64     `json:"grantedBy,omitempty"`
	GrantedAt       *time.Time `json:"grantedAt"`
	ExpiresAt       *time.Time `json:"expiresAt,omitempty"`
}

type GrantPermissionRequest struct {
	UserID          int64   `json:"userId"          validate:"required"`
	PermissionLevel string  `json:"permissionLevel" validate:"required,oneof=VIEW UPLOAD EDIT DELETE ADMIN"`
	ExpiresAt       *string `json:"expiresAt"`
}

type UpdatePermissionRequest struct {
	PermissionLevel string  `json:"permissionLevel" validate:"required,oneof=VIEW UPLOAD EDIT DELETE ADMIN"`
	ExpiresAt       *string `json:"expiresAt"`
}

// --- Media Shares ---

type MediaShareVO struct {
	ID             int64      `json:"id"`
	ShareToken     string     `json:"shareToken"`
	ShareURL       string     `json:"shareUrl"`
	MediaFileID    *int64     `json:"mediaFileId,omitempty"`
	FolderID       *int64     `json:"folderId,omitempty"`
	ShareType      string     `json:"shareType"`
	AccessType     string     `json:"accessType"`
	CreatedBy      *int64     `json:"createdBy,omitempty"`
	CreatedAt      *time.Time `json:"createdAt"`
	ExpiresAt      *time.Time `json:"expiresAt,omitempty"`
	AccessCount    int        `json:"accessCount"`
	MaxAccessCount *int       `json:"maxAccessCount,omitempty"`
}

type CreateShareRequest struct {
	AccessType     string  `json:"accessType"     validate:"required,oneof=VIEW DOWNLOAD"`
	Password       *string `json:"password"`
	ExpiresAt      *string `json:"expiresAt"`
	MaxAccessCount *int    `json:"maxAccessCount"`
}

type UpdateShareRequest struct {
	AccessType     *string `json:"accessType"     validate:"omitempty,oneof=VIEW DOWNLOAD"`
	Password       *string `json:"password"`
	ExpiresAt      *string `json:"expiresAt"`
	MaxAccessCount *int    `json:"maxAccessCount"`
}

// --- Media Versions ---

type MediaVersionVO struct {
	ID                int64      `json:"id"`
	MediaFileID       int64      `json:"mediaFileId"`
	VersionNumber     int        `json:"versionNumber"`
	FilePath          string     `json:"filePath"`
	FileURL           string     `json:"fileUrl"`
	FileSize          int64      `json:"fileSize"`
	ChangeDescription *string    `json:"changeDescription,omitempty"`
	CreatedBy         *int64     `json:"createdBy,omitempty"`
	CreatedAt         *time.Time `json:"createdAt"`
}
