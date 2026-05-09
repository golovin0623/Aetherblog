package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
)

// activityColumns 列举 activity_events 表中需要查询的字段，故意排除 JSONB 类型的 metadata 列，
// 以避免反序列化问题。
const activityColumns = `id, event_type, event_category, title, description, user_id, ip, status, created_at`

// ActivityFilter 持有管理端活动记录分页列表的可选过滤条件。
// 任意字段为零值时对应过滤条件不生效。
type ActivityFilter struct {
	// Category 按事件分类过滤（event_category 列, 例如 "post"/"comment"）
	Category string
	// EventType 按精确事件类型过滤（event_type 列, 例如 "post.create"）
	EventType string
	// Status 按状态过滤（INFO/SUCCESS/WARNING/ERROR）
	Status string
	// Search 在 title / description 上做不区分大小写的模糊匹配
	Search string
	// UserID 限定触发用户（>0 时生效）
	UserID int64
	// StartTime / EndTime 限定 created_at 区间（任一为零值时不生效）
	StartTime time.Time
	EndTime   time.Time
	pagination.Params
}

// ActivityRepo 负责对 activity_events 表进行数据访问操作。
type ActivityRepo struct{ db *sqlx.DB }

// NewActivityRepo 创建一个使用给定数据库连接的 ActivityRepo 实例。
func NewActivityRepo(db *sqlx.DB) *ActivityRepo { return &ActivityRepo{db: db} }

// FindRecent 从 activity_events 表中返回最近 N 条活动事件，按创建时间降序排列。
// limit 指定最多返回的记录数。
func (r *ActivityRepo) FindRecent(ctx context.Context, limit int) ([]model.ActivityEvent, error) {
	var rows []model.ActivityEvent
	err := r.db.SelectContext(ctx, &rows,
		fmt.Sprintf(`SELECT %s FROM activity_events ORDER BY created_at DESC LIMIT %d`,
			activityColumns, limit))
	return rows, err
}

// FindForAdmin 从 activity_events 表中返回带可选过滤条件的分页活动事件列表，同时返回符合条件的总记录数。
// 过滤条件来自 ActivityFilter，任一字段为零值时该过滤项不生效。
func (r *ActivityRepo) FindForAdmin(ctx context.Context, f ActivityFilter) ([]model.ActivityEvent, int64, error) {
	where, args := buildActivityWhere(f)

	// 先查符合条件的总数
	var total int64
	countSQL := "SELECT COUNT(*) FROM activity_events" + where
	if err := r.db.GetContext(ctx, &total, countSQL, args...); err != nil {
		return nil, 0, err
	}

	offset := f.Params.Offset()
	listSQL := fmt.Sprintf(
		`SELECT %s FROM activity_events%s ORDER BY created_at DESC LIMIT %d OFFSET %d`,
		activityColumns, where, f.Params.PageSize, offset)
	var rows []model.ActivityEvent
	err := r.db.SelectContext(ctx, &rows, listSQL, args...)
	return rows, total, err
}

// FindByUser 从 activity_events 表中返回指定用户的分页活动事件列表，同时返回该用户的总记录数。
// userID 为目标用户的主键，p 为分页参数。
func (r *ActivityRepo) FindByUser(ctx context.Context, userID int64, p pagination.Params) ([]model.ActivityEvent, int64, error) {
	// 先统计该用户的活动总数
	var total int64
	if err := r.db.GetContext(ctx, &total,
		`SELECT COUNT(*) FROM activity_events WHERE user_id = $1`, userID); err != nil {
		return nil, 0, err
	}

	var rows []model.ActivityEvent
	err := r.db.SelectContext(ctx, &rows,
		fmt.Sprintf(`SELECT %s FROM activity_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT %d OFFSET %d`,
			activityColumns, p.PageSize, p.Offset()),
		userID)
	return rows, total, err
}

// Create 向 activity_events 表插入一条新的活动事件记录，created_at 由数据库 NOW() 自动填充。
func (r *ActivityRepo) Create(ctx context.Context, a *model.ActivityEvent) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO activity_events (event_type, event_category, title, description, user_id, ip, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
		a.EventType, a.EventCategory, a.Title, a.Description, a.UserID, a.IP, a.Status)
	return err
}

// buildActivityWhere 根据 ActivityFilter 动态构建 WHERE 子句及对应的参数列表。
// 任一字段为零值时对应过滤条件不生效；所有过滤为空时返回空字符串和空参数切片。
func buildActivityWhere(f ActivityFilter) (string, []any) {
	clauses := []string{}
	args := []any{}
	n := 1
	// placeholder 追加参数并返回对应的 PostgreSQL 位置占位符（$1, $2, ...）
	placeholder := func(v any) string {
		args = append(args, v)
		s := fmt.Sprintf("$%d", n)
		n++
		return s
	}
	if f.Category != "" {
		clauses = append(clauses, "event_category = "+placeholder(f.Category))
	}
	if f.EventType != "" {
		clauses = append(clauses, "event_type = "+placeholder(f.EventType))
	}
	if f.Status != "" {
		clauses = append(clauses, "status = "+placeholder(f.Status))
	}
	if f.UserID > 0 {
		clauses = append(clauses, "user_id = "+placeholder(f.UserID))
	}
	if f.Search != "" {
		// ILIKE 跨 title / description 做不区分大小写的模糊匹配
		pattern := "%" + dbutil.EscapeLike(f.Search) + "%"
		ph := placeholder(pattern)
		clauses = append(clauses,
			"(title ILIKE "+ph+" OR description ILIKE "+ph+")")
	}
	if !f.StartTime.IsZero() {
		clauses = append(clauses, "created_at >= "+placeholder(f.StartTime))
	}
	if !f.EndTime.IsZero() {
		clauses = append(clauses, "created_at <= "+placeholder(f.EndTime))
	}
	if len(clauses) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}
