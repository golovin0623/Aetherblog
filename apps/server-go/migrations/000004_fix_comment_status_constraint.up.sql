-- 修正评论状态 check constraint，使其包含 'DELETED'
ALTER TABLE comments DROP CONSTRAINT IF EXISTS chk_comments_status;
ALTER TABLE comments ADD CONSTRAINT chk_comments_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SPAM', 'DELETED'));
