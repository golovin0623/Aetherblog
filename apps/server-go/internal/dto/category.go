package dto

import "time"

// CategoryRequest 是创建或更新分类接口的请求体 DTO。
type CategoryRequest struct {
	Name        string  `json:"name"        validate:"required,max=100"` // 分类名称，最多 100 个字符（必填）
	Slug        string  `json:"slug"        validate:"omitempty,max=100"` // URL 别名，最多 100 个字符（可选，留空则自动生成）
	Description *string `json:"description"`                              // 分类描述（可选）
	CoverImage  *string `json:"coverImage"`                               // 分类封面图片 URL（可选）
	Icon        *string `json:"icon"`                                     // 分类图标（可选，如 emoji 或图标类名）
	ParentID    *int64  `json:"parentId"`                                 // 父分类 ID，为空则为顶级分类（可选）
	SortOrder   int     `json:"sortOrder"`                                // 排序权重，数值越小排序越靠前
}

// CategoryVO 是分类信息的响应视图对象（View Object）。
type CategoryVO struct {
	ID          int64        `json:"id"`                   // 分类唯一 ID
	Name        string       `json:"name"`                 // 分类名称
	Slug        string       `json:"slug"`                 // URL 别名
	Description *string      `json:"description"`          // 分类描述（可为空）
	CoverImage  *string      `json:"coverImage"`           // 分类封面图片 URL（可为空）
	Icon        *string      `json:"icon"`                 // 分类图标（可为空）
	ParentID    *int64       `json:"parentId"`             // 父分类 ID（顶级分类为空）
	SortOrder   int          `json:"sortOrder"`            // 排序权重
	PostCount   int          `json:"postCount"`            // 该分类下的文章数量
	Children    []CategoryVO `json:"children,omitempty"`  // 子分类列表（树形结构时返回）
	CreatedAt   time.Time    `json:"createdAt"`            // 创建时间
	UpdatedAt   time.Time    `json:"updatedAt"`            // 最后更新时间
}
