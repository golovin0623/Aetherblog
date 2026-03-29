-- V2_4__add_media_variants.sql
-- Phase 4: 图像处理
-- ref: 媒体库深度优化方案 - Phase 4

CREATE TABLE media_variants (
    id BIGSERIAL PRIMARY KEY,
    media_file_id BIGINT REFERENCES media_files(id) ON DELETE CASCADE,
    variant_type VARCHAR(20) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_url VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    width INT,
    height INT,
    format VARCHAR(20),
    quality INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_variant_type CHECK (variant_type IN ('THUMBNAIL', 'SMALL', 'MEDIUM', 'LARGE', 'WEBP', 'AVIF', 'ORIGINAL')),
    CONSTRAINT uq_media_variant UNIQUE (media_file_id, variant_type)
);

CREATE INDEX idx_media_variants_file ON media_variants(media_file_id);
CREATE INDEX idx_media_variants_type ON media_variants(variant_type);

ALTER TABLE media_files
    ADD COLUMN blurhash VARCHAR(100),
    ADD COLUMN exif_data JSONB,
    ADD COLUMN ai_labels JSONB;

CREATE INDEX idx_media_files_ai_labels ON media_files USING GIN(ai_labels);
