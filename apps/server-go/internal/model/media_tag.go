package model

import "time"

// MediaTag 对应数据库 `media_tags` 表，表示可附加到媒体文件上的标签。
// 标签支持颜色标记和分类归组，用于媒体库的检索与过滤。
type MediaTag struct {
	ID          int64      `db:"id"`
	Name        string     `db:"name"`        // 标签显示名称
	Slug        string     `db:"slug"`        // URL 友好的唯一标识符
	Description *string    `db:"description"` // 标签描述，可为空
	Color       string     `db:"color"`       // 标签颜色（十六进制），用于 UI 视觉区分
	Category    string     `db:"category"`    // 标签所属分类（如 "content"、"project"）
	UsageCount  int        `db:"usage_count"` // 该标签被使用的文件数量（缓存值）
	CreatedAt   *time.Time `db:"created_at"`  // 记录创建时间
	UpdatedAt   *time.Time `db:"updated_at"`  // 记录最后更新时间
}

// MediaFileTag 对应数据库 `media_file_tags` 关联表，记录媒体文件与标签的多对多关联关系。
type MediaFileTag struct {
	MediaFileID int64      `db:"media_file_id"` // 媒体文件 ID（外键，关联 media_files）
	TagID       int64      `db:"tag_id"`        // 标签 ID（外键，关联 media_tags）
	TaggedAt    *time.Time `db:"tagged_at"`     // 打标签的时间，可为空
	TaggedBy    *int64     `db:"tagged_by"`     // 执行打标签操作的用户 ID，可为空
	Source      string     `db:"source"`        // 标签来源（如 "manual" 手动、"ai" AI 自动打标）
}
