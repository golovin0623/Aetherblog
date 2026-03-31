package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// StorageProviderRepo provides data access for the storage_providers table.
type StorageProviderRepo struct{ db *sqlx.DB }

// NewStorageProviderRepo creates a StorageProviderRepo backed by the given database connection.
func NewStorageProviderRepo(db *sqlx.DB) *StorageProviderRepo {
	return &StorageProviderRepo{db: db}
}

// FindAll returns all storage providers ordered by priority then id.
func (r *StorageProviderRepo) FindAll(ctx context.Context) ([]model.StorageProvider, error) {
	var ps []model.StorageProvider
	err := r.db.SelectContext(ctx, &ps, `SELECT * FROM storage_providers ORDER BY priority ASC, id ASC`)
	return ps, err
}

// FindByID returns a storage provider by primary key, or nil if not found.
func (r *StorageProviderRepo) FindByID(ctx context.Context, id int64) (*model.StorageProvider, error) {
	var p model.StorageProvider
	err := r.db.GetContext(ctx, &p, `SELECT * FROM storage_providers WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// FindDefault returns the enabled storage provider marked as default, or nil if none.
func (r *StorageProviderRepo) FindDefault(ctx context.Context) (*model.StorageProvider, error) {
	var p model.StorageProvider
	err := r.db.GetContext(ctx, &p, `SELECT * FROM storage_providers WHERE is_default=true AND is_enabled=true LIMIT 1`)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// StorageProviderRequest holds the mutable fields for creating or updating a storage provider.
type StorageProviderRequest struct {
	Name         string
	ProviderType string
	ConfigJSON   string
	IsEnabled    bool
	Priority     int
}

// Create inserts a new storage provider, returning the created row.
func (r *StorageProviderRepo) Create(ctx context.Context, req StorageProviderRequest) (*model.StorageProvider, error) {
	var p model.StorageProvider
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO storage_providers (name, provider_type, config_json, is_enabled, priority)
		VALUES ($1,$2,$3,$4,$5) RETURNING *`,
		req.Name, req.ProviderType, req.ConfigJSON, req.IsEnabled, req.Priority,
	).Scan(&p.ID, &p.Name, &p.ProviderType, &p.ConfigJSON, &p.IsDefault, &p.IsEnabled, &p.Priority, &p.CreatedAt, &p.UpdatedAt)
	return &p, err
}

// Update modifies an existing storage provider's configuration fields.
func (r *StorageProviderRepo) Update(ctx context.Context, id int64, req StorageProviderRequest) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE storage_providers SET name=$1, provider_type=$2, config_json=$3, is_enabled=$4, priority=$5 WHERE id=$6`,
		req.Name, req.ProviderType, req.ConfigJSON, req.IsEnabled, req.Priority, id)
	return err
}

// Delete permanently removes a storage provider by primary key.
func (r *StorageProviderRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM storage_providers WHERE id=$1`, id)
	return err
}

// SetDefault clears is_default on all providers then marks the given one as default in a transaction.
func (r *StorageProviderRepo) SetDefault(ctx context.Context, id int64) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE storage_providers SET is_default=false`); err != nil {
		tx.Rollback()
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE storage_providers SET is_default=true WHERE id=$1`, id); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}
