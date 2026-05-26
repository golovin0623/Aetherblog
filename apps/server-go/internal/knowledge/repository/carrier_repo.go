// Package repository — Atlas carrier_repo
//
// 落地手册: docs/plan/task-aether-knowledge-system.md §3 Phase 1 task-knowledge-P1-01

package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
)

// CarrierRepo 操作 atlas_carriers / atlas_carrier_versions。
type CarrierRepo struct {
	*AtlasRepo
}

// NewCarrierRepo 由 AtlasRepo 衍生 CarrierRepo。
func NewCarrierRepo(base *AtlasRepo) *CarrierRepo {
	return &CarrierRepo{AtlasRepo: base}
}

// FindBySourceURI 用 source_uri 查找未删除载体。返回 nil, nil 表示不存在。
func (r *CarrierRepo) FindBySourceURI(ctx context.Context, sourceURI string) (*model.Carrier, error) {
	var c model.Carrier
	err := r.db.GetContext(ctx, &c,
		`SELECT * FROM atlas_carriers WHERE source_uri=$1 AND deleted=false LIMIT 1`, sourceURI)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// FindByID 按 ID 查询未删除载体。
func (r *CarrierRepo) FindByID(ctx context.Context, id int64) (*model.Carrier, error) {
	var c model.Carrier
	err := r.db.GetContext(ctx, &c,
		`SELECT * FROM atlas_carriers WHERE id=$1 AND deleted=false`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// Create 原子创建 Carrier + 第 1 版 CarrierVersion。
//
// 在事务中执行以确保 carrier 与 version_no=1 总是成对出现——任何后续锚定
// 算法都需要至少 1 个 version 行作为「锚定上下文」。
func (r *CarrierRepo) Create(ctx context.Context, c *model.Carrier, storageURI string) (*model.Carrier, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var out model.Carrier
	err = tx.QueryRowxContext(ctx, `
		INSERT INTO atlas_carriers (
			type, source_uri, content_hash, title, author, language,
			metadata, owner_id, status, status_message
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING *`,
		c.Type, c.SourceURI, c.ContentHash, c.Title, c.Author, c.Language,
		c.Metadata, c.OwnerID, c.Status, c.StatusMessage,
	).StructScan(&out)
	if err != nil {
		return nil, err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO atlas_carrier_versions (
			carrier_id, version_no, content_hash, storage_uri, diff_from_prev, reason
		)
		VALUES ($1, 1, $2, $3, '{}'::jsonb, 'original')`,
		out.ID, c.ContentHash, storageURI,
	)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &out, nil
}

// UpdateContent 在内容指纹变更时新增一个 CarrierVersion，并更新 carrier 的
// content_hash + updated_at（保留 carrier.id，原文不可变指的是版本不可变）。
func (r *CarrierRepo) UpdateContent(ctx context.Context, carrierID int64, newHash, storageURI, reason string, diffJSON []byte) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var nextVer int
	if err := tx.GetContext(ctx, &nextVer,
		`SELECT COALESCE(MAX(version_no), 0) + 1 FROM atlas_carrier_versions WHERE carrier_id=$1`,
		carrierID); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO atlas_carrier_versions (
			carrier_id, version_no, content_hash, storage_uri, diff_from_prev, reason
		) VALUES ($1, $2, $3, $4, $5, $6)`,
		carrierID, nextVer, newHash, storageURI, diffJSON, reason); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE atlas_carriers SET content_hash=$1, updated_at=CURRENT_TIMESTAMP
		WHERE id=$2`, newHash, carrierID); err != nil {
		return err
	}

	return tx.Commit()
}
