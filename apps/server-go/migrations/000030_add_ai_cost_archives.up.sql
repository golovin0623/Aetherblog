-- AI 费用归档：支持归档后读取快照、归档失败回退实时计算

ALTER TABLE ai_usage_logs
    ADD COLUMN IF NOT EXISTS cost_archive_status VARCHAR(16) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS cost_archive_amount NUMERIC(16, 8),
    ADD COLUMN IF NOT EXISTS cost_archived_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS cost_archive_error TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_ai_usage_logs_cost_archive_status'
    ) THEN
        ALTER TABLE ai_usage_logs
            ADD CONSTRAINT chk_ai_usage_logs_cost_archive_status
            CHECK (cost_archive_status IN ('pending', 'archived', 'failed'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_cost_archive_status_created
    ON ai_usage_logs(cost_archive_status, created_at DESC);
