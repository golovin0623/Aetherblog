package model

import "time"

// SiteSetting 对应数据库 `site_settings` 表，以键值对形式存储站点全局配置项。
// 配置项按分组（GroupName）归类，管理后台可在不修改代码的情况下动态调整站点选项。
type SiteSetting struct {
	ID           int64     `db:"id"`
	SettingKey   string    `db:"setting_key"`   // 唯一的点分隔配置键（如 "site.title"）
	SettingValue *string   `db:"setting_value"` // 以字符串形式存储的配置值；实际含义由 SettingType 决定
	SettingType  string    `db:"setting_type"`  // 值类型提示：STRING | NUMBER | BOOLEAN | JSON | TEXT
	GroupName    string    `db:"group_name"`    // UI 展示用的逻辑分组名（如 "basic"、"seo"）
	Description  *string   `db:"description"`   // 管理面板中展示的人类可读说明，可为空
	CreatedAt    time.Time `db:"created_at"`    // 记录创建时间
	UpdatedAt    time.Time `db:"updated_at"`    // 记录最后更新时间
}
