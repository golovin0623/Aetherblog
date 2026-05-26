-- 回滚 000057：删除 is_system / undeletable 列，删除系统 KB 根目录。
--
-- 安全性：删除 _system_kb 目录会级联失败（如果有 media_files / 子目录依赖它）。
-- 这是预期行为 —— 必须先把 KB 数据迁出后才能 down。

DELETE FROM media_folders WHERE path = '/root/_system_kb' AND depth = 1;

DROP INDEX IF EXISTS idx_media_folders_is_system;

ALTER TABLE media_folders
    DROP COLUMN IF EXISTS undeletable,
    DROP COLUMN IF EXISTS is_system;
