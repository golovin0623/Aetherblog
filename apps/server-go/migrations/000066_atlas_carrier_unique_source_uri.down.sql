-- 回滚 000066：移除 source_uri UNIQUE 约束
ALTER TABLE atlas_carriers
    DROP CONSTRAINT IF EXISTS uq_atlas_carriers_source_uri;
