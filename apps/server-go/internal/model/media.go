package model

import "time"

// MediaFile maps the `media_files` table. It represents a single uploaded file
// stored either locally or in an external object-storage provider.
type MediaFile struct {
	ID                int64      `db:"id"`
	Filename          string     `db:"filename"`           // Storage key / file name on disk or in the bucket
	OriginalName      string     `db:"original_name"`      // Original file name from the client's upload
	FilePath          string     `db:"file_path"`          // Relative path within the storage root
	FileURL           string     `db:"file_url"`           // Public access URL
	FileSize          int64      `db:"file_size"`          // File size in bytes
	MimeType          *string    `db:"mime_type"`          // MIME type detected on upload (e.g. "image/jpeg")
	FileType          string     `db:"file_type"`          // Broad category: image | video | audio | document | other
	StorageType       string     `db:"storage_type"`       // Backend type: local | s3 | oss | cos
	Width             *int       `db:"width"`              // Image width in pixels; nil for non-image files
	Height            *int       `db:"height"`             // Image height in pixels; nil for non-image files
	AltText           *string    `db:"alt_text"`           // Accessibility alt text for images
	UploaderID        *int64     `db:"uploader_id"`        // Foreign key to users; nil when uploaded anonymously
	FolderID          *int64     `db:"folder_id"`          // Foreign key to media_folders; nil = root folder
	StorageProviderID *int64     `db:"storage_provider_id"` // Foreign key to storage_providers; nil = local default
	CdnURL            *string    `db:"cdn_url"`            // CDN-accelerated URL when a CDN is configured
	Blurhash          *string    `db:"blurhash"`           // BlurHash placeholder string for progressive image loading
	CurrentVersion    int        `db:"current_version"`    // Latest version number; incremented on each content replacement
	IsArchived        bool       `db:"is_archived"`        // Archived files are hidden but not deleted
	ArchivedAt        *time.Time `db:"archived_at"`
	ArchivedBy        *int64     `db:"archived_by"`
	Deleted           bool       `db:"deleted"`            // Soft-delete flag; files in the trash
	DeletedAt         *time.Time `db:"deleted_at"`
	CreatedAt         *time.Time `db:"created_at"`
}

// MediaFolder maps the `media_folders` table. Folders provide a hierarchical
// organisation layer for media files using a materialised path pattern.
type MediaFolder struct {
	ID          int64      `db:"id"`
	Name        string     `db:"name"`
	Slug        string     `db:"slug"`          // URL-friendly folder identifier
	Description *string    `db:"description"`
	ParentID    *int64     `db:"parent_id"`     // Parent folder ID; nil = root-level folder
	Path        string     `db:"path"`          // Materialised path (e.g. "/root/photos/2024/")
	Depth       int        `db:"depth"`         // Nesting depth; 0 = root
	SortOrder   int        `db:"sort_order"`
	Color       *string    `db:"color"`         // Hex colour for folder icon in the UI
	Icon        *string    `db:"icon"`          // Icon identifier or emoji
	CoverImage  *string    `db:"cover_image"`   // Cover image URL for gallery display
	OwnerID     *int64     `db:"owner_id"`      // User who owns this folder; nil = system folder
	Visibility  string     `db:"visibility"`    // Access control: public | private | shared
	FileCount   int        `db:"file_count"`    // Cached count of files directly in this folder
	TotalSize   int64      `db:"total_size"`    // Cached total byte size of all files in this folder
	CreatedBy   *int64     `db:"created_by"`
	UpdatedBy   *int64     `db:"updated_by"`
	CreatedAt   *time.Time `db:"created_at"`
	UpdatedAt   *time.Time `db:"updated_at"`
}

// StorageProvider maps the `storage_providers` table. Each row represents a
// configured cloud/object-storage backend that files can be uploaded to.
type StorageProvider struct {
	ID           int64      `db:"id"`
	Name         string     `db:"name"`          // Human-readable provider name
	ProviderType string     `db:"provider_type"` // Driver type: local | s3 | oss | cos | r2
	ConfigJSON   string     `db:"config_json"`   // Provider-specific config serialised as JSON (credentials, bucket, region, etc.)
	IsDefault    bool       `db:"is_default"`    // True for the provider used when no provider is explicitly specified
	IsEnabled    bool       `db:"is_enabled"`
	Priority     int        `db:"priority"`      // Ordering priority; higher value = preferred when multiple providers are available
	CreatedAt    *time.Time `db:"created_at"`
	UpdatedAt    *time.Time `db:"updated_at"`
}
