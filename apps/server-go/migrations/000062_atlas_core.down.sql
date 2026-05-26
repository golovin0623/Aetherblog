-- 回滚 000062：删除 Atlas 核心 5 张表。
--
-- 安全性：所有表都是新增的，没有现有数据依赖；CASCADE 链:
--   atlas_typed_relations -> atlas_knowledge_points
--   atlas_annotations -> atlas_carrier_versions -> atlas_carriers
-- 该操作不可逆，但 Phase 0 期间数据为空，回滚成本几乎为零。

DROP TABLE IF EXISTS atlas_typed_relations;
DROP TABLE IF EXISTS atlas_annotations;
DROP TABLE IF EXISTS atlas_carrier_versions;
DROP TABLE IF EXISTS atlas_knowledge_points;
DROP TABLE IF EXISTS atlas_carriers;
