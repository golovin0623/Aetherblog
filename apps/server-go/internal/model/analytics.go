package model

import "time"

// VisitRecord maps the `visit_records` table.
type VisitRecord struct {
	ID           int64      `db:"id"`
	PostID       *int64     `db:"post_id"`
	PageURL      string     `db:"page_url"`
	PageTitle    *string    `db:"page_title"`
	VisitorHash  string     `db:"visitor_hash"`
	IP           *string    `db:"ip"`
	UserAgent    *string    `db:"user_agent"`
	DeviceType   *string    `db:"device_type"`
	Browser      *string    `db:"browser"`
	OS           *string    `db:"os"`
	Referer      *string    `db:"referer"`
	SessionID    *string    `db:"session_id"`
	Duration     *int       `db:"duration"`
	IsBot        bool       `db:"is_bot"`
	CreatedAt    time.Time  `db:"created_at"`
}

// ActivityEvent maps the `activity_events` table.
// metadata (JSONB) is intentionally excluded from SELECT queries to avoid scan issues.
type ActivityEvent struct {
	ID            int64     `db:"id"`
	EventType     string    `db:"event_type"`
	EventCategory *string   `db:"event_category"`
	Title         string    `db:"title"`
	Description   *string   `db:"description"`
	UserID        *int64    `db:"user_id"`
	IP            *string   `db:"ip"`
	Status        *string   `db:"status"`
	CreatedAt     time.Time `db:"created_at"`
}
