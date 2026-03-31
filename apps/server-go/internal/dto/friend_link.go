package dto

import "time"

// FriendLinkRequest 是创建或更新友情链接接口的请求体 DTO。
type FriendLinkRequest struct {
	Name        string  `json:"name"        validate:"required,max=100"` // 友链名称，最多 100 个字符（必填）
	URL         string  `json:"url"         validate:"required,max=500"` // 友链目标 URL，最多 500 个字符（必填）
	Logo        *string `json:"logo"`                                    // 友链网站 Logo 图片 URL（可选）
	Description *string `json:"description"`                             // 友链描述或简介（可选）
	Email       *string `json:"email"`                                   // 友链站长联系邮箱（可选）
	RSSUrl      *string `json:"rssUrl"`                                  // 友链网站的 RSS 订阅地址（可选）
	ThemeColor  *string `json:"themeColor"`                              // 友链主题色，十六进制颜色值（可选）
	IsOnline    *bool   `json:"isOnline"`                                // 友链网站是否在线（可选，由系统自动检测或手动设置）
	SortOrder   int     `json:"sortOrder"`                               // 排序权重，数值越小排序越靠前
	Visible     *bool   `json:"visible"`                                 // 是否在前台显示（可选）
}

// FriendLinkVO 是友情链接信息的响应视图对象（View Object）。
type FriendLinkVO struct {
	ID          int64      `json:"id"`          // 友链唯一 ID
	Name        string     `json:"name"`        // 友链名称
	URL         string     `json:"url"`         // 友链目标 URL
	Logo        *string    `json:"logo"`        // 友链网站 Logo 图片 URL（可为空）
	Description *string    `json:"description"` // 友链描述或简介（可为空）
	Email       *string    `json:"email"`       // 友链站长联系邮箱（可为空）
	RSSUrl      *string    `json:"rssUrl"`      // 友链网站的 RSS 订阅地址（可为空）
	ThemeColor  *string    `json:"themeColor"`  // 友链主题色（可为空）
	IsOnline    *bool      `json:"isOnline"`    // 友链网站是否在线（可为空，未检测时为 nil）
	LastCheckAt *time.Time `json:"lastCheckAt"` // 上次在线状态检测时间（可为空）
	SortOrder   int        `json:"sortOrder"`   // 排序权重
	Visible     bool       `json:"visible"`     // 是否在前台显示
	CreatedAt   time.Time  `json:"createdAt"`   // 创建时间
	UpdatedAt   time.Time  `json:"updatedAt"`   // 最后更新时间
}

// BatchDeleteRequest 是批量删除资源接口的请求体 DTO。
type BatchDeleteRequest struct {
	IDs []int64 `json:"ids" validate:"required,min=1"` // 需要批量删除的资源 ID 列表（必填，至少 1 条）
}

// ReorderRequest 是批量重新排序资源接口的请求体 DTO。
type ReorderRequest struct {
	IDs []int64 `json:"ids" validate:"required"` // 按新顺序排列的资源 ID 列表（必填，顺序即为新的排列顺序）
}
