-- V2_5__add_permissions_and_sharing.sql
-- Phase 5: 协作与权限
-- ref: 媒体库深度优化方案 - Phase 5

CREATE TABLE folder_permissions (
    id BIGSERIAL PRIMARY KEY,
    folder_id BIGINT REFERENCES media_folders(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    permission_level VARCHAR(20) NOT NULL,
    granted_by BIGINT REFERENCES users(id),
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,

    CONSTRAINT chk_permission_level CHECK (permission_level IN ('VIEW', 'UPLOAD', 'EDIT', 'DELETE', 'ADMIN')),
    CONSTRAINT uq_folder_user_permission UNIQUE (folder_id, user_id)
);

CREATE INDEX idx_folder_permissions_folder ON folder_permissions(folder_id);
CREATE INDEX idx_folder_permissions_user ON folder_permissions(user_id);

CREATE TABLE media_shares (
    id BIGSERIAL PRIMARY KEY,
    share_token VARCHAR(64) NOT NULL UNIQUE,
    media_file_id BIGINT REFERENCES media_files(id) ON DELETE CASCADE,
    folder_id BIGINT REFERENCES media_folders(id) ON DELETE CASCADE,
    share_type VARCHAR(20) NOT NULL,
    access_type VARCHAR(20) NOT NULL DEFAULT 'VIEW',
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    access_count INT NOT NULL DEFAULT 0,
    max_access_count INT,
    password_hash VARCHAR(255),

    CONSTRAINT chk_share_type CHECK (share_type IN ('FILE', 'FOLDER')),
    CONSTRAINT chk_access_type CHECK (access_type IN ('VIEW', 'DOWNLOAD')),
    CONSTRAINT chk_share_target CHECK (
        (media_file_id IS NOT NULL AND folder_id IS NULL) OR
        (media_file_id IS NULL AND folder_id IS NOT NULL)
    )
);

CREATE INDEX idx_media_shares_token ON media_shares(share_token);
CREATE INDEX idx_media_shares_file ON media_shares(media_file_id);
CREATE INDEX idx_media_shares_folder ON media_shares(folder_id);

CREATE TABLE media_versions (
    id BIGSERIAL PRIMARY KEY,
    media_file_id BIGINT REFERENCES media_files(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_url VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    change_description TEXT,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_media_version UNIQUE (media_file_id, version_number)
);

CREATE INDEX idx_media_versions_file ON media_versions(media_file_id);
CREATE INDEX idx_media_versions_created ON media_versions(created_at DESC);

ALTER TABLE media_files
    ADD COLUMN current_version INT NOT NULL DEFAULT 1,
    ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN archived_at TIMESTAMP,
    ADD COLUMN archived_by BIGINT REFERENCES users(id);

CREATE INDEX idx_media_files_archived ON media_files(is_archived);
