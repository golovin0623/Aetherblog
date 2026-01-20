-- Add deleted column to media_files table
ALTER TABLE media_files ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE media_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Add index for deleted column
CREATE INDEX IF NOT EXISTS idx_media_files_deleted ON media_files(deleted);
