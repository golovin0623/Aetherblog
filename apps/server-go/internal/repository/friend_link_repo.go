package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
)

// FriendLinkRepo 负责对 friend_links 表进行数据访问操作。
type FriendLinkRepo struct{ db *sqlx.DB }

// NewFriendLinkRepo 创建一个使用给定数据库连接的 FriendLinkRepo 实例。
func NewFriendLinkRepo(db *sqlx.DB) *FriendLinkRepo { return &FriendLinkRepo{db: db} }

// FindAll 从 friend_links 表返回所有友情链接，按 sort_order 升序、id 升序排列，供管理端使用。
func (r *FriendLinkRepo) FindAll(ctx context.Context) ([]model.FriendLink, error) {
	var links []model.FriendLink
	err := r.db.SelectContext(ctx, &links, `SELECT * FROM friend_links ORDER BY sort_order ASC, id ASC`)
	return links, err
}

// FindVisible 从 friend_links 表返回所有 visible=true 的友情链接，按 sort_order 升序排列，供前台公开展示。
func (r *FriendLinkRepo) FindVisible(ctx context.Context) ([]model.FriendLink, error) {
	var links []model.FriendLink
	err := r.db.SelectContext(ctx, &links,
		`SELECT * FROM friend_links WHERE visible = true ORDER BY sort_order ASC, id ASC`)
	return links, err
}

// FindPage 从 friend_links 表返回分页的友情链接列表及总数，供管理端分页展示。
func (r *FriendLinkRepo) FindPage(ctx context.Context, p pagination.Params) ([]model.FriendLink, int64, error) {
	// 先查总数
	var total int64
	if err := r.db.GetContext(ctx, &total, `SELECT COUNT(*) FROM friend_links`); err != nil {
		return nil, 0, err
	}
	var links []model.FriendLink
	err := r.db.SelectContext(ctx, &links,
		`SELECT * FROM friend_links ORDER BY sort_order ASC, id ASC LIMIT $1 OFFSET $2`,
		p.Limit(), p.Offset())
	return links, total, err
}

// FindByID 从 friend_links 表按主键查询单条友情链接，若不存在则返回 nil。
func (r *FriendLinkRepo) FindByID(ctx context.Context, id int64) (*model.FriendLink, error) {
	var fl model.FriendLink
	err := r.db.GetContext(ctx, &fl, `SELECT * FROM friend_links WHERE id = $1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &fl, err
}

// Create 向 friend_links 表插入新的友情链接，created_at/updated_at 由数据库 NOW() 自动填充，
// 使用 RETURNING * 回填完整创建行数据。
func (r *FriendLinkRepo) Create(ctx context.Context, fl *model.FriendLink) (*model.FriendLink, error) {
	var out model.FriendLink
	err := r.db.QueryRowxContext(ctx,
		`INSERT INTO friend_links (name, url, logo, description, email, rss_url, theme_color, is_online, sort_order, visible, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING *`,
		fl.Name, fl.URL, fl.Logo, fl.Description, fl.Email, fl.RSSUrl, fl.ThemeColor, fl.IsOnline, fl.SortOrder, fl.Visible,
	).StructScan(&out)
	return &out, err
}

// Update 修改 friend_links 表中指定友情链接的所有可变字段，updated_at 由数据库自动更新，
// 使用 RETURNING * 返回更新后的完整行数据。
func (r *FriendLinkRepo) Update(ctx context.Context, id int64, fl *model.FriendLink) (*model.FriendLink, error) {
	var out model.FriendLink
	err := r.db.QueryRowxContext(ctx,
		`UPDATE friend_links SET name=$1, url=$2, logo=$3, description=$4, email=$5, rss_url=$6, theme_color=$7, is_online=$8, sort_order=$9, visible=$10, updated_at=NOW()
		 WHERE id=$11 RETURNING *`,
		fl.Name, fl.URL, fl.Logo, fl.Description, fl.Email, fl.RSSUrl, fl.ThemeColor, fl.IsOnline, fl.SortOrder, fl.Visible, id,
	).StructScan(&out)
	return &out, err
}

// Delete 从 friend_links 表中永久删除单条友情链接。
func (r *FriendLinkRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM friend_links WHERE id = $1`, id)
	return err
}

// DeleteBatch 从 friend_links 表中批量永久删除多条友情链接。
// 当 ids 为空时直接返回，不执行任何数据库操作。
// 使用手动构建的 IN 占位符以兼容 PostgreSQL 驱动（$1, $2, ...）。
func (r *FriendLinkRepo) DeleteBatch(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	// 手动构建 PostgreSQL 风格的位置参数占位符
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	_, err := r.db.ExecContext(ctx,
		fmt.Sprintf(`DELETE FROM friend_links WHERE id IN (%s)`, strings.Join(placeholders, ",")),
		args...)
	return err
}

// ToggleVisible 翻转指定友情链接的 visible 字段（true→false 或 false→true），
// 更新 updated_at 并通过 RETURNING * 返回更新后的完整行数据。
func (r *FriendLinkRepo) ToggleVisible(ctx context.Context, id int64) (*model.FriendLink, error) {
	var out model.FriendLink
	err := r.db.QueryRowxContext(ctx,
		`UPDATE friend_links SET visible = NOT visible, updated_at=NOW() WHERE id=$1 RETURNING *`, id,
	).StructScan(&out)
	return &out, err
}

// Reorder 在事务中按传入的 ids 顺序依次将每条友情链接的 sort_order 更新为其在切片中的索引值（从 0 开始），
// 实现拖拽排序持久化。任意一条更新失败则回滚整个事务。
func (r *FriendLinkRepo) Reorder(ctx context.Context, ids []int64) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() // 事务未提交时自动回滚
	for i, id := range ids {
		if _, err := tx.ExecContext(ctx,
			`UPDATE friend_links SET sort_order=$1, updated_at=NOW() WHERE id=$2`, i, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
