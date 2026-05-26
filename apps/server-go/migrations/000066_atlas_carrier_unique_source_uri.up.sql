-- 000066: 在 atlas_carriers 加 source_uri UNIQUE 约束
--
-- PR #724 review fix (Codex P1):
--   GetOrCreateForNote 之前是 read-then-insert 模式，无锁；并发首次打开同一 note 会同时
--   miss FindBySourceURI 并各自创建一行 carrier，破坏 source_uri 的"逻辑唯一"语义。
--   本 migration 把这个语义从应用层下沉到 schema —— DB 直接拒绝重复行，
--   配合 service 层 INSERT ... ON CONFLICT (source_uri) DO NOTHING 即可幂等。
--
-- 安全性：当前阶段 atlas_carriers 行数极少且来自 admin 手动操作，不会有真实重复。
-- 如果未来出现重复，需要先跑数据迁移合并/去重再加约束。

ALTER TABLE atlas_carriers
    ADD CONSTRAINT uq_atlas_carriers_source_uri UNIQUE (source_uri);
