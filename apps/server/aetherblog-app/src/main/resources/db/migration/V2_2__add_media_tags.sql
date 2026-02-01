-- V2_2__add_media_tags.sql
-- Phase 2: 智能标签系统
-- ref: 媒体库深度优化方案 - Phase 2

-- 创建标签表
CREATE TABLE media_tags (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    slug VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    color VARCHAR(20) DEFAULT '#6366f1',
    category VARCHAR(20) DEFAULT 'CUSTOM',
    usage_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_tag_category CHECK (category IN ('CUSTOM', 'AI_DETECTED', 'SYSTEM'))
);

CREATE INDEX idx_media_tags_slug ON media_tags(slug);
CREATE INDEX idx_media_tags_usage ON media_tags(usage_count DESC);
CREATE INDEX idx_media_tags_category ON media_tags(category);

-- 创建文件-标签关联表
CREATE TABLE media_file_tags (
    media_file_id BIGINT REFERENCES media_files(id) ON DELETE CASCADE,
    tag_id BIGINT REFERENCES media_tags(id) ON DELETE CASCADE,
    tagged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tagged_by BIGINT REFERENCES users(id),
    source VARCHAR(20) DEFAULT 'MANUAL',

    PRIMARY KEY (media_file_id, tag_id),
    CONSTRAINT chk_tag_source CHECK (source IN ('MANUAL', 'AI_AUTO', 'AI_SUGGESTED'))
);

CREATE INDEX idx_media_file_tags_file ON media_file_tags(media_file_id);
CREATE INDEX idx_media_file_tags_tag ON media_file_tags(tag_id);
CREATE INDEX idx_media_file_tags_source ON media_file_tags(source);

-- 创建自定义元数据表
CREATE TABLE media_metadata (
    id BIGSERIAL PRIMARY KEY,
    media_file_id BIGINT REFERENCES media_files(id) ON DELETE CASCADE,
    meta_key VARCHAR(100) NOT NULL,
    meta_value TEXT,
    meta_type VARCHAR(20) DEFAULT 'STRING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_media_metadata UNIQUE (media_file_id, meta_key),
    CONSTRAINT chk_meta_type CHECK (meta_type IN ('STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'JSON'))
);

CREATE INDEX idx_media_metadata_file ON media_metadata(media_file_id);
CREATE INDEX idx_media_metadata_key ON media_metadata(meta_key);

-- 插入一些默认系统标签
INSERT INTO media_tags (name, slug, category, color) VALUES
('重要', 'important', 'SYSTEM', '#ef4444'),
('草稿', 'draft', 'SYSTEM', '#f59e0b'),
('已发布', 'published', 'SYSTEM', '#10b981'),
('存档', 'archived', 'SYSTEM', '#6b7280');
