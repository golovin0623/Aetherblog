-- 000048_add_backup_verification.up.sql
-- 对象存储 rollout - Phase 5: 备份完整性校验
--
-- 故事:
--   Phase 4 让 LOCAL 文件能镜像备份到云端,但备份后没有"反向校验"机制 ——
--   admin 在云控制台手动删了某 bucket key, DB 里仍然显示 SYNCED, 信息陈旧。
--   本迁移引入:
--     1) sync_status 加新值 MISSING (区分"备份过但云端已不在")
--     2) media_files.last_verified_at: 上次校验通过时间, worker 用它做 due-time 调度
--     3) site_settings 两条新键: 自动校验开关 + 校验间隔(秒)
--
-- 字段语义:
--   sync_status 'MISSING' 表示曾经 SYNCED, 但 verify worker HEAD 不到对象。
--   修复路径: 详情页"重新备份"按钮触发 EnqueueOne (主文件还在 LOCAL/cloud, 走标准同步)。
--
--   last_verified_at NULL 表示从未校验, 加索引让 worker SELECT WHERE last_verified_at IS NULL
--   OR last_verified_at < NOW() - interval 高效。
--
--   storage.verify.auto_enabled  默认 false (开发环境不打扰; 上线后由 admin 手动打开)
--   storage.verify.interval_seconds 默认 86400 (一天一次, 单位秒方便和 ticker 对齐)

-- 1. 扩展 sync_status 检查约束
ALTER TABLE media_files DROP CONSTRAINT IF EXISTS chk_media_sync_status;
ALTER TABLE media_files ADD CONSTRAINT chk_media_sync_status
    CHECK (sync_status IN ('NONE', 'PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'MISSING'));

-- 2. 加 last_verified_at 列 + 索引
ALTER TABLE media_files
    ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMP;

-- 部分索引: 只索引 SYNCED 行(占少数), worker 拣表 O(log N)。
-- NULLS FIRST 保证从未校验的行优先被拣到。
CREATE INDEX IF NOT EXISTS idx_media_files_verify_due
    ON media_files (last_verified_at NULLS FIRST)
    WHERE sync_status = 'SYNCED';

-- 3. site_settings 默认值
INSERT INTO site_settings (setting_key, setting_value, setting_type, group_name, description) VALUES
    ('storage.verify.auto_enabled', 'false', 'BOOLEAN', 'storage', '是否启用定期备份完整性校验(关闭时仅响应手动 API 触发)'),
    ('storage.verify.interval_seconds', '86400', 'NUMBER', 'storage', '校验间隔(秒);决定 worker 多久重新检查一条 SYNCED 记录')
ON CONFLICT (setting_key) DO NOTHING;
