package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

type SiteSettingRepo struct{ db *sqlx.DB }

func NewSiteSettingRepo(db *sqlx.DB) *SiteSettingRepo { return &SiteSettingRepo{db: db} }

func (r *SiteSettingRepo) FindAll(ctx context.Context) ([]model.SiteSetting, error) {
	var settings []model.SiteSetting
	err := r.db.SelectContext(ctx, &settings, `SELECT * FROM site_settings ORDER BY group_name, setting_key`)
	return settings, err
}

func (r *SiteSettingRepo) FindByGroup(ctx context.Context, group string) ([]model.SiteSetting, error) {
	var settings []model.SiteSetting
	err := r.db.SelectContext(ctx, &settings,
		`SELECT * FROM site_settings WHERE group_name = $1 ORDER BY setting_key`, group)
	return settings, err
}

func (r *SiteSettingRepo) FindByKey(ctx context.Context, key string) (*model.SiteSetting, error) {
	var s model.SiteSetting
	err := r.db.GetContext(ctx, &s, `SELECT * FROM site_settings WHERE setting_key = $1`, key)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}

func (r *SiteSettingRepo) Upsert(ctx context.Context, key, value string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO site_settings (setting_key, setting_value, created_at, updated_at)
		 VALUES ($1, $2, NOW(), NOW())
		 ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
		key, value)
	return err
}

func (r *SiteSettingRepo) UpsertBatch(ctx context.Context, kv map[string]string) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for k, v := range kv {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO site_settings (setting_key, setting_value, created_at, updated_at)
			 VALUES ($1, $2, NOW(), NOW())
			 ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
			k, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}
