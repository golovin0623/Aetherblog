-- 回滚 000058：删除按 dim 的 partial HNSW 索引。
DROP INDEX IF EXISTS idx_kb_emb_768_active;
DROP INDEX IF EXISTS idx_kb_emb_1024_active;
DROP INDEX IF EXISTS idx_kb_emb_3072_active;
DROP INDEX IF EXISTS idx_kb_emb_1536_active;
