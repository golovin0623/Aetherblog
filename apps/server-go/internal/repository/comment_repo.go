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

// CommentRepo 负责对 comments 表进行数据访问操作。
type CommentRepo struct{ db *sqlx.DB }

// NewCommentRepo 创建一个使用给定数据库连接的 CommentRepo 实例。
func NewCommentRepo(db *sqlx.DB) *CommentRepo { return &CommentRepo{db: db} }

// FindByID 从 comments 表按主键查询单条评论，若不存在则返回 nil。
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

// FindByPostApproved 从 comments 表返回指定文章下所有已审核通过（APPROVED）的评论，
// 按创建时间升序排列，用于前台公开展示。
func (r *CommentRepo) FindByPostApproved(ctx context.Context, postID int64) ([]model.Comment, error) {
	var cs []model.Comment
	err := r.db.SelectContext(ctx, &cs,
		`SELECT * FROM comments WHERE post_id=$1 AND status='APPROVED' ORDER BY created_at ASC`, postID)
	return cs, err
}

// FindPending 从 comments 表返回状态为 PENDING（待审核）的分页评论列表，供管理端审核使用。
func (r *CommentRepo) FindPending(ctx context.Context, p pagination.Params) ([]model.Comment, int64, error) {
	return r.findWithFilter(ctx, dto.CommentFilter{Status: "PENDING", PageNum: p.PageNum, PageSize: p.PageSize})
}

// FindForAdmin 从 comments 表按 CommentFilter 条件返回分页评论列表及总数，供管理端列表使用。
func (r *CommentRepo) FindForAdmin(ctx context.Context, f dto.CommentFilter) ([]model.Comment, int64, error) {
	return r.findWithFilter(ctx, f)
}

// findWithFilter 是内部通用查询方法，根据 CommentFilter 动态拼接 WHERE 子句，
// 先查总数再查分页数据，支持按 status、post_id、关键字（content/nickname）过滤。
func (r *CommentRepo) findWithFilter(ctx context.Context, f dto.CommentFilter) ([]model.Comment, int64, error) {
	var sb strings.Builder
	args := []any{}
	idx := 1

	sb.WriteString("FROM comments WHERE 1=1")

	// 按评论状态过滤（PENDING / APPROVED / REJECTED / SPAM / DELETED）
	if f.Status != "" {
		sb.WriteString(fmt.Sprintf(" AND status=$%d", idx))
		args = append(args, f.Status)
		idx++
	}
	// 按文章 ID 过滤
	if f.PostID != nil {
		sb.WriteString(fmt.Sprintf(" AND post_id=$%d", idx))
		args = append(args, *f.PostID)
		idx++
	}
	// 关键字同时模糊匹配评论内容和昵称（不区分大小写）
	if f.Keyword != "" {
		sb.WriteString(fmt.Sprintf(" AND (content ILIKE $%d OR nickname ILIKE $%d)", idx, idx))
		args = append(args, "%"+f.Keyword+"%")
		idx++
	}

	base := sb.String()

	// 先查符合条件的总记录数
	var total int64
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// 页码和页大小兜底处理
	pageNum := f.PageNum
	if pageNum < 1 {
		pageNum = 1
	}
	pageSize := f.PageSize
	if pageSize < 1 {
		pageSize = 10
	}
	offset := (pageNum - 1) * pageSize

	// 按创建时间降序分页返回
	query := fmt.Sprintf("SELECT * %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d", base, idx, idx+1)
	args = append(args, pageSize, offset)

	var cs []model.Comment
	if err := r.db.SelectContext(ctx, &cs, query, args...); err != nil {
		return nil, 0, err
	}
	return cs, total, nil
}

// Create 向 comments 表插入一条新评论，通过 RETURNING 回填数据库生成的 id、created_at 和 updated_at。
func (r *CommentRepo) Create(ctx context.Context, c *model.Comment) error {
	return r.db.QueryRowContext(ctx,
		`INSERT INTO comments (post_id, parent_id, nickname, email, website, avatar, content, status, ip, user_agent, is_admin)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at, updated_at`,
		c.PostID, c.ParentID, c.Nickname, c.Email, c.Website, c.Avatar, c.Content,
		c.Status, c.IP, c.UserAgent, c.IsAdmin,
	).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
}

// UpdateStatus 将 comments 表中指定评论的状态更新为给定值。
// 有效状态值：PENDING（待审核）| APPROVED（已通过）| REJECTED（已拒绝）| SPAM（垃圾）| DELETED（已删除）
func (r *CommentRepo) UpdateStatus(ctx context.Context, id int64, status string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE comments SET status=$1 WHERE id=$2`, status, id)
	return err
}

// UpdateStatusBatch 在一条 SQL 中批量更新多条评论的状态。
// 当 ids 为空时直接返回，不执行任何数据库操作。
func (r *CommentRepo) UpdateStatusBatch(ctx context.Context, ids []int64, status string) error {
	if len(ids) == 0 {
		return nil
	}
	// 使用 sqlx.In 生成 IN 子句，再通过 Rebind 转换为 PostgreSQL 风格占位符
	query, args, err := sqlx.In(`UPDATE comments SET status=? WHERE id IN (?)`, status, ids)
	if err != nil {
		return err
	}
	query = r.db.Rebind(query)
	_, err = r.db.ExecContext(ctx, query, args...)
	return err
}

// SoftDelete 将评论状态标记为 DELETED（软删除），保留记录以便后续永久清除。
func (r *CommentRepo) SoftDelete(ctx context.Context, id int64) error {
	return r.UpdateStatus(ctx, id, "DELETED")
}

// PermanentDelete 从 comments 表中物理删除指定评论。
func (r *CommentRepo) PermanentDelete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM comments WHERE id=$1`, id)
	return err
}

// PermanentDeleteBatch 在一条 SQL 中批量物理删除多条评论。
// 当 ids 为空时直接返回，不执行任何数据库操作。
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

// UpdatePostCommentCount 重新统计指定文章的已审核评论数，并将结果写回 posts.comment_count 字段，
// 使用子查询确保计数的准确性。
func (r *CommentRepo) UpdatePostCommentCount(ctx context.Context, postID int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE posts SET comment_count = (
			SELECT COUNT(*) FROM comments WHERE post_id=$1 AND status='APPROVED'
		) WHERE id=$1`,
		postID)
	return err
}
