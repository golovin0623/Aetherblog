package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
)

// activityColumns is the explicit column list — intentionally excludes `metadata` (JSONB).
const activityColumns = `id, event_type, event_category, title, description, user_id, ip, status, created_at`

// ActivityFilter holds optional filters for the admin paginated activity list.
type ActivityFilter struct {
	EventType string
	Status    string
	pagination.Params
}

// ActivityRepo handles activity_events table queries.
type ActivityRepo struct{ db *sqlx.DB }

func NewActivityRepo(db *sqlx.DB) *ActivityRepo { return &ActivityRepo{db: db} }

// FindRecent returns the most recent N activity events.
func (r *ActivityRepo) FindRecent(ctx context.Context, limit int) ([]model.ActivityEvent, error) {
	var rows []model.ActivityEvent
	err := r.db.SelectContext(ctx, &rows,
		fmt.Sprintf(`SELECT %s FROM activity_events ORDER BY created_at DESC LIMIT %d`,
			activityColumns, limit))
	return rows, err
}

// FindForAdmin returns a paginated list of activity events with optional filters.
func (r *ActivityRepo) FindForAdmin(ctx context.Context, f ActivityFilter) ([]model.ActivityEvent, int64, error) {
	where, args := buildActivityWhere(f.EventType, f.Status)

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

// FindByUser returns paginated activity events for a specific user.
func (r *ActivityRepo) FindByUser(ctx context.Context, userID int64, p pagination.Params) ([]model.ActivityEvent, int64, error) {
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

// Create inserts a new activity event row.
func (r *ActivityRepo) Create(ctx context.Context, a *model.ActivityEvent) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO activity_events (event_type, event_category, title, description, user_id, ip, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
		a.EventType, a.EventCategory, a.Title, a.Description, a.UserID, a.IP, a.Status)
	return err
}

// buildActivityWhere constructs a WHERE clause for admin filtering.
func buildActivityWhere(eventType, status string) (string, []any) {
	clauses := []string{}
	args := []any{}
	n := 1
	placeholder := func(v any) string {
		args = append(args, v)
		s := fmt.Sprintf("$%d", n)
		n++
		return s
	}
	if eventType != "" {
		clauses = append(clauses, "event_type = "+placeholder(eventType))
	}
	if status != "" {
		clauses = append(clauses, "status = "+placeholder(status))
	}
	if len(clauses) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}
