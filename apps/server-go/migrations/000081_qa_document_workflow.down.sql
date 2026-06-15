-- 回滚试卷智能拆题闭环（按依赖逆序，幂等）
DROP TABLE IF EXISTS qa_audit_logs;
DROP TABLE IF EXISTS qa_questions;
DROP TABLE IF EXISTS qa_document_diffs;
DROP TABLE IF EXISTS qa_patches;
DROP TABLE IF EXISTS qa_annotations;
DROP TABLE IF EXISTS qa_doc_blocks;
DROP TABLE IF EXISTS qa_document_versions;
DROP TABLE IF EXISTS qa_document_jobs;
DROP TABLE IF EXISTS qa_documents;
