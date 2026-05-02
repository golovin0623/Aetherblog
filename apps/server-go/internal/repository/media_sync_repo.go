package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// MediaSyncRepo 提供对 media_sync_jobs 表的数据访问能力,
// 配合 service.SyncService 完成 "本地 → 云" 单向镜像备份。
type MediaSyncRepo struct{ db *sqlx.DB }

// NewMediaSyncRepo 创建仓储实例。
func NewMediaSyncRepo(db *sqlx.DB) *MediaSyncRepo { return &MediaSyncRepo{db: db} }

// EnqueueOne 把指定 mediaID 入队为 PENDING 状态。
// 重复入队同一 (mediaID, targetProviderID) 不会报错(允许重试),但会复用最近一行 PENDING 的 attempt 计数。
func (r *MediaSyncRepo) EnqueueOne(ctx context.Context, mediaID, targetProviderID int64) (int64, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO media_sync_jobs (media_id, target_provider_id, status, attempt, created_at)
		VALUES ($1, $2, 'PENDING', 0, CURRENT_TIMESTAMP)
		RETURNING id`, mediaID, targetProviderID).Scan(&id)
	return id, err
}

// EnqueueAllUnsynced 找出所有 (storage_provider_id IS NULL OR storage_provider_id != targetProviderID)
// 且 sync_status NOT IN (SYNCING, SYNCED) 的非删除文件,批量插入 PENDING job。
// 返回入队的 job 数量。
//
// 注意: 主文件本身就在 targetProviderID 上的不需要镜像。已 SYNCED 的也跳过(防止重复传)。
// FAILED 的文件允许重新加入队列(给用户重试机会)。
func (r *MediaSyncRepo) EnqueueAllUnsynced(ctx context.Context, targetProviderID int64) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO media_sync_jobs (media_id, target_provider_id, status, attempt, created_at)
		SELECT id, $1, 'PENDING', 0, CURRENT_TIMESTAMP
		FROM media_files
		WHERE deleted = false
		  AND (storage_provider_id IS NULL OR storage_provider_id != $1)
		  AND sync_status NOT IN ('SYNCING', 'SYNCED')
		  AND id NOT IN (
		    SELECT media_id FROM media_sync_jobs
		    WHERE target_provider_id = $1 AND status IN ('PENDING', 'RUNNING')
		  )`, targetProviderID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// FindPendingBatch 拣 limit 条 PENDING job 并标 RUNNING (单事务,避免多 worker 抢)。
// 同时把对应 media_files.sync_status 改成 SYNCING 让前端能看到进度。
func (r *MediaSyncRepo) FindPendingBatch(ctx context.Context, limit int) ([]model.MediaSyncJob, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() // 失败时回滚;成功在 Commit 后空操作

	rows, err := tx.QueryxContext(ctx, `
		SELECT id, media_id, target_provider_id, status, attempt, last_error, created_at, started_at, finished_at
		FROM media_sync_jobs
		WHERE status = 'PENDING'
		ORDER BY created_at ASC
		LIMIT $1
		FOR UPDATE SKIP LOCKED`, limit)
	if err != nil {
		return nil, err
	}
	var jobs []model.MediaSyncJob
	for rows.Next() {
		var j model.MediaSyncJob
		if err := rows.StructScan(&j); err != nil {
			rows.Close()
			return nil, err
		}
		jobs = append(jobs, j)
	}
	rows.Close()

	if len(jobs) == 0 {
		return nil, tx.Commit()
	}

	ids := make([]int64, len(jobs))
	mediaIDs := make([]int64, len(jobs))
	for i, j := range jobs {
		ids[i] = j.ID
		mediaIDs[i] = j.MediaID
	}

	// 标 RUNNING + started_at
	q1, args1, err := sqlx.In(`UPDATE media_sync_jobs SET status='RUNNING', started_at=$1 WHERE id IN (?)`, time.Now(), ids)
	if err != nil {
		return nil, err
	}
	q1 = tx.Rebind(q1)
	if _, err := tx.ExecContext(ctx, q1, args1...); err != nil {
		return nil, err
	}
	q2, args2, err := sqlx.In(`UPDATE media_files SET sync_status='SYNCING' WHERE id IN (?)`, mediaIDs)
	if err != nil {
		return nil, err
	}
	q2 = tx.Rebind(q2)
	if _, err := tx.ExecContext(ctx, q2, args2...); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return jobs, nil
}

// MarkJobSucceeded 标记 job 成功 + 更新主文件备份字段。
func (r *MediaSyncRepo) MarkJobSucceeded(ctx context.Context, jobID, mediaID, targetProviderID int64, backupURL string) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now()
	if _, err := tx.ExecContext(ctx, `UPDATE media_sync_jobs SET status='SUCCEEDED', finished_at=$1 WHERE id=$2`, now, jobID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE media_files
		SET sync_status='SYNCED', backup_provider_id=$1, backup_url=$2, backup_at=$3, backup_error=NULL
		WHERE id=$4`, targetProviderID, backupURL, now, mediaID); err != nil {
		return err
	}
	return tx.Commit()
}

// MarkJobFailed 标记 job 失败,attempt < maxAttempt 时回退 PENDING(等待下次拣表),
// 否则标 FAILED + 主文件 sync_status=FAILED + backup_error 记录原因。
func (r *MediaSyncRepo) MarkJobFailed(ctx context.Context, jobID, mediaID int64, errMsg string, maxAttempt int) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var attempt int
	if err := tx.QueryRowContext(ctx, `UPDATE media_sync_jobs SET attempt=attempt+1, last_error=$1 WHERE id=$2 RETURNING attempt`, errMsg, jobID).Scan(&attempt); err != nil {
		return err
	}
	if attempt < maxAttempt {
		// 回退 PENDING,worker 下次拣表会重试
		if _, err := tx.ExecContext(ctx, `UPDATE media_sync_jobs SET status='PENDING' WHERE id=$1`, jobID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE media_files SET sync_status='PENDING' WHERE id=$1`, mediaID); err != nil {
			return err
		}
	} else {
		// 重试达上限,正式失败
		now := time.Now()
		if _, err := tx.ExecContext(ctx, `UPDATE media_sync_jobs SET status='FAILED', finished_at=$1 WHERE id=$2`, now, jobID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE media_files SET sync_status='FAILED', backup_error=$1 WHERE id=$2`, errMsg, mediaID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ResetRunningOnStartup 进程启动时把残留的 RUNNING 行重置回 PENDING。
// 否则上次进程崩溃留下的"幽灵任务"会一直占着 RUNNING 状态,worker 永远不重新拣它们。
func (r *MediaSyncRepo) ResetRunningOnStartup(ctx context.Context) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		UPDATE media_sync_jobs SET status='PENDING' WHERE status='RUNNING'`)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// SyncStatusCounts 聚合统计 worker 状态(供 GET /sync/status 端点)。
type SyncStatusCounts struct {
	Pending   int64 `db:"pending"`
	Running   int64 `db:"running"`
	Succeeded int64 `db:"succeeded"`
	Failed    int64 `db:"failed"`
}

// CountByStatus 返回 PENDING/RUNNING/SUCCEEDED/FAILED 各自的 job 数。
func (r *MediaSyncRepo) CountByStatus(ctx context.Context) (*SyncStatusCounts, error) {
	var c SyncStatusCounts
	err := r.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE status='PENDING')   AS pending,
			COUNT(*) FILTER (WHERE status='RUNNING')   AS running,
			COUNT(*) FILTER (WHERE status='SUCCEEDED') AS succeeded,
			COUNT(*) FILTER (WHERE status='FAILED')    AS failed
		FROM media_sync_jobs`).Scan(&c.Pending, &c.Running, &c.Succeeded, &c.Failed)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return &c, nil
		}
		return nil, err
	}
	return &c, nil
}

// ListFailed 返回最近 N 个 FAILED 任务,供前端"重试失败"列表使用。
func (r *MediaSyncRepo) ListFailed(ctx context.Context, limit int) ([]model.MediaSyncJob, error) {
	var jobs []model.MediaSyncJob
	err := r.db.SelectContext(ctx, &jobs, `
		SELECT id, media_id, target_provider_id, status, attempt, last_error, created_at, started_at, finished_at
		FROM media_sync_jobs
		WHERE status='FAILED'
		ORDER BY finished_at DESC NULLS LAST
		LIMIT $1`, limit)
	return jobs, err
}

// RetryFailed 把指定 jobIDs 重新置为 PENDING,attempt 归零,last_error 清空。
// 同时把主文件的 sync_status 改回 PENDING。
func (r *MediaSyncRepo) RetryFailed(ctx context.Context, jobIDs []int64) error {
	if len(jobIDs) == 0 {
		return nil
	}
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	q1, args1, err := sqlx.In(`UPDATE media_sync_jobs SET status='PENDING', attempt=0, last_error=NULL, finished_at=NULL WHERE id IN (?) AND status='FAILED'`, jobIDs)
	if err != nil {
		return err
	}
	q1 = tx.Rebind(q1)
	if _, err := tx.ExecContext(ctx, q1, args1...); err != nil {
		return err
	}
	// 同步把主文件状态改回 PENDING(注意 media_id 取自 job 表)
	q2, args2, err := sqlx.In(`UPDATE media_files SET sync_status='PENDING', backup_error=NULL WHERE id IN (SELECT media_id FROM media_sync_jobs WHERE id IN (?))`, jobIDs)
	if err != nil {
		return err
	}
	q2 = tx.Rebind(q2)
	if _, err := tx.ExecContext(ctx, q2, args2...); err != nil {
		return err
	}
	return tx.Commit()
}
