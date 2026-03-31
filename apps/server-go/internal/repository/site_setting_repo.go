package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// SiteSettingRepo 提供对 site_settings 表的数据访问能力。
type SiteSettingRepo struct{ db *sqlx.DB }

// NewSiteSettingRepo 创建一个由指定数据库连接支撑的 SiteSettingRepo 实例。
func NewSiteSettingRepo(db *sqlx.DB) *SiteSettingRepo { return &SiteSettingRepo{db: db} }

// FindAll 返回所有站点配置项，按 group_name 再按 setting_key 升序排列。
// 操作表：site_settings。
func (r *SiteSettingRepo) FindAll(ctx context.Context) ([]model.SiteSetting, error) {
	var settings []model.SiteSetting
	err := r.db.SelectContext(ctx, &settings, `SELECT * FROM site_settings ORDER BY group_name, setting_key`)
	return settings, err
}

// FindByGroup 返回指定分组下的所有配置项，按 setting_key 升序排列。
// 操作表：site_settings；参数 group 为配置分组名称（如 "general"、"seo"）。
func (r *SiteSettingRepo) FindByGroup(ctx context.Context, group string) ([]model.SiteSetting, error) {
	var settings []model.SiteSetting
	err := r.db.SelectContext(ctx, &settings,
		`SELECT * FROM site_settings WHERE group_name = $1 ORDER BY setting_key`, group)
	return settings, err
}

// FindByKey 根据点分隔符格式的 key 查询单条配置项，不存在时返回 nil。
// 操作表：site_settings；参数 key 为配置键名（如 "site.title"）。
func (r *SiteSettingRepo) FindByKey(ctx context.Context, key string) (*model.SiteSetting, error) {
	var s model.SiteSetting
	err := r.db.GetContext(ctx, &s, `SELECT * FROM site_settings WHERE setting_key = $1`, key)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}

// Upsert 按 setting_key 插入或更新单条配置项的值。
// 冲突时（ON CONFLICT）更新 setting_value 和 updated_at，不改变其他字段。
func (r *SiteSettingRepo) Upsert(ctx context.Context, key, value string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO site_settings (setting_key, setting_value, created_at, updated_at)
		 VALUES ($1, $2, NOW(), NOW())
		 ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
		key, value)
	return err
}

// UpsertBatch 在单个事务中批量写入多个键值对配置项。
// 每一项均采用 ON CONFLICT DO UPDATE 语义，保证幂等性。
// 任意一项写入失败则整个事务回滚。
func (r *SiteSettingRepo) UpsertBatch(ctx context.Context, kv map[string]string) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() // 发生错误时自动回滚
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
