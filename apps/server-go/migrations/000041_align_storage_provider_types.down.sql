-- 000041_align_storage_provider_types.down.sql
-- 撤销 R2 + media_variants.storage_provider_id 的引入。
-- 注意: 若已存在 R2 provider 行,回滚会因 CHECK 约束被拒绝 — 需先 DELETE。

DROP INDEX IF EXISTS idx_media_variants_storage_provider;
ALTER TABLE media_variants DROP COLUMN IF EXISTS storage_provider_id;

ALTER TABLE storage_providers DROP CONSTRAINT IF EXISTS chk_provider_type;
ALTER TABLE storage_providers
    ADD CONSTRAINT chk_provider_type CHECK (provider_type IN ('LOCAL', 'S3', 'MINIO', 'OSS', 'COS'));
