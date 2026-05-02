-- 回滚 000041：删除 profile 维度，回到 (post_id, model_id) 1:1 模型。
--
-- 安全性：删除 profile_id / chunk_index / chunk_text 列；恢复 (post_id, model_id)
-- UNIQUE。如果存量数据已经按 chunk 切过（每篇多行），降级会因 UNIQUE 冲突直接
-- 失败 —— 这是预期行为，admin 必须先把多 chunk 数据回卷成单文档向量再降级。
-- 出于安全考虑这里不主动 DELETE。

ALTER TABLE post_embeddings
    DROP CONSTRAINT IF EXISTS post_embeddings_unique;

ALTER TABLE post_embeddings
    ADD CONSTRAINT post_embeddings_post_id_model_id_key UNIQUE (post_id, model_id);

DROP INDEX IF EXISTS idx_post_emb_profile_status;

ALTER TABLE post_embeddings
    DROP COLUMN IF EXISTS chunk_text,
    DROP COLUMN IF EXISTS chunk_index,
    DROP COLUMN IF EXISTS profile_id;

DELETE FROM site_settings WHERE setting_key = 'search.active_profile_code';

DROP INDEX IF EXISTS uq_search_profiles_one_active;
DROP INDEX IF EXISTS idx_search_profiles_status;
DROP TABLE IF EXISTS search_profiles;
