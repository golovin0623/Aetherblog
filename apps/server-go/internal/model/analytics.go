package model

import "time"

// VisitRecord 对应数据库 `visit_records` 表，记录一次页面访问行为。
type VisitRecord struct {
	ID          int64      `db:"id"`            // 访问记录主键 ID
	PostID      *int64     `db:"post_id"`       // 所访问的文章 ID，nil 表示访问的是非文章页面
	PageURL     string     `db:"page_url"`      // 被访问页面的完整 URL
	PageTitle   *string    `db:"page_title"`    // 页面标题，可为空
	VisitorHash string     `db:"visitor_hash"`  // 访客指纹哈希，用于去重统计独立访客
	IP          *string    `db:"ip"`            // 访客 IP 地址，可为空
	UserAgent   *string    `db:"user_agent"`    // 访客浏览器 User-Agent 字符串，可为空
	DeviceType  *string    `db:"device_type"`   // 设备类型（如 desktop、mobile、tablet），可为空
	Browser     *string    `db:"browser"`       // 浏览器名称，可为空
	OS          *string    `db:"os"`            // 操作系统名称，可为空
	Referer     *string    `db:"referer"`       // 来源页面 URL（HTTP Referer），可为空
	SessionID   *string    `db:"session_id"`    // 会话标识，用于关联同一会话的多次访问，可为空
	Duration    *int       `db:"duration"`      // 页面停留时长（秒），可为空
	IsBot       bool       `db:"is_bot"`        // 是否为爬虫/机器人流量
	CreatedAt   time.Time  `db:"created_at"`    // 访问发生时间
}

// ActivityEvent 对应数据库 `activity_events` 表，记录系统中发生的各类活动事件。
// 注意：metadata（JSONB 列）已被有意排除在 SELECT 查询之外，以避免 sqlx 扫描问题。
type ActivityEvent struct {
	ID            int64     `db:"id"`              // 事件主键 ID
	EventType     string    `db:"event_type"`      // 事件类型标识（如 "post.publish"、"user.login"）
	EventCategory *string   `db:"event_category"`  // 事件所属分类（如 "content"、"auth"），可为空
	Title         string    `db:"title"`           // 事件标题，用于展示在活动时间线中
	Description   *string   `db:"description"`     // 事件详细描述，可为空
	UserID        *int64    `db:"user_id"`         // 触发该事件的用户 ID，nil 表示系统自动触发
	IP            *string   `db:"ip"`              // 触发事件时的客户端 IP 地址，可为空
	Status        *string   `db:"status"`          // 事件处理状态（如 "success"、"failed"），可为空
	CreatedAt     time.Time `db:"created_at"`      // 事件发生时间
}
