package model

import "time"

// MediaFile 对应数据库 `media_files` 表，表示一个已上传的文件，
// 该文件存储在本地磁盘或外部对象存储服务中。
type MediaFile struct {
	ID                int64      `db:"id"`
	Filename          string     `db:"filename"`            // 存储键/磁盘或存储桶中的文件名
	OriginalName      string     `db:"original_name"`       // 客户端上传时的原始文件名
	FilePath          string     `db:"file_path"`           // 相对于存储根目录的文件路径
	FileURL           string     `db:"file_url"`            // 文件的公开访问 URL
	FileSize          int64      `db:"file_size"`           // 文件大小（字节）
	MimeType          *string    `db:"mime_type"`           // 上传时检测到的 MIME 类型（如 "image/jpeg"），可为空
	FileType          string     `db:"file_type"`           // 文件大类：image | video | audio | document | other
	StorageType       string     `db:"storage_type"`        // 存储后端类型：local | s3 | oss | cos
	Width             *int       `db:"width"`               // 图片宽度（像素）；非图片文件为 nil
	Height            *int       `db:"height"`              // 图片高度（像素）；非图片文件为 nil
	AltText           *string    `db:"alt_text"`            // 图片无障碍 alt 描述文本，可为空
	UploaderID        *int64     `db:"uploader_id"`         // 上传者用户 ID（外键）；nil 表示匿名上传
	FolderID          *int64     `db:"folder_id"`           // 所属媒体文件夹 ID（外键）；nil 表示根目录
	StorageProviderID *int64     `db:"storage_provider_id"` // 存储提供商 ID（外键）；nil 表示使用本地默认
	CdnURL            *string    `db:"cdn_url"`             // 配置了 CDN 时的加速访问 URL，可为空
	Blurhash          *string    `db:"blurhash"`            // 用于渐进式图片加载的 BlurHash 占位字符串，可为空
	CurrentVersion    int        `db:"current_version"`     // 当前版本号；每次替换文件内容时递增
	IsArchived        bool       `db:"is_archived"`         // 是否已归档；归档文件隐藏但不删除
	ArchivedAt        *time.Time `db:"archived_at"`         // 归档时间，可为空
	ArchivedBy        *int64     `db:"archived_by"`         // 执行归档操作的用户 ID，可为空
	Deleted           bool       `db:"deleted"`             // 软删除标志；已删除文件进入回收站
	DeletedAt         *time.Time `db:"deleted_at"`          // 软删除时间，可为空
	CreatedAt         *time.Time `db:"created_at"`          // 记录创建时间
}

// MediaFolder 对应数据库 `media_folders` 表，为媒体文件提供层级组织结构。
// 使用物化路径（Materialised Path）模式实现文件夹树形结构。
type MediaFolder struct {
	ID          int64      `db:"id"`
	Name        string     `db:"name"`         // 文件夹显示名称
	Slug        string     `db:"slug"`         // URL 友好的文件夹唯一标识符
	Description *string    `db:"description"`  // 文件夹描述，可为空
	ParentID    *int64     `db:"parent_id"`    // 父文件夹 ID；nil 表示根级文件夹
	Path        string     `db:"path"`         // 物化路径（如 "/root/photos/2024/"）
	Depth       int        `db:"depth"`        // 嵌套深度；0 表示根级
	SortOrder   int        `db:"sort_order"`   // 显示排序权重
	Color       *string    `db:"color"`        // UI 中文件夹图标的十六进制颜色，可为空
	Icon        *string    `db:"icon"`         // 图标标识符或 emoji，可为空
	CoverImage  *string    `db:"cover_image"`  // 相册展示用的封面图片 URL，可为空
	OwnerID     *int64     `db:"owner_id"`     // 文件夹所有者用户 ID；nil 表示系统文件夹
	Visibility  string     `db:"visibility"`   // 访问控制：public（公开）| private（私有）| shared（共享）
	FileCount   int        `db:"file_count"`   // 该文件夹直接包含的文件数量（缓存值）
	TotalSize   int64      `db:"total_size"`   // 该文件夹所有文件的总字节大小（缓存值）
	CreatedBy   *int64     `db:"created_by"`   // 创建者用户 ID，可为空
	UpdatedBy   *int64     `db:"updated_by"`   // 最后更新者用户 ID，可为空
	CreatedAt   *time.Time `db:"created_at"`   // 记录创建时间
	UpdatedAt   *time.Time `db:"updated_at"`   // 记录最后更新时间
}

// StorageProvider 对应数据库 `storage_providers` 表，每条记录代表一个
// 已配置的云/对象存储后端，文件可以上传至该后端。
type StorageProvider struct {
	ID           int64      `db:"id"`
	Name         string     `db:"name"`          // 存储提供商的人类可读名称
	ProviderType string     `db:"provider_type"` // 驱动类型：local | s3 | oss | cos | r2
	ConfigJSON   string     `db:"config_json"`   // 序列化为 JSON 的提供商专属配置（凭证、存储桶、区域等）
	IsDefault    bool       `db:"is_default"`    // 是否为默认存储；未明确指定提供商时使用此项
	IsEnabled    bool       `db:"is_enabled"`    // 是否启用该存储提供商
	Priority     int        `db:"priority"`      // 优先级；值越高在多提供商可用时越优先
	CreatedAt    *time.Time `db:"created_at"`    // 记录创建时间
	UpdatedAt    *time.Time `db:"updated_at"`    // 记录最后更新时间
}
