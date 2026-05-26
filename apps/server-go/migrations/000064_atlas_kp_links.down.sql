-- 回滚 000064。
DROP TABLE IF EXISTS atlas_relation_evidence;
DROP TABLE IF EXISTS atlas_annotation_kp_links;
ALTER TABLE atlas_knowledge_points ALTER COLUMN uuid DROP DEFAULT;
