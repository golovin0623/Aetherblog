DROP INDEX IF EXISTS idx_ai_usage_logs_cost_archive_status_created;

ALTER TABLE ai_usage_logs
    DROP CONSTRAINT IF EXISTS chk_ai_usage_logs_cost_archive_status;

ALTER TABLE ai_usage_logs
    DROP COLUMN IF EXISTS cost_archive_error,
    DROP COLUMN IF EXISTS cost_archived_at,
    DROP COLUMN IF EXISTS cost_archive_amount,
    DROP COLUMN IF EXISTS cost_archive_status;
