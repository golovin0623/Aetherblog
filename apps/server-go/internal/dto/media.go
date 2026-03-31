package dto

import "time"

// MediaFileVO 是媒体文件信息的响应视图对象（View Object）。
type MediaFileVO struct {
	ID           int64      `json:"id"`                    // 媒体文件唯一 ID
	Filename     string     `json:"filename"`              // 系统存储文件名（经过处理，可能与原始名称不同）
	OriginalName string     `json:"originalName"`          // 上传时的原始文件名
	FileURL      string     `json:"fileUrl"`               // 文件可访问的完整 URL
	FileSize     int64      `json:"fileSize"`              // 文件大小（字节）
	MimeType     *string    `json:"mimeType,omitempty"`    // 文件 MIME 类型（如 image/jpeg，可为空）
	FileType     string     `json:"fileType"`              // 文件类型分类（如 IMAGE/VIDEO/AUDIO/DOCUMENT/OTHER）
	StorageType  string     `json:"storageType"`           // 存储类型（如 LOCAL/S3/MINIO/OSS/COS）
	Width        *int       `json:"width,omitempty"`       // 图片宽度（像素，非图片类型为空）
	Height       *int       `json:"height,omitempty"`      // 图片高度（像素，非图片类型为空）
	AltText      *string    `json:"altText,omitempty"`     // 图片 alt 替代文字（可为空）
	FolderID     *int64     `json:"folderId,omitempty"`    // 所属文件夹 ID（可为空，表示根目录）
	Deleted      bool       `json:"deleted"`               // 是否已软删除
	CreatedAt    *time.Time `json:"createdAt"`             // 上传时间
}

// UpdateMediaRequest 是更新媒体文件元数据的请求体 DTO。
type UpdateMediaRequest struct {
	AltText      *string `json:"altText"`      // 图片 alt 替代文字（可选）
	OriginalName *string `json:"originalName"` // 文件显示名称（可选）
	FolderID     *int64  `json:"folderId"`     // 所属文件夹 ID（可选，设为 null 表示移至根目录）
}

// BatchMoveRequest 是批量移动媒体文件到指定文件夹的请求体 DTO。
type BatchMoveRequest struct {
	IDs      []int64 `json:"ids"      validate:"required,min=1"` // 需要移动的文件 ID 列表（必填，至少 1 个）
	FolderID *int64  `json:"folderId"`                           // 目标文件夹 ID（为 null 表示移至根目录）
}

// BatchIDsRequest 是通用批量操作（如批量删除）的请求体 DTO。
type BatchIDsRequest struct {
	IDs []int64 `json:"ids" validate:"required,min=1"` // 需要批量操作的资源 ID 列表（必填，至少 1 个）
}

// MediaStatsVO 是媒体库统计信息的响应视图对象。
type MediaStatsVO struct {
	TotalFiles    int64 `json:"totalFiles"`    // 文件总数量
	TotalSize     int64 `json:"totalSize"`     // 文件总占用空间（字节）
	ImageCount    int64 `json:"imageCount"`    // 图片文件数量
	VideoCount    int64 `json:"videoCount"`    // 视频文件数量
	AudioCount    int64 `json:"audioCount"`    // 音频文件数量
	DocumentCount int64 `json:"documentCount"` // 文档文件数量
	OtherCount    int64 `json:"otherCount"`    // 其他类型文件数量
}

// MediaFolderVO 是媒体文件夹信息的响应视图对象（View Object）。
type MediaFolderVO struct {
	ID          int64           `json:"id"`                   // 文件夹唯一 ID
	Name        string          `json:"name"`                 // 文件夹名称
	Slug        string          `json:"slug"`                 // URL 别名
	Description *string         `json:"description,omitempty"` // 文件夹描述（可为空）
	ParentID    *int64          `json:"parentId,omitempty"`   // 父文件夹 ID（根目录为空）
	Path        string          `json:"path"`                 // 文件夹完整路径（如 /images/2024）
	Depth       int             `json:"depth"`                // 文件夹层级深度（根目录为 0）
	Color       *string         `json:"color,omitempty"`      // 文件夹标记颜色（可为空）
	Icon        *string         `json:"icon,omitempty"`       // 文件夹图标（可为空）
	Visibility  string          `json:"visibility"`           // 可见性（PRIVATE/TEAM/PUBLIC）
	FileCount   int             `json:"fileCount"`            // 文件夹内的文件数量
	TotalSize   int64           `json:"totalSize"`            // 文件夹内所有文件的总大小（字节）
	CreatedAt   *time.Time      `json:"createdAt"`            // 创建时间
	Children    []MediaFolderVO `json:"children,omitempty"`   // 子文件夹列表（树形结构时返回）
}

// FolderRequest 是创建或更新媒体文件夹的请求体 DTO。
type FolderRequest struct {
	Name        string  `json:"name"        validate:"required,max=100"`                   // 文件夹名称，最多 100 个字符（必填）
	Description *string `json:"description"`                                               // 文件夹描述（可选）
	ParentID    *int64  `json:"parentId"`                                                  // 父文件夹 ID（可选，为空则创建在根目录）
	Color       *string `json:"color"`                                                     // 文件夹标记颜色（可选）
	Icon        *string `json:"icon"`                                                      // 文件夹图标（可选）
	Visibility  string  `json:"visibility"  validate:"omitempty,oneof=PRIVATE TEAM PUBLIC"` // 可见性（可选，枚举值：PRIVATE/TEAM/PUBLIC）
}

// MoveFolderRequest 是移动文件夹到新父目录的请求体 DTO。
type MoveFolderRequest struct {
	TargetParentID *int64 `json:"targetParentId"` // 目标父文件夹 ID（优先使用此字段）
	ParentID       *int64 `json:"parentId"`        // 兼容字段，当 TargetParentID 为空时使用
}

// GetTargetParentID 返回目标父文件夹 ID：优先返回 TargetParentID，
// 若未设置则回退到 ParentID。
func (r *MoveFolderRequest) GetTargetParentID() *int64 {
	if r.TargetParentID != nil {
		return r.TargetParentID
	}
	return r.ParentID
}

// StorageProviderVO 是存储提供商配置信息的响应视图对象（View Object）。
type StorageProviderVO struct {
	ID           int64      `json:"id"`           // 存储提供商唯一 ID
	Name         string     `json:"name"`         // 存储提供商显示名称
	ProviderType string     `json:"providerType"` // 提供商类型（LOCAL/S3/MINIO/OSS/COS）
	ConfigJSON   string     `json:"configJson"`   // 提供商配置的 JSON 字符串
	IsDefault    bool       `json:"isDefault"`    // 是否为默认存储提供商
	IsEnabled    bool       `json:"isEnabled"`    // 是否启用
	Priority     int        `json:"priority"`     // 优先级，数值越小优先级越高
	CreatedAt    *time.Time `json:"createdAt"`    // 创建时间
}

// StorageProviderRequest 是创建或更新存储提供商配置的请求体 DTO。
type StorageProviderRequest struct {
	Name         string `json:"name"         validate:"required,max=100"`                         // 存储提供商名称，最多 100 个字符（必填）
	ProviderType string `json:"providerType" validate:"required,oneof=LOCAL S3 MINIO OSS COS"` // 提供商类型（必填，枚举值：LOCAL/S3/MINIO/OSS/COS）
	ConfigJSON   string `json:"configJson"   validate:"required"`                              // 提供商配置的 JSON 字符串（必填）
	IsEnabled    bool   `json:"isEnabled"`                                                     // 是否启用
	Priority     int    `json:"priority"`                                                      // 优先级
}

// --- 媒体标签 ---

// MediaTagVO 是媒体标签信息的响应视图对象（View Object）。
type MediaTagVO struct {
	ID          int64      `json:"id"`                    // 媒体标签唯一 ID
	Name        string     `json:"name"`                  // 标签名称
	Slug        string     `json:"slug"`                  // URL 别名
	Description *string    `json:"description,omitempty"` // 标签描述（可为空）
	Color       string     `json:"color"`                 // 标签颜色
	Category    string     `json:"category"`              // 标签所属分类
	UsageCount  int        `json:"usageCount"`            // 该标签被使用的文件数量
	CreatedAt   *time.Time `json:"createdAt"`             // 创建时间
	UpdatedAt   *time.Time `json:"updatedAt"`             // 最后更新时间
}

// CreateMediaTagRequest 是创建媒体标签的请求体 DTO。
type CreateMediaTagRequest struct {
	Name        string  `json:"name"        validate:"required,max=50"` // 标签名称，最多 50 个字符（必填）
	Description *string `json:"description"`                             // 标签描述（可选）
	Color       *string `json:"color"`                                   // 标签颜色（可选）
	Category    *string `json:"category"`                                // 标签所属分类（可选）
}

// TagFileRequest 是为单个媒体文件设置标签的请求体 DTO。
type TagFileRequest struct {
	TagIDs []int64 `json:"tagIds" validate:"required,min=1"` // 需要关联的媒体标签 ID 列表（必填，至少 1 个）
}

// BatchTagRequest 是批量为多个媒体文件添加同一标签的请求体 DTO。
type BatchTagRequest struct {
	FileIDs []int64 `json:"fileIds" validate:"required,min=1"` // 需要操作的媒体文件 ID 列表（必填，至少 1 个）
	TagID   int64   `json:"tagId"   validate:"required"`        // 需要关联的媒体标签 ID（必填）
}

// --- 文件夹权限 ---

// FolderPermissionVO 是文件夹权限信息的响应视图对象（View Object）。
type FolderPermissionVO struct {
	ID              int64      `json:"id"`                      // 权限记录唯一 ID
	FolderID        int64      `json:"folderId"`                // 所属文件夹 ID
	UserID          int64      `json:"userId"`                  // 被授权的用户 ID
	PermissionLevel string     `json:"permissionLevel"`         // 权限级别（VIEW/UPLOAD/EDIT/DELETE/ADMIN）
	GrantedBy       *int64     `json:"grantedBy,omitempty"`     // 授权操作者的用户 ID（可为空）
	GrantedAt       *time.Time `json:"grantedAt"`               // 授权时间
	ExpiresAt       *time.Time `json:"expiresAt,omitempty"`     // 权限过期时间（可为空，表示永不过期）
}

// GrantPermissionRequest 是为用户授予文件夹权限的请求体 DTO。
type GrantPermissionRequest struct {
	UserID          int64   `json:"userId"          validate:"required"`                               // 被授权的用户 ID（必填）
	PermissionLevel string  `json:"permissionLevel" validate:"required,oneof=VIEW UPLOAD EDIT DELETE ADMIN"` // 权限级别（必填，枚举值：VIEW/UPLOAD/EDIT/DELETE/ADMIN）
	ExpiresAt       *string `json:"expiresAt"`                                                         // 权限过期时间，RFC3339 格式字符串（可选，为空表示永不过期）
}

// UpdatePermissionRequest 是更新用户文件夹权限的请求体 DTO。
type UpdatePermissionRequest struct {
	PermissionLevel string  `json:"permissionLevel" validate:"required,oneof=VIEW UPLOAD EDIT DELETE ADMIN"` // 新的权限级别（必填，枚举值：VIEW/UPLOAD/EDIT/DELETE/ADMIN）
	ExpiresAt       *string `json:"expiresAt"`                                                               // 权限过期时间，RFC3339 格式字符串（可选，为空表示永不过期）
}

// --- 媒体分享 ---

// MediaShareVO 是媒体文件或文件夹分享信息的响应视图对象（View Object）。
type MediaShareVO struct {
	ID             int64      `json:"id"`                        // 分享记录唯一 ID
	ShareToken     string     `json:"shareToken"`                // 分享令牌，用于构造分享链接
	ShareURL       string     `json:"shareUrl"`                  // 完整的分享访问 URL
	MediaFileID    *int64     `json:"mediaFileId,omitempty"`     // 被分享的媒体文件 ID（文件分享时有值）
	FolderID       *int64     `json:"folderId,omitempty"`        // 被分享的文件夹 ID（文件夹分享时有值）
	ShareType      string     `json:"shareType"`                 // 分享类型（FILE/FOLDER）
	AccessType     string     `json:"accessType"`                // 访问权限类型（VIEW/DOWNLOAD）
	CreatedBy      *int64     `json:"createdBy,omitempty"`       // 创建分享的用户 ID（可为空）
	CreatedAt      *time.Time `json:"createdAt"`                 // 分享创建时间
	ExpiresAt      *time.Time `json:"expiresAt,omitempty"`       // 分享过期时间（可为空，表示永不过期）
	AccessCount    int        `json:"accessCount"`               // 当前已访问次数
	MaxAccessCount *int       `json:"maxAccessCount,omitempty"`  // 最大访问次数限制（可为空，表示不限次数）
}

// CreateShareRequest 是创建媒体分享链接的请求体 DTO。
type CreateShareRequest struct {
	AccessType     string  `json:"accessType"     validate:"required,oneof=VIEW DOWNLOAD"` // 访问权限类型（必填，VIEW 仅预览 / DOWNLOAD 允许下载）
	Password       *string `json:"password"`                                               // 分享密码（可选，设置后访问需验证）
	ExpiresAt      *string `json:"expiresAt"`                                              // 过期时间，RFC3339 格式字符串（可选）
	MaxAccessCount *int    `json:"maxAccessCount"`                                         // 最大访问次数（可选，超出后链接失效）
}

// UpdateShareRequest 是更新媒体分享链接配置的请求体 DTO，所有字段均为可选。
type UpdateShareRequest struct {
	AccessType     *string `json:"accessType"     validate:"omitempty,oneof=VIEW DOWNLOAD"` // 访问权限类型（可选）
	Password       *string `json:"password"`                                                 // 分享密码（可选）
	ExpiresAt      *string `json:"expiresAt"`                                                // 过期时间，RFC3339 格式字符串（可选）
	MaxAccessCount *int    `json:"maxAccessCount"`                                           // 最大访问次数（可选）
}

// --- 媒体版本 ---

// MediaVersionVO 是媒体文件历史版本信息的响应视图对象（View Object）。
type MediaVersionVO struct {
	ID                int64      `json:"id"`                              // 版本记录唯一 ID
	MediaFileID       int64      `json:"mediaFileId"`                     // 所属媒体文件 ID
	VersionNumber     int        `json:"versionNumber"`                   // 版本号（从 1 开始递增）
	FilePath          string     `json:"filePath"`                        // 该版本文件在存储中的路径
	FileURL           string     `json:"fileUrl"`                         // 该版本文件的访问 URL
	FileSize          int64      `json:"fileSize"`                        // 该版本文件大小（字节）
	ChangeDescription *string    `json:"changeDescription,omitempty"`     // 版本变更说明（可为空）
	CreatedBy         *int64     `json:"createdBy,omitempty"`             // 上传该版本的用户 ID（可为空）
	CreatedAt         *time.Time `json:"createdAt"`                       // 版本创建时间
}
