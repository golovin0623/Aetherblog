package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
)

type CommentRepo struct{ db *sqlx.DB }

func NewCommentRepo(db *sqlx.DB) *CommentRepo { return &CommentRepo{db: db} }

func (r *CommentRepo) FindByID(ctx context.Context, id int64) (*model.Comment, error) {
	var c model.Comment
	err := r.db.GetContext(ctx, &c, `SELECT * FROM comments WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

// FindByPostApproved returns all APPROVED comments for a post (for public display).
func (r *CommentRepo) FindByPostApproved(ctx context.Context, postID int64) ([]model.Comment, error) {
	var cs []model.Comment
	err := r.db.SelectContext(ctx, &cs,
		`SELECT * FROM comments WHERE post_id=$1 AND status='APPROVED' ORDER BY created_at ASC`, postID)
	return cs, err
}

// FindPending returns paginated PENDING comments for admin moderation.
func (r *CommentRepo) FindPending(ctx context.Context, p pagination.Params) ([]model.Comment, int64, error) {
	return r.findWithFilter(ctx, dto.CommentFilter{Status: "PENDING", PageNum: p.PageNum, PageSize: p.PageSize})
}

// FindForAdmin returns paginated comments matching filter for admin list.
func (r *CommentRepo) FindForAdmin(ctx context.Context, f dto.CommentFilter) ([]model.Comment, int64, error) {
	return r.findWithFilter(ctx, f)
}

func (r *CommentRepo) findWithFilter(ctx context.Context, f dto.CommentFilter) ([]model.Comment, int64, error) {
	var sb strings.Builder
	args := []any{}
	idx := 1

	sb.WriteString("FROM comments WHERE 1=1")

	if f.Status != "" {
		sb.WriteString(fmt.Sprintf(" AND status=$%d", idx))
		args = append(args, f.Status)
		idx++
	}
	if f.PostID != nil {
		sb.WriteString(fmt.Sprintf(" AND post_id=$%d", idx))
		args = append(args, *f.PostID)
		idx++
	}
	if f.Keyword != "" {
		sb.WriteString(fmt.Sprintf(" AND (content ILIKE $%d OR nickname ILIKE $%d)", idx, idx))
		args = append(args, "%"+f.Keyword+"%")
		idx++
	}

	base := sb.String()

	var total int64
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	pageNum := f.PageNum
	if pageNum < 1 {
		pageNum = 1
	}
	pageSize := f.PageSize
	if pageSize < 1 {
		pageSize = 10
	}
	offset := (pageNum - 1) * pageSize

	query := fmt.Sprintf("SELECT * %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d", base, idx, idx+1)
	args = append(args, pageSize, offset)

	var cs []model.Comment
	if err := r.db.SelectContext(ctx, &cs, query, args...); err != nil {
		return nil, 0, err
	}
	return cs, total, nil
}

func (r *CommentRepo) Create(ctx context.Context, c *model.Comment) error {
	return r.db.QueryRowContext(ctx,
		`INSERT INTO comments (post_id, parent_id, nickname, email, website, avatar, content, status, ip, user_agent, is_admin)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at, updated_at`,
		c.PostID, c.ParentID, c.Nickname, c.Email, c.Website, c.Avatar, c.Content,
		c.Status, c.IP, c.UserAgent, c.IsAdmin,
	).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
}

func (r *CommentRepo) UpdateStatus(ctx context.Context, id int64, status string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE comments SET status=$1 WHERE id=$2`, status, id)
	return err
}

func (r *CommentRepo) UpdateStatusBatch(ctx context.Context, ids []int64, status string) error {
	if len(ids) == 0 {
		return nil
	}
	query, args, err := sqlx.In(`UPDATE comments SET status=? WHERE id IN (?)`, status, ids)
	if err != nil {
		return err
	}
	query = r.db.Rebind(query)
	_, err = r.db.ExecContext(ctx, query, args...)
	return err
}

// SoftDelete marks comment as DELETED (keeps for permanent deletion later).
func (r *CommentRepo) SoftDelete(ctx context.Context, id int64) error {
	return r.UpdateStatus(ctx, id, "DELETED")
}

// PermanentDelete removes comment from DB permanently.
func (r *CommentRepo) PermanentDelete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM comments WHERE id=$1`, id)
	return err
}

func (r *CommentRepo) PermanentDeleteBatch(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	query, args, err := sqlx.In(`DELETE FROM comments WHERE id IN (?)`, ids)
	if err != nil {
		return err
	}
	query = r.db.Rebind(query)
	_, err = r.db.ExecContext(ctx, query, args...)
	return err
}

// UpdatePostCommentCount recalculates and updates the comment_count field on post.
func (r *CommentRepo) UpdatePostCommentCount(ctx context.Context, postID int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE posts SET comment_count = (
			SELECT COUNT(*) FROM comments WHERE post_id=$1 AND status='APPROVED'
		) WHERE id=$1`,
		postID)
	return err
}
