package model

import "time"

// Tag 对应数据库 `tags` 表，表示用于文章分类标注的标签。
// 标签与文章之间为多对多关系，支持颜色标识以便在 UI 中快速区分。
type Tag struct {
	ID          int64     `db:"id"`
	Name        string    `db:"name"`        // 标签显示名称
	Slug        string    `db:"slug"`        // URL 友好的唯一标识符
	Description *string   `db:"description"` // 标签描述，可为空
	Color       string    `db:"color"`       // 标签颜色（十六进制），用于 UI 视觉区分
	PostCount   int       `db:"post_count"`  // 使用该标签的文章数量（缓存值）
	CreatedAt   time.Time `db:"created_at"`  // 记录创建时间
	UpdatedAt   time.Time `db:"updated_at"`  // 记录最后更新时间
}
