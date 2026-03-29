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

type FriendLinkRepo struct{ db *sqlx.DB }

func NewFriendLinkRepo(db *sqlx.DB) *FriendLinkRepo { return &FriendLinkRepo{db: db} }

func (r *FriendLinkRepo) FindAll(ctx context.Context) ([]model.FriendLink, error) {
	var links []model.FriendLink
	err := r.db.SelectContext(ctx, &links, `SELECT * FROM friend_links ORDER BY sort_order ASC, id ASC`)
	return links, err
}

func (r *FriendLinkRepo) FindVisible(ctx context.Context) ([]model.FriendLink, error) {
	var links []model.FriendLink
	err := r.db.SelectContext(ctx, &links,
		`SELECT * FROM friend_links WHERE visible = true ORDER BY sort_order ASC, id ASC`)
	return links, err
}

func (r *FriendLinkRepo) FindPage(ctx context.Context, p pagination.Params) ([]model.FriendLink, int64, error) {
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

func (r *FriendLinkRepo) FindByID(ctx context.Context, id int64) (*model.FriendLink, error) {
	var fl model.FriendLink
	err := r.db.GetContext(ctx, &fl, `SELECT * FROM friend_links WHERE id = $1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &fl, err
}

func (r *FriendLinkRepo) Create(ctx context.Context, fl *model.FriendLink) (*model.FriendLink, error) {
	var out model.FriendLink
	err := r.db.QueryRowxContext(ctx,
		`INSERT INTO friend_links (name, url, logo, description, email, rss_url, theme_color, is_online, sort_order, visible, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING *`,
		fl.Name, fl.URL, fl.Logo, fl.Description, fl.Email, fl.RSSUrl, fl.ThemeColor, fl.IsOnline, fl.SortOrder, fl.Visible,
	).StructScan(&out)
	return &out, err
}

func (r *FriendLinkRepo) Update(ctx context.Context, id int64, fl *model.FriendLink) (*model.FriendLink, error) {
	var out model.FriendLink
	err := r.db.QueryRowxContext(ctx,
		`UPDATE friend_links SET name=$1, url=$2, logo=$3, description=$4, email=$5, rss_url=$6, theme_color=$7, is_online=$8, sort_order=$9, visible=$10, updated_at=NOW()
		 WHERE id=$11 RETURNING *`,
		fl.Name, fl.URL, fl.Logo, fl.Description, fl.Email, fl.RSSUrl, fl.ThemeColor, fl.IsOnline, fl.SortOrder, fl.Visible, id,
	).StructScan(&out)
	return &out, err
}

func (r *FriendLinkRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM friend_links WHERE id = $1`, id)
	return err
}

func (r *FriendLinkRepo) DeleteBatch(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
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

func (r *FriendLinkRepo) ToggleVisible(ctx context.Context, id int64) (*model.FriendLink, error) {
	var out model.FriendLink
	err := r.db.QueryRowxContext(ctx,
		`UPDATE friend_links SET visible = NOT visible, updated_at=NOW() WHERE id=$1 RETURNING *`, id,
	).StructScan(&out)
	return &out, err
}

// Reorder sets sort_order=index for each ID in the ordered list.
func (r *FriendLinkRepo) Reorder(ctx context.Context, ids []int64) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, id := range ids {
		if _, err := tx.ExecContext(ctx,
			`UPDATE friend_links SET sort_order=$1, updated_at=NOW() WHERE id=$2`, i, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
