package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jmoiron/sqlx"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/cryptkey"
)

// StorageProviderRepo 提供对 storage_providers 表的数据访问能力。
//
// 加密(VULN 防御 / 对象存储 rollout 遗留 1):
//   - Create/Update 写入前对整段 config_json 用 cryptkey.Keystore 加密
//     (带 enc:v1: 前缀,见 cryptkey.EncryptedPrefix);
//   - Find* 读取时按前缀检测,加密的解密、明文的(legacy)透传;
//   - 没配 AI_CREDENTIAL_ENCRYPTION_KEYS 时 Keystore 退化为透传,所有
//     读写均按明文处理 — 这让 dev/CI 环境无需密钥配置也能跑。
type StorageProviderRepo struct {
	db       *sqlx.DB
	keystore *cryptkey.Keystore
}

// NewStorageProviderRepo 创建一个由指定数据库连接支撑的 StorageProviderRepo 实例。
//
// keystore 默认从 cryptkey.Default() 读取(进程级单例);测试可注入定制。
func NewStorageProviderRepo(db *sqlx.DB) *StorageProviderRepo {
	return &StorageProviderRepo{db: db, keystore: cryptkey.Default()}
}

// NewStorageProviderRepoWithKeystore 显式传入 keystore,主要供测试。
func NewStorageProviderRepoWithKeystore(db *sqlx.DB, ks *cryptkey.Keystore) *StorageProviderRepo {
	return &StorageProviderRepo{db: db, keystore: ks}
}

// encryptConfig 把明文 config_json 加密成 enc:v1: 形态准备落库。
// keystore 未启用时透传明文。
func (r *StorageProviderRepo) encryptConfig(plain string) (string, error) {
	if r.keystore == nil {
		return plain, nil
	}
	return r.keystore.EncryptString(plain)
}

// decryptConfig 把 stored 形态(可能加密、可能 legacy 明文)解出明文。
//
// 容错: 解密失败时返回原始 stored 字符串 + log warning。这是为了避免一行坏数据
// 让整个 storage_providers 列表加载失败 — admin 仍能在 UI 中看到这一行(虽然 secret
// 字段乱码),从而手动修复或重建。
func (r *StorageProviderRepo) decryptConfig(stored string) string {
	if r.keystore == nil {
		return stored
	}
	plain, err := r.keystore.DecryptString(stored)
	if err != nil {
		log.Warn().Err(err).Msg("storage provider config decryption failed; returning ciphertext as-is")
		return stored
	}
	return plain
}

// applyDecrypt 给 model.StorageProvider 做就地解密(in-place)。
func (r *StorageProviderRepo) applyDecrypt(p *model.StorageProvider) {
	if p == nil {
		return
	}
	p.ConfigJSON = r.decryptConfig(p.ConfigJSON)
}

// requireEncryption 在 Create/Update 拒绝接收已经带前缀的 JSON 串(防止上层错误重复加密)。
func (r *StorageProviderRepo) requireEncryption(plain string) (string, error) {
	if cryptkey.IsEncrypted(plain) {
		return "", fmt.Errorf("config_json must be plaintext at repository boundary, got enc:v1: prefix")
	}
	return r.encryptConfig(plain)
}

// FindAll 返回所有存储提供商，按 priority 升序后按 id 升序排列。
// 操作表：storage_providers；priority 越小优先级越高。
//
// config_json 在返回前自动解密(legacy 明文行透传)。
func (r *StorageProviderRepo) FindAll(ctx context.Context) ([]model.StorageProvider, error) {
	var ps []model.StorageProvider
	err := r.db.SelectContext(ctx, &ps, `SELECT * FROM storage_providers ORDER BY priority ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	for i := range ps {
		r.applyDecrypt(&ps[i])
	}
	return ps, nil
}

// FindByID 根据主键查询单个存储提供商，不存在时返回 nil。
// 操作表：storage_providers；参数 id 为提供商主键。
//
// config_json 在返回前自动解密。
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
	r.applyDecrypt(&p)
	return &p, nil
}

// FindDefault 返回当前标记为默认且处于启用状态的存储提供商，不存在时返回 nil。
// 操作表：storage_providers；过滤条件：is_default = true AND is_enabled = true。
//
// config_json 在返回前自动解密。
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
	r.applyDecrypt(&p)
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
//
// req.ConfigJSON 必须是明文。本方法在落库前调 keystore 加密。
func (r *StorageProviderRepo) Create(ctx context.Context, req StorageProviderRequest) (*model.StorageProvider, error) {
	encConfig, err := r.requireEncryption(req.ConfigJSON)
	if err != nil {
		return nil, err
	}
	var p model.StorageProvider
	err = r.db.QueryRowContext(ctx, `
		INSERT INTO storage_providers (name, provider_type, config_json, is_enabled, priority)
		VALUES ($1,$2,$3,$4,$5) RETURNING *`,
		req.Name, req.ProviderType, encConfig, req.IsEnabled, req.Priority,
	).Scan(&p.ID, &p.Name, &p.ProviderType, &p.ConfigJSON, &p.IsDefault, &p.IsEnabled, &p.Priority, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	// 返回的实体里 config_json 还是密文 — 解密回明文供上层使用
	r.applyDecrypt(&p)
	return &p, nil
}

// Update 修改指定存储提供商的配置字段。
// 操作表：storage_providers；参数 id 为提供商主键，req 包含所有可更新字段。
//
// req.ConfigJSON 必须是明文。本方法在落库前调 keystore 加密。
func (r *StorageProviderRepo) Update(ctx context.Context, id int64, req StorageProviderRequest) error {
	encConfig, err := r.requireEncryption(req.ConfigJSON)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `
		UPDATE storage_providers SET name=$1, provider_type=$2, config_json=$3, is_enabled=$4, priority=$5 WHERE id=$6`,
		req.Name, req.ProviderType, encConfig, req.IsEnabled, req.Priority, id)
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

// MigrateLegacyToEncrypted 扫描所有 storage_providers 行,把不带 enc:v1: 前缀的
// legacy 明文 config_json 一次性加密落库。返回 (migrated, total)。
//
// 触发时机:
//   - 启动时由 server.go 在 keystore.Enabled() 为 true 时调用一次(自动);
//   - admin 也可以通过 API 强制触发。
//
// 幂等:已经加密的行自动跳过(EncryptString 检测到前缀直接返回原值)。
// keystore.Enabled()=false 时整体 no-op。
func (r *StorageProviderRepo) MigrateLegacyToEncrypted(ctx context.Context) (int, int, error) {
	if r.keystore == nil || !r.keystore.Enabled() {
		return 0, 0, nil
	}
	rows, err := r.db.QueryContext(ctx, `SELECT id, config_json FROM storage_providers`)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()

	type legacyRow struct {
		id     int64
		config string
	}
	var pending []legacyRow
	total := 0
	for rows.Next() {
		var lr legacyRow
		if err := rows.Scan(&lr.id, &lr.config); err != nil {
			return 0, 0, err
		}
		total++
		if !cryptkey.IsEncrypted(lr.config) {
			pending = append(pending, lr)
		}
	}
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}

	migrated := 0
	for _, lr := range pending {
		enc, err := r.keystore.EncryptString(lr.config)
		if err != nil {
			log.Warn().Err(err).Int64("id", lr.id).Msg("encrypt legacy config_json failed")
			continue
		}
		if _, err := r.db.ExecContext(ctx, `UPDATE storage_providers SET config_json=$1 WHERE id=$2`, enc, lr.id); err != nil {
			log.Warn().Err(err).Int64("id", lr.id).Msg("write encrypted config_json failed")
			continue
		}
		migrated++
	}
	return migrated, total, nil
}

// LookupCatalogByKeys 反查 keys 在 media_files 中(限定 storage_provider_id=providerID)的 ID 映射。
// @ref 对象存储 rollout - Phase 5
func (r *StorageProviderRepo) LookupCatalogByKeys(ctx context.Context, providerID int64, keys []string) (map[string]int64, error) {
	if len(keys) == 0 {
		return map[string]int64{}, nil
	}
	q, args, err := sqlx.In(`SELECT id, file_path FROM media_files WHERE storage_provider_id = ? AND file_path IN (?) AND deleted = false`, providerID, keys)
	if err != nil {
		return nil, err
	}
	q = r.db.Rebind(q)
	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]int64)
	for rows.Next() {
		var id int64
		var key string
		if err := rows.Scan(&id, &key); err != nil {
			return nil, err
		}
		out[key] = id
	}
	return out, nil
}

// ImportedMediaRow 是 Phase 5 反向导入时新增 media_files 行所需的字段集。
type ImportedMediaRow struct {
	Filename          string
	OriginalName      string
	FilePath          string
	FileURL           string
	FileSize          int64
	MimeType          string
	FileType          string
	StorageType       string
	StorageProviderID int64
	CdnURL            string
	UploaderID        *int64
}

// InsertImportedMedia 写一条新 media_files 行,字段直接来源于 Phase 5 反向导入流程。
func (r *StorageProviderRepo) InsertImportedMedia(ctx context.Context, row ImportedMediaRow) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO media_files (
			filename, original_name, file_path, file_url, file_size,
			mime_type, file_type, storage_type, uploader_id, storage_provider_id, cdn_url
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		row.Filename, row.OriginalName, row.FilePath, row.FileURL, row.FileSize,
		row.MimeType, row.FileType, row.StorageType, row.UploaderID, row.StorageProviderID, row.CdnURL)
	return err
}
