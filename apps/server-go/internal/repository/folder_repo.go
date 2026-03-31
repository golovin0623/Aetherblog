package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// FolderRepo 负责对 media_folders 表进行数据访问操作。
type FolderRepo struct{ db *sqlx.DB }

// NewFolderRepo 创建一个使用给定数据库连接的 FolderRepo 实例。
func NewFolderRepo(db *sqlx.DB) *FolderRepo { return &FolderRepo{db: db} }

// FindByID 从 media_folders 表按主键查询单个文件夹，若不存在则返回 nil。
func (r *FolderRepo) FindByID(ctx context.Context, id int64) (*model.MediaFolder, error) {
	var f model.MediaFolder
	err := r.db.GetContext(ctx, &f, `SELECT * FROM media_folders WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &f, nil
}

// FindAll 从 media_folders 表返回所有文件夹，按层级深度（depth）升序、排序值（sort_order）升序、名称升序排列。
func (r *FolderRepo) FindAll(ctx context.Context) ([]model.MediaFolder, error) {
	var fs []model.MediaFolder
	err := r.db.SelectContext(ctx, &fs, `SELECT * FROM media_folders ORDER BY depth ASC, sort_order ASC, name ASC`)
	return fs, err
}

// FindChildren 从 media_folders 表返回指定父文件夹的所有直接子文件夹，按 sort_order 升序、name 升序排列。
func (r *FolderRepo) FindChildren(ctx context.Context, parentID int64) ([]model.MediaFolder, error) {
	var fs []model.MediaFolder
	err := r.db.SelectContext(ctx, &fs, `SELECT * FROM media_folders WHERE parent_id=$1 ORDER BY sort_order ASC, name ASC`, parentID)
	return fs, err
}

// FolderRequest 持有创建或更新媒体文件夹时的可变字段。
type FolderRequest struct {
	Name        string  // 文件夹名称
	Description *string // 描述（可选）
	ParentID    *int64  // 父文件夹 ID，nil 表示根文件夹
	Color       *string // 标识颜色（可选）
	Icon        *string // 图标标识（可选）
	Visibility  string  // 可见性（如 PUBLIC / PRIVATE）
	OwnerID     *int64  // 所属用户 ID
}

// Create 向 media_folders 表插入新文件夹，自动根据父文件夹计算 path（路径）和 depth（层级深度），
// 使用 RETURNING * 回填完整行数据。
func (r *FolderRepo) Create(ctx context.Context, req FolderRequest) (*model.MediaFolder, error) {
	slug := slugifySimple(req.Name)
	// 根据父文件夹信息计算当前文件夹的路径和层级
	path, depth := r.computePathDepth(ctx, req.ParentID, slug)

	var f model.MediaFolder
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO media_folders (name, slug, description, parent_id, path, depth, color, icon, visibility, owner_id, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING *`,
		req.Name, slug, req.Description, req.ParentID, path, depth,
		req.Color, req.Icon, req.Visibility, req.OwnerID, req.OwnerID,
	).Scan(
		&f.ID, &f.Name, &f.Slug, &f.Description, &f.ParentID, &f.Path, &f.Depth, &f.SortOrder,
		&f.Color, &f.Icon, &f.CoverImage, &f.OwnerID, &f.Visibility, &f.FileCount, &f.TotalSize,
		&f.CreatedBy, &f.UpdatedBy, &f.CreatedAt, &f.UpdatedAt,
	)
	return &f, err
}

// Update 修改 media_folders 表中指定文件夹的展示属性（name、description、color、icon、visibility），
// 同时更新 updated_by 字段记录操作人。
func (r *FolderRepo) Update(ctx context.Context, id int64, req FolderRequest) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE media_folders SET name=$1, description=$2, color=$3, icon=$4, visibility=$5, updated_by=$6 WHERE id=$7`,
		req.Name, req.Description, req.Color, req.Icon, req.Visibility, req.OwnerID, id)
	return err
}

// Delete 从 media_folders 表中永久删除指定文件夹（物理删除）。
func (r *FolderRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_folders WHERE id=$1`, id)
	return err
}

// Move 将指定文件夹移动到新的父文件夹下，重新计算其 path 和 depth，并记录操作人（updated_by）。
// newParentID 为 nil 时，目标为根级别。
func (r *FolderRepo) Move(ctx context.Context, id int64, newParentID *int64, updatedBy *int64) error {
	// 先获取当前文件夹的 slug，用于重新构建路径
	slug := ""
	if err := r.db.QueryRowContext(ctx, `SELECT slug FROM media_folders WHERE id=$1`, id).Scan(&slug); err != nil {
		return err
	}
	path, depth := r.computePathDepth(ctx, newParentID, slug)
	_, err := r.db.ExecContext(ctx, `UPDATE media_folders SET parent_id=$1, path=$2, depth=$3, updated_by=$4 WHERE id=$5`,
		newParentID, path, depth, updatedBy, id)
	return err
}

// computePathDepth 根据父文件夹信息计算子文件夹的 path 和 depth。
// 若 parentID 为 nil，则路径等于 slug，深度为 0（根级别）。
// 否则查询父文件夹的 path 和 depth，拼接为 "parentPath/slug"，深度加 1。
func (r *FolderRepo) computePathDepth(ctx context.Context, parentID *int64, slug string) (string, int) {
	if parentID == nil {
		// 根文件夹：路径即为 slug，深度为 0
		return slug, 0
	}
	var parentPath string
	var parentDepth int
	if err := r.db.QueryRowContext(ctx, `SELECT path, depth FROM media_folders WHERE id=$1`, *parentID).
		Scan(&parentPath, &parentDepth); err != nil {
		// 查询父文件夹失败时降级处理，将该文件夹视为根文件夹
		return slug, 0
	}
	return parentPath + "/" + slug, parentDepth + 1
}

// slugifySimple 将文件夹名称转换为 URL 友好的 slug。
// 仅保留小写字母和数字，空格/连字符/下划线统一替换为连字符，并去除首尾连字符。
// 若结果为空，则回退为 "folder-{原始字符串长度}"。
func slugifySimple(s string) string {
	s = strings.ToLower(s)
	var sb strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			sb.WriteRune(r)
		} else if r == ' ' || r == '-' || r == '_' {
			sb.WriteRune('-')
		}
		// 其他字符（如中文、特殊符号）直接丢弃
	}
	result := strings.Trim(sb.String(), "-")
	if result == "" {
		// 名称全部由非 ASCII 字符组成时的兜底处理
		result = fmt.Sprintf("folder-%d", len(s))
	}
	return result
}
