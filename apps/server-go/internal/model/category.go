package model

import "time"

// Category 对应数据库 `categories` 表，表示博客文章的分类目录。
// 支持通过 ParentID 构建多级父子分类结构。
type Category struct {
	ID          int64      `db:"id"`           // 分类主键 ID
	Name        string     `db:"name"`         // 分类显示名称
	Slug        string     `db:"slug"`         // URL 友好的唯一标识符
	Description *string    `db:"description"`  // 分类描述，可为空
	CoverImage  *string    `db:"cover_image"`  // 分类封面图片 URL，可为空
	Icon        *string    `db:"icon"`         // 分类图标标识符或 emoji，可为空
	ParentID    *int64     `db:"parent_id"`    // 父分类 ID，nil 表示顶级分类
	SortOrder   int        `db:"sort_order"`   // 显示排序权重，值越小越靠前
	PostCount   int        `db:"post_count"`   // 该分类下的文章数量（缓存值）
	CreatedAt   time.Time  `db:"created_at"`   // 记录创建时间
	UpdatedAt   time.Time  `db:"updated_at"`   // 记录最后更新时间
}
