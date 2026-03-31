package model

import "time"

// SiteSetting maps the `site_settings` table. Settings are stored as key-value
// pairs grouped by category, allowing the admin dashboard to configure site-wide
// options without code changes.
type SiteSetting struct {
	ID           int64     `db:"id"`
	SettingKey   string    `db:"setting_key"`   // Unique dot-notation key (e.g. "site.title")
	SettingValue *string   `db:"setting_value"` // Stored value as a string; interpretation depends on SettingType
	SettingType  string    `db:"setting_type"`  // Value type hint: STRING | NUMBER | BOOLEAN | JSON | TEXT
	GroupName    string    `db:"group_name"`    // Logical group for UI organisation (e.g. "basic", "seo")
	Description  *string   `db:"description"`   // Human-readable description shown in the admin panel
	CreatedAt    time.Time `db:"created_at"`
	UpdatedAt    time.Time `db:"updated_at"`
}
