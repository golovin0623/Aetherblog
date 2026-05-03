-- 000042_align_storage_provider_types.up.sql
-- Phase 1 of object storage rollout:
--   1. 把 storage_providers.provider_type 的 CHECK 约束扩展到 R2(原来只允许 LOCAL/S3/MINIO/OSS/COS,
--      但 factory.go 早就接受 R2 字符串,造成创建 R2 provider 必败 → "violates check constraint")。
--   2. 同步把 media_files.storage_type 的 CHECK 约束扩展到 R2,否则 R2 provider 虽能创建但上传落库失败。
--   3. 给 media_variants 表加 storage_provider_id 列,后续 S3 模式下生成缩略图后写入对应 provider 的 key,
--      与主文件保持同源,删除时按 provider 反查统一清理。

ALTER TABLE storage_providers DROP CONSTRAINT IF EXISTS chk_provider_type;
ALTER TABLE storage_providers
    ADD CONSTRAINT chk_provider_type CHECK (provider_type IN ('LOCAL', 'S3', 'MINIO', 'OSS', 'COS', 'R2'));

ALTER TABLE media_files DROP CONSTRAINT IF EXISTS chk_media_storage_type;
ALTER TABLE media_files
    ADD CONSTRAINT chk_media_storage_type CHECK (storage_type IN ('LOCAL', 'MINIO', 'COS', 'OSS', 'S3', 'R2'));

ALTER TABLE media_variants
    ADD COLUMN IF NOT EXISTS storage_provider_id BIGINT REFERENCES storage_providers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_media_variants_storage_provider ON media_variants(storage_provider_id);
