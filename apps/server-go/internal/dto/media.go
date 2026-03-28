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
	AltText  *string `json:"altText"`
	FolderID *int64  `json:"folderId"`
}

type BatchMoveRequest struct {
	IDs      []int64 `json:"ids"      validate:"required,min=1"`
	FolderID *int64  `json:"folderId"`
}

type BatchIDsRequest struct {
	IDs []int64 `json:"ids" validate:"required,min=1"`
}

type MediaStatsVO struct {
	TotalCount int64 `json:"totalCount"`
	TotalSize  int64 `json:"totalSize"`
	ImageCount int64 `json:"imageCount"`
	VideoCount int64 `json:"videoCount"`
	AudioCount int64 `json:"audioCount"`
	DocCount   int64 `json:"docCount"`
	OtherCount int64 `json:"otherCount"`
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
	ParentID *int64 `json:"parentId"`
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
