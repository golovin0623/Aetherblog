-- V2_1__add_media_folders.sql
-- Phase 1: 文件夹层级管理
-- ref: 媒体库深度优化方案 - Phase 1

-- 创建文件夹表
CREATE TABLE media_folders (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    parent_id BIGINT REFERENCES media_folders(id) ON DELETE CASCADE,
    path VARCHAR(1000) NOT NULL,  -- 物化路径: /root/design/icons
    depth INT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,

    -- 元数据
    color VARCHAR(20) DEFAULT '#6366f1',
    icon VARCHAR(50) DEFAULT 'Folder',
    cover_image VARCHAR(500),

    -- 权限
    owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    visibility VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',

    -- 统计 (缓存)
    file_count INT NOT NULL DEFAULT 0,
    total_size BIGINT NOT NULL DEFAULT 0,

    -- 时间戳
    created_by BIGINT REFERENCES users(id),
    updated_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_folder_visibility CHECK (visibility IN ('PRIVATE', 'TEAM', 'PUBLIC')),
    CONSTRAINT uq_folder_path UNIQUE (path)
);

-- 创建索引
CREATE INDEX idx_media_folders_parent ON media_folders(parent_id);
CREATE INDEX idx_media_folders_path ON media_folders(path);
CREATE INDEX idx_media_folders_owner ON media_folders(owner_id);
CREATE INDEX idx_media_folders_visibility ON media_folders(visibility);
CREATE INDEX idx_media_folders_created_at ON media_folders(created_at);

-- 扩展 media_files 表
ALTER TABLE media_files
    ADD COLUMN folder_id BIGINT REFERENCES media_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_media_files_folder ON media_files(folder_id);

-- 创建默认根文件夹
INSERT INTO media_folders (id, name, slug, path, depth, sort_order, visibility)
VALUES (1, 'Root', 'root', '/root', 0, 0, 'PRIVATE');

-- 重置序列（确保下一个ID从2开始）
SELECT setval('media_folders_id_seq', 1, true);
