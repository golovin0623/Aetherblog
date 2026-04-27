-- 为 media_files 表添加 deleted 列
ALTER TABLE media_files ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE media_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- 为 deleted 列添加 index
CREATE INDEX IF NOT EXISTS idx_media_files_deleted ON media_files(deleted);
