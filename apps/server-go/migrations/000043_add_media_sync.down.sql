-- 000043_add_media_sync.down.sql

DELETE FROM site_settings WHERE setting_key = 'storage.sync.auto_enabled';

DROP INDEX IF EXISTS idx_media_sync_jobs_media_id;
DROP INDEX IF EXISTS idx_media_sync_jobs_status_created;
DROP TABLE IF EXISTS media_sync_jobs;

DROP INDEX IF EXISTS idx_media_files_sync_status;
ALTER TABLE media_files
    DROP CONSTRAINT IF EXISTS chk_media_sync_status;
ALTER TABLE media_files
    DROP COLUMN IF EXISTS backup_error,
    DROP COLUMN IF EXISTS backup_at,
    DROP COLUMN IF EXISTS backup_url,
    DROP COLUMN IF EXISTS backup_provider_id,
    DROP COLUMN IF EXISTS sync_status;
