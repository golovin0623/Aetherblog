package model

import "time"

// SiteSetting maps the `site_settings` table.
type SiteSetting struct {
	ID           int64     `db:"id"`
	SettingKey   string    `db:"setting_key"`
	SettingValue *string   `db:"setting_value"`
	SettingType  string    `db:"setting_type"` // STRING | NUMBER | BOOLEAN | JSON | TEXT
	GroupName    string    `db:"group_name"`
	Description  *string   `db:"description"`
	CreatedAt    time.Time `db:"created_at"`
	UpdatedAt    time.Time `db:"updated_at"`
}
