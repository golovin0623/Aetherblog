package model

import "time"

// FriendLink 对应数据库 `friend_links` 表，表示博客友情链接/站点导航中的一个外部站点。
// 友情链接展示在博客的链接页面（Blogroll），支持可用性自动检测。
type FriendLink struct {
	ID          int64      `db:"id"`
	Name        string     `db:"name"`          // 站点名称，展示在 UI 中
	URL         string     `db:"url"`           // 链接站点的首页 URL
	Logo        *string    `db:"logo"`          // 站点 Logo 图片 URL；nil 表示无 Logo
	Description *string    `db:"description"`   // 链接站点的简短描述，可为空
	Email       *string    `db:"email"`         // 站点所有者的联系邮箱（不对外公开展示），可为空
	RSSUrl      *string    `db:"rss_url"`       // RSS/Atom 订阅源 URL，用于可用性健康检测，可为空
	ThemeColor  *string    `db:"theme_color"`   // 品牌主题色（十六进制），用于卡片样式，可为空
	IsOnline    *bool      `db:"is_online"`     // 最近一次可用性检测结果；nil 表示尚未检测
	LastCheckAt *time.Time `db:"last_check_at"` // 最近一次可用性检测的时间戳，可为空
	SortOrder   int        `db:"sort_order"`    // 显示排序权重，值越小越靠前
	Visible     bool       `db:"visible"`       // 是否在公开页面展示；false 时对访客隐藏
	CreatedAt   time.Time  `db:"created_at"`    // 记录创建时间
	UpdatedAt   time.Time  `db:"updated_at"`    // 记录最后更新时间
}
