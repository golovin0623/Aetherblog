// Package repository — Atlas carrier_repo
//
// 落地手册: docs/plan/task-aether-knowledge-system.md §3 Phase 1 task-knowledge-P1-01

package repository

import (
	"context"
	"database/sql"
	"errors"
	"strconv"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
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

// FindBySourceURIForOwner 用 source_uri + owner 查找未删除载体。
func (r *CarrierRepo) FindBySourceURIForOwner(ctx context.Context, sourceURI string, ownerID *int64) (*model.Carrier, error) {
	var c model.Carrier
	err := r.db.GetContext(ctx, &c,
		`SELECT * FROM atlas_carriers
		 WHERE source_uri=$1
		   AND COALESCE(owner_id, 0) = COALESCE($2::bigint, 0)
		   AND deleted=false
		 LIMIT 1`, sourceURI, ownerID)
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

// Search 在可访问载体的标题、来源 URI 与作者字段中做轻量关键字搜索。
func (r *CarrierRepo) Search(ctx context.Context, keyword string, ownerID *int64, limit int) ([]model.Carrier, error) {
	if keyword == "" {
		return []model.Carrier{}, nil
	}
	q := `SELECT * FROM atlas_carriers
		WHERE deleted=false
		  AND (title ILIKE $1 OR source_uri ILIKE $1 OR author ILIKE $1)`
	args := []any{"%" + dbutil.EscapeLike(keyword) + "%"}
	idx := 2
	if ownerID != nil {
		q += " AND owner_id=$" + strconv.Itoa(idx)
		args = append(args, *ownerID)
		idx++
	}
	if limit <= 0 {
		limit = 20
	} else if limit > 100 {
		limit = 100
	}
	q += " ORDER BY updated_at DESC LIMIT $" + strconv.Itoa(idx)
	args = append(args, limit)

	rows := []model.Carrier{}
	err := r.db.SelectContext(ctx, &rows, q, args...)
	return rows, err
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

// UpsertBySourceURI 原子地插入或返回已存在的 carrier，按 owner+source_uri 唯一索引去重。
//
// PR #724 review fix (Codex P1): GetOrCreateForNote 过去做 read-then-insert 没有锁，
// 并发首次打开同一 note 会同时 miss + 同时 INSERT 造成 source_uri 重复 carrier。
// 本方法走 INSERT ... ON CONFLICT (COALESCE(owner_id,0), source_uri) DO UPDATE source_uri = EXCLUDED.source_uri
// 模式 + xmax = 0 探测是否真插入。RETURNING 始终返回行（DO UPDATE 无副作用）。
//
// 返回 (carrier, justCreated, err)：
//
//	justCreated=true 表示本次实际 INSERT，调用方需要再写一行 v1 carrier_version
//	justCreated=false 表示行已存在，仅返回已有 carrier（含旧 hash），调用方按需做版本迁移
func (r *CarrierRepo) UpsertBySourceURI(ctx context.Context, c *model.Carrier, storageURI string) (*model.Carrier, bool, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()

	var out model.Carrier
	var justCreated bool
	err = tx.QueryRowxContext(ctx, `
		INSERT INTO atlas_carriers (
			type, source_uri, content_hash, title, author, language,
			metadata, owner_id, status, status_message
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT ((COALESCE(owner_id, 0)), source_uri) WHERE deleted=false DO UPDATE
			SET source_uri = EXCLUDED.source_uri
		RETURNING
			id, type, source_uri, content_hash, title, author, language,
			metadata, owner_id, status, status_message, deleted, created_at, updated_at,
			(xmax = 0) AS just_created`,
		c.Type, c.SourceURI, c.ContentHash, c.Title, c.Author, c.Language,
		c.Metadata, c.OwnerID, c.Status, c.StatusMessage,
	).Scan(
		&out.ID, &out.Type, &out.SourceURI, &out.ContentHash, &out.Title,
		&out.Author, &out.Language, &out.Metadata, &out.OwnerID,
		&out.Status, &out.StatusMessage, &out.Deleted, &out.CreatedAt, &out.UpdatedAt,
		&justCreated,
	)
	if err != nil {
		return nil, false, err
	}

	// 只在真插入时建 v1 version；并发情况下仅一个 tx 拿到 justCreated=true
	if justCreated {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO atlas_carrier_versions (
				carrier_id, version_no, content_hash, storage_uri, diff_from_prev, reason
			)
			VALUES ($1, 1, $2, $3, '{}'::jsonb, 'original')
			ON CONFLICT (carrier_id, version_no) DO NOTHING`,
			out.ID, c.ContentHash, storageURI,
		); err != nil {
			return nil, false, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return &out, justCreated, nil
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

// UpdateIngestState refreshes non-versioned carrier ingest metadata.
func (r *CarrierRepo) UpdateIngestState(ctx context.Context, carrierID int64, metadata []byte, status string, statusMessage *string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE atlas_carriers
		SET metadata=$1, status=$2, status_message=$3, updated_at=CURRENT_TIMESTAMP
		WHERE id=$4`,
		metadata,
		status,
		statusMessage,
		carrierID,
	)
	return err
}

// UpdateDisplayAndIngestState refreshes non-versioned carrier display fields and ingest metadata.
func (r *CarrierRepo) UpdateDisplayAndIngestState(
	ctx context.Context,
	carrierID int64,
	title string,
	author *string,
	language *string,
	metadata []byte,
	status string,
	statusMessage *string,
) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE atlas_carriers
		SET title=$1,
		    author=$2,
		    language=$3,
		    metadata=$4,
		    status=$5,
		    status_message=$6,
		    updated_at=CURRENT_TIMESTAMP
		WHERE id=$7`,
		title,
		author,
		language,
		metadata,
		status,
		statusMessage,
		carrierID,
	)
	return err
}

// UpsertTextLayer persists an extracted rootText artifact for a carrier version.
func (r *CarrierRepo) UpsertTextLayer(
	ctx context.Context,
	layer *model.CarrierTextLayer,
) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO atlas_carrier_text_layers (
			carrier_id, content_hash, storage_uri, page_count, char_count, text_content, pages
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (carrier_id, content_hash) DO UPDATE SET
			storage_uri = EXCLUDED.storage_uri,
			page_count = EXCLUDED.page_count,
			char_count = EXCLUDED.char_count,
			text_content = EXCLUDED.text_content,
			pages = EXCLUDED.pages,
			updated_at = CURRENT_TIMESTAMP`,
		layer.CarrierID,
		layer.ContentHash,
		layer.StorageURI,
		layer.PageCount,
		layer.CharCount,
		layer.TextContent,
		layer.Pages,
	)
	return err
}

// FindTextLayerByStorageURI returns one extracted rootText artifact by storage_uri.
func (r *CarrierRepo) FindTextLayerByStorageURI(ctx context.Context, storageURI string) (*model.CarrierTextLayer, error) {
	var layer model.CarrierTextLayer
	err := r.db.GetContext(ctx, &layer,
		`SELECT * FROM atlas_carrier_text_layers WHERE storage_uri=$1 LIMIT 1`, storageURI)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &layer, nil
}

// FindTextLayerByCarrierAndHash returns the extracted text layer for the carrier's current content hash.
func (r *CarrierRepo) FindTextLayerByCarrierAndHash(ctx context.Context, carrierID int64, contentHash string) (*model.CarrierTextLayer, error) {
	var layer model.CarrierTextLayer
	err := r.db.GetContext(ctx, &layer,
		`SELECT * FROM atlas_carrier_text_layers WHERE carrier_id=$1 AND content_hash=$2 LIMIT 1`,
		carrierID,
		contentHash,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &layer, nil
}
