-- 回滚 000055：删除知识库相关 5 张表。
--
-- 安全性：CASCADE 会一起删除依赖的 kb_files / kb_embeddings / kb_profiles / kb_members。
-- 该操作不可逆。先 down 前需要确认所有 CUSTOM 库的物理文件已迁出（media_files 不受影响）。

ALTER TABLE knowledge_bases DROP CONSTRAINT IF EXISTS fk_kb_active_profile;

DROP TABLE IF EXISTS kb_embeddings;
DROP TABLE IF EXISTS kb_files;
DROP TABLE IF EXISTS kb_members;
DROP TABLE IF EXISTS kb_profiles;
DROP TABLE IF EXISTS knowledge_bases;
