-- 000043_add_media_sync.up.sql
-- Phase 4 of object storage rollout — 本地→云的单向镜像备份机制。
--
-- 字段语义:
--   sync_status      — 主文件 vs default provider 的镜像状态
--                      NONE     主文件已在 default provider,无需再备份(默认值)
--                      PENDING  已加入备份队列,worker 拣到后即开始
--                      SYNCING  当前批次正在传输
--                      SYNCED   备份完成 + backup_url 可访问
--                      FAILED   重试达上限 (默认 3),需要人工干预
--   backup_*         — 备份成功后的目标 provider / URL / 时间
--   backup_error     — 最近一次失败原因(供前端展示 "查看错误")
--
-- media_sync_jobs — 工作队列,worker 拣 PENDING -> RUNNING 处理 -> SUCCEEDED/FAILED。
--                   用 (status, created_at) 复合索引让 worker 拣表 O(log N)。
--                   重启时 RUNNING 行会被 worker 启动钩子重置回 PENDING(防"幽灵任务")。

ALTER TABLE media_files
    ADD COLUMN IF NOT EXISTS sync_status VARCHAR(16) NOT NULL DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS backup_provider_id BIGINT REFERENCES storage_providers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS backup_url VARCHAR(500),
    ADD COLUMN IF NOT EXISTS backup_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS backup_error TEXT;

ALTER TABLE media_files
    DROP CONSTRAINT IF EXISTS chk_media_sync_status;
ALTER TABLE media_files
    ADD CONSTRAINT chk_media_sync_status CHECK (sync_status IN ('NONE', 'PENDING', 'SYNCING', 'SYNCED', 'FAILED'));

CREATE INDEX IF NOT EXISTS idx_media_files_sync_status ON media_files(sync_status) WHERE sync_status != 'NONE';

CREATE TABLE IF NOT EXISTS media_sync_jobs (
    id BIGSERIAL PRIMARY KEY,
    media_id BIGINT NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    target_provider_id BIGINT NOT NULL REFERENCES storage_providers(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempt INT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,

    CONSTRAINT chk_media_sync_jobs_status CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_media_sync_jobs_status_created ON media_sync_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_media_sync_jobs_media_id ON media_sync_jobs(media_id);

-- site_settings 中的备份开关 (Phase 4 全局 auto)
-- 注意:列名为 setting_key/setting_value/setting_type/group_name (与 000002 / 000031 等迁移一致)
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('storage.sync.auto_enabled', 'false', 'BOOLEAN', 'storage', '是否启用自动后台备份(关闭时仅响应手动 API 触发)')
ON CONFLICT (setting_key) DO NOTHING;
