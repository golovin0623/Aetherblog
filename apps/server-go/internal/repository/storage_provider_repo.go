package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// StorageProviderRepo 提供对 storage_providers 表的数据访问能力。
type StorageProviderRepo struct{ db *sqlx.DB }

// NewStorageProviderRepo 创建一个由指定数据库连接支撑的 StorageProviderRepo 实例。
func NewStorageProviderRepo(db *sqlx.DB) *StorageProviderRepo {
	return &StorageProviderRepo{db: db}
}

// FindAll 返回所有存储提供商，按 priority 升序后按 id 升序排列。
// 操作表：storage_providers；priority 越小优先级越高。
func (r *StorageProviderRepo) FindAll(ctx context.Context) ([]model.StorageProvider, error) {
	var ps []model.StorageProvider
	err := r.db.SelectContext(ctx, &ps, `SELECT * FROM storage_providers ORDER BY priority ASC, id ASC`)
	return ps, err
}

// FindByID 根据主键查询单个存储提供商，不存在时返回 nil。
// 操作表：storage_providers；参数 id 为提供商主键。
func (r *StorageProviderRepo) FindByID(ctx context.Context, id int64) (*model.StorageProvider, error) {
	var p model.StorageProvider
	err := r.db.GetContext(ctx, &p, `SELECT * FROM storage_providers WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// 记录不存在，返回 nil 而非错误
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// FindDefault 返回当前标记为默认且处于启用状态的存储提供商，不存在时返回 nil。
// 操作表：storage_providers；过滤条件：is_default = true AND is_enabled = true。
func (r *StorageProviderRepo) FindDefault(ctx context.Context) (*model.StorageProvider, error) {
	var p model.StorageProvider
	err := r.db.GetContext(ctx, &p, `SELECT * FROM storage_providers WHERE is_default=true AND is_enabled=true LIMIT 1`)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// 当前无默认存储提供商
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// StorageProviderRequest 包含创建或更新存储提供商时可修改的字段。
type StorageProviderRequest struct {
	Name         string // 提供商名称
	ProviderType string // 提供商类型（如 local、s3、oss）
	ConfigJSON   string // 提供商配置的 JSON 字符串
	IsEnabled    bool   // 是否启用该提供商
	Priority     int    // 排序优先级，数字越小越优先
}

// Create 向 storage_providers 表插入一条新记录，并返回完整的创建后实体。
// 操作表：storage_providers；使用 RETURNING * 后逐列 Scan 回填结构体。
func (r *StorageProviderRepo) Create(ctx context.Context, req StorageProviderRequest) (*model.StorageProvider, error) {
	var p model.StorageProvider
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO storage_providers (name, provider_type, config_json, is_enabled, priority)
		VALUES ($1,$2,$3,$4,$5) RETURNING *`,
		req.Name, req.ProviderType, req.ConfigJSON, req.IsEnabled, req.Priority,
	).Scan(&p.ID, &p.Name, &p.ProviderType, &p.ConfigJSON, &p.IsDefault, &p.IsEnabled, &p.Priority, &p.CreatedAt, &p.UpdatedAt)
	return &p, err
}

// Update 修改指定存储提供商的配置字段。
// 操作表：storage_providers；参数 id 为提供商主键，req 包含所有可更新字段。
func (r *StorageProviderRepo) Update(ctx context.Context, id int64, req StorageProviderRequest) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE storage_providers SET name=$1, provider_type=$2, config_json=$3, is_enabled=$4, priority=$5 WHERE id=$6`,
		req.Name, req.ProviderType, req.ConfigJSON, req.IsEnabled, req.Priority, id)
	return err
}

// Delete 根据主键永久删除一条存储提供商记录。
// 操作表：storage_providers；参数 id 为提供商主键。
func (r *StorageProviderRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM storage_providers WHERE id=$1`, id)
	return err
}

// SetDefault 在事务中将指定提供商设置为默认存储提供商。
// 核心逻辑：先将所有记录的 is_default 置为 false，再将目标记录的 is_default 置为 true，
// 保证同一时刻只有一个默认提供商。事务失败时自动回滚。
func (r *StorageProviderRepo) SetDefault(ctx context.Context, id int64) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	// 先清除所有提供商的默认标志
	if _, err := tx.ExecContext(ctx, `UPDATE storage_providers SET is_default=false`); err != nil {
		tx.Rollback()
		return err
	}
	// 再将指定提供商标记为默认
	if _, err := tx.ExecContext(ctx, `UPDATE storage_providers SET is_default=true WHERE id=$1`, id); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}
