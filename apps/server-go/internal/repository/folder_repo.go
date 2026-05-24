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

// FolderListOptions 持有 FindAll/FindChildren 的可选过滤项。
// 默认零值（IncludeSystem=false）表示过滤掉 is_system=TRUE 的目录 —— 媒体页与
// 文件夹树的所有 UI 入口都用此默认；KB 等内部模块显式传 IncludeSystem=true 才
// 能读到 _system_kb 子树。
type FolderListOptions struct {
	IncludeSystem bool
}

// FindAll 从 media_folders 表返回所有文件夹，按层级深度（depth）升序、排序值（sort_order）升序、名称升序排列。
// 默认排除 is_system=TRUE 的目录；传入 opts.IncludeSystem=true 时返回全部。
func (r *FolderRepo) FindAll(ctx context.Context, opts ...FolderListOptions) ([]model.MediaFolder, error) {
	opt := mergeFolderListOptions(opts)
	var fs []model.MediaFolder
	query := `SELECT * FROM media_folders`
	if !opt.IncludeSystem {
		query += ` WHERE is_system = FALSE`
	}
	query += ` ORDER BY depth ASC, sort_order ASC, name ASC`
	err := r.db.SelectContext(ctx, &fs, query)
	return fs, err
}

// FindChildren 从 media_folders 表返回指定父文件夹的所有直接子文件夹，按 sort_order 升序、name 升序排列。
// 默认排除 is_system=TRUE 的子目录。
func (r *FolderRepo) FindChildren(ctx context.Context, parentID int64, opts ...FolderListOptions) ([]model.MediaFolder, error) {
	opt := mergeFolderListOptions(opts)
	var fs []model.MediaFolder
	query := `SELECT * FROM media_folders WHERE parent_id=$1`
	if !opt.IncludeSystem {
		query += ` AND is_system = FALSE`
	}
	query += ` ORDER BY sort_order ASC, name ASC`
	err := r.db.SelectContext(ctx, &fs, query, parentID)
	return fs, err
}

// FindByPath 按物化路径（如 "/root/_system_kb/<slug>"）查询单个目录，
// 不存在时返回 nil。包含 is_system 目录（path 是唯一键，本就不应过滤）。
func (r *FolderRepo) FindByPath(ctx context.Context, path string) (*model.MediaFolder, error) {
	var f model.MediaFolder
	err := r.db.GetContext(ctx, &f, `SELECT * FROM media_folders WHERE path=$1`, path)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &f, nil
}

func mergeFolderListOptions(opts []FolderListOptions) FolderListOptions {
	if len(opts) == 0 {
		return FolderListOptions{}
	}
	return opts[0]
}

// FolderRequest 持有创建或更新媒体文件夹时的可变字段。
type FolderRequest struct {
	Name        string  // 文件夹名称
	Slug        string  // 显式 slug（用于系统目录，绕过 slugifySimple 对中文/特殊字符的丢弃）
	Description *string // 描述（可选）
	ParentID    *int64  // 父文件夹 ID，nil 表示根文件夹
	Color       *string // 标识颜色（可选）
	Icon        *string // 图标标识（可选）
	Visibility  string  // 可见性（如 PUBLIC / PRIVATE）
	OwnerID     *int64  // 所属用户 ID
	IsSystem    bool    // 系统目录标记（仅 KB 等内部模块写 TRUE）
	Undeletable bool    // 不可删除标记
}

// Create 向 media_folders 表插入新文件夹，自动根据父文件夹计算 path（路径）和 depth（层级深度），
// 然后调用 FindByID 回填完整行（避免 RETURNING * 的列序耦合）。
func (r *FolderRepo) Create(ctx context.Context, req FolderRequest) (*model.MediaFolder, error) {
	slug := req.Slug
	if slug == "" {
		slug = slugifySimple(req.Name)
	}
	// 根据父文件夹信息计算当前文件夹的路径和层级
	path, depth := r.computePathDepth(ctx, req.ParentID, slug)

	var id int64
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO media_folders (name, slug, description, parent_id, path, depth, color, icon, visibility, owner_id, created_by, is_system, undeletable)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12)
		RETURNING id`,
		req.Name, slug, req.Description, req.ParentID, path, depth,
		req.Color, req.Icon, req.Visibility, req.OwnerID,
		req.IsSystem, req.Undeletable,
	).Scan(&id)
	if err != nil {
		return nil, err
	}
	return r.FindByID(ctx, id)
}

// EnsureFolderByPath 按 segments 自顶向下递归确保目录存在，返回叶子目录。
// 用法示例：EnsureFolderByPath(ctx, []string{"_system_kb", "my-kb", "2026", "05", "24"}, nil, true, false)
// → 在 root(id=1) 下逐级 FindByPath / 缺失则 Create；返回叶子目录。
//
// 设计：
//   - 起点固定为 root（id=1，path="/root"）。segments 不包含 "root"。
//   - 所有中间目录与叶子目录共用同一 ownerID / isSystem / undeletable 标志位 ——
//     KB 子树全部 owner=NULL / is_system=TRUE，便于查询时按 path 前缀或 is_system 过滤。
//   - 幂等：已存在的中间目录直接复用，不会因为时区 / 重复请求产生重复行。
//   - 并发安全：依赖 media_folders.path UNIQUE 约束兜底；INSERT 冲突时 fall back
//     到 FindByPath（实现里通过 23505 / pq.Error 判断；此处直接重试一次 FindByPath 即可）。
func (r *FolderRepo) EnsureFolderByPath(ctx context.Context, segments []string, ownerID *int64, isSystem, undeletable bool) (*model.MediaFolder, error) {
	if len(segments) == 0 {
		// 起点 = root
		return r.FindByID(ctx, 1)
	}
	root, err := r.FindByID(ctx, 1)
	if err != nil {
		return nil, fmt.Errorf("root folder lookup failed: %w", err)
	}
	if root == nil {
		return nil, errors.New("media_folders.id=1 (root) missing")
	}

	parent := root
	path := root.Path // "/root"
	for _, seg := range segments {
		nextPath := path + "/" + seg
		existing, err := r.FindByPath(ctx, nextPath)
		if err != nil {
			return nil, fmt.Errorf("find folder by path %q: %w", nextPath, err)
		}
		if existing != nil {
			parent = existing
			path = nextPath
			continue
		}
		// 不存在则创建。子目录继承父的可见性/标志位，name == slug 简化路径与名一致。
		parentID := parent.ID
		created, err := r.Create(ctx, FolderRequest{
			Name:        seg,
			Slug:        seg,
			ParentID:    &parentID,
			Visibility:  parent.Visibility,
			OwnerID:     ownerID,
			IsSystem:    isSystem,
			Undeletable: undeletable,
		})
		if err != nil {
			// 可能是并发竞争另一个调用先建好了；再查一次。
			retry, retryErr := r.FindByPath(ctx, nextPath)
			if retryErr == nil && retry != nil {
				parent = retry
				path = nextPath
				continue
			}
			return nil, fmt.Errorf("create folder segment %q: %w", seg, err)
		}
		parent = created
		path = nextPath
	}
	return parent, nil
}

// Update 修改 media_folders 表中指定文件夹的展示属性（name、description、color、icon、visibility），
// 同时更新 updated_by 字段记录操作人。
func (r *FolderRepo) Update(ctx context.Context, id int64, req FolderRequest) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE media_folders SET name=$1, description=$2, color=$3, icon=$4, visibility=$5, updated_by=$6 WHERE id=$7`,
		req.Name, req.Description, req.Color, req.Icon, req.Visibility, req.OwnerID, id)
	return err
}

// ErrFolderUndeletable 表示该文件夹被 undeletable 标记保护。
var ErrFolderUndeletable = errors.New("该文件夹受保护不可删除")

// Delete 从 media_folders 表中永久删除指定文件夹（物理删除）。
// undeletable=TRUE 的目录会被拒绝；其余按主键直接 DELETE。
func (r *FolderRepo) Delete(ctx context.Context, id int64) error {
	var undeletable bool
	if err := r.db.QueryRowContext(ctx, `SELECT undeletable FROM media_folders WHERE id=$1`, id).Scan(&undeletable); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	if undeletable {
		return ErrFolderUndeletable
	}
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
