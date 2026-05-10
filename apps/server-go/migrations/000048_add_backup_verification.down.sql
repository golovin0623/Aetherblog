-- 000048_add_backup_verification.down.sql
-- 回滚备份完整性校验相关的 schema 改动。

-- 1. 删 site_settings 默认值
DELETE FROM site_settings WHERE setting_key IN (
    'storage.verify.auto_enabled',
    'storage.verify.interval_seconds'
);

-- 2. 删索引和列
DROP INDEX IF EXISTS idx_media_files_verify_due;
ALTER TABLE media_files DROP COLUMN IF EXISTS last_verified_at;

-- 3. 把 MISSING 行回退到 FAILED + 描述 (避免约束收紧时数据违规)
UPDATE media_files SET sync_status='FAILED', backup_error=COALESCE(backup_error, 'rollback from MISSING')
    WHERE sync_status='MISSING';

-- 4. 收紧约束回到 Phase 4 集合
ALTER TABLE media_files DROP CONSTRAINT IF EXISTS chk_media_sync_status;
ALTER TABLE media_files ADD CONSTRAINT chk_media_sync_status
    CHECK (sync_status IN ('NONE', 'PENDING', 'SYNCING', 'SYNCED', 'FAILED'));
