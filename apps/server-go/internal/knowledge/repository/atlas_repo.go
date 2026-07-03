// Package repository 是 Atlas 域的数据访问层。
//
// Phase 0 只提供构造函数与 Ping 用的最小查询，CRUD 由 Phase 1 起按子域填充
// （载体仓库/注释仓库/kp_仓库/关系仓库）。
package repository

import (
	"context"

	"github.com/jmoiron/sqlx"
)

// AtlasRepo 聚合 Atlas 子域的所有 Repo 入口。Phase 0 阶段仅持有 *sqlx.DB，
// 后续阶段引入分子 Repo 时按需暴露 getter（避免一次性接口爆炸）。
type AtlasRepo struct {
	db *sqlx.DB
}

// NewAtlasRepo 创建 AtlasRepo。
func NewAtlasRepo(db *sqlx.DB) *AtlasRepo {
	return &AtlasRepo{db: db}
}

// Ping 给 handler health 路径用，验证 atlas_carriers 表存在且可读。
// 使用 count(*) 而不是 SELECT 1 ... LIMIT 0 —— 后者在 sqlx.GetContext 下会触发
// sql.ErrNoRows，把存在的表误判为缺失。
func (r *AtlasRepo) Ping(ctx context.Context) error {
	var n int
	return r.db.GetContext(ctx, &n, "SELECT count(*) FROM atlas_carriers")
}
