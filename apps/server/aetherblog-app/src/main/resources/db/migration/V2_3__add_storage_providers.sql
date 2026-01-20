-- V2_3__add_storage_providers.sql
-- Phase 3: 云存储与CDN
-- ref: 媒体库深度优化方案 - Phase 3

CREATE TABLE storage_providers (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    provider_type VARCHAR(20) NOT NULL,
    config_json TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    priority INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_provider_type CHECK (provider_type IN ('LOCAL', 'S3', 'MINIO', 'OSS', 'COS'))
);

CREATE INDEX idx_storage_providers_default ON storage_providers(is_default);
CREATE INDEX idx_storage_providers_enabled ON storage_providers(is_enabled);

ALTER TABLE media_files
    ADD COLUMN storage_provider_id BIGINT REFERENCES storage_providers(id) ON DELETE SET NULL,
    ADD COLUMN cdn_url VARCHAR(500);

CREATE INDEX idx_media_files_storage_provider ON media_files(storage_provider_id);

INSERT INTO storage_providers (name, provider_type, config_json, is_default, is_enabled)
VALUES ('Local Storage', 'LOCAL', '{"basePath":"./uploads","urlPrefix":"/uploads"}', TRUE, TRUE);
