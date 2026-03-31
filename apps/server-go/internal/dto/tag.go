package dto

import "time"

// TagRequest 是创建或更新标签接口的请求体 DTO。
type TagRequest struct {
	Name        string  `json:"name"        validate:"required,max=50"` // 标签名称，最多 50 个字符（必填）
	Slug        string  `json:"slug"        validate:"omitempty,max=50"` // URL 别名，最多 50 个字符（可选，留空则自动生成）
	Description *string `json:"description"`                             // 标签描述（可选）
	Color       string  `json:"color"`                                   // 标签颜色，十六进制颜色值（如 #3B82F6）
}

// TagVO 是标签信息的响应视图对象（View Object）。
type TagVO struct {
	ID          int64     `json:"id"`          // 标签唯一 ID
	Name        string    `json:"name"`        // 标签名称
	Slug        string    `json:"slug"`        // URL 别名
	Description *string   `json:"description"` // 标签描述（可为空）
	Color       string    `json:"color"`       // 标签颜色
	PostCount   int       `json:"postCount"`   // 使用该标签的文章数量
	CreatedAt   time.Time `json:"createdAt"`   // 创建时间
	UpdatedAt   time.Time `json:"updatedAt"`   // 最后更新时间
}
