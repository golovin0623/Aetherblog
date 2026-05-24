-- ============================================================
-- Intelligent Notes
-- ============================================================
-- 后台私有「智能笔记」内容域。它不是 posts 的子类型, 也不会进入前台公开路由。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS note_folders (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    parent_id BIGINT REFERENCES note_folders(id) ON DELETE SET NULL,
    sort_order INT NOT NULL DEFAULT 100,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_note_folders_name_nonempty CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS idx_note_folders_parent_sort
    ON note_folders(parent_id, sort_order, name)
    WHERE deleted = false;

CREATE TABLE IF NOT EXISTS note_tags (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL UNIQUE,
    color VARCHAR(20) NOT NULL DEFAULT '#64748B',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_note_tags_name_nonempty CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS notes (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL DEFAULT '',
    content_markdown TEXT NOT NULL DEFAULT '',
    summary TEXT,
    folder_id BIGINT REFERENCES note_folders(id) ON DELETE SET NULL,
    author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    source_type VARCHAR(30) NOT NULL DEFAULT 'manual',
    source_url TEXT,
    source_title VARCHAR(300),
    source_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    word_count INT NOT NULL DEFAULT 0,
    embedding_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    last_opened_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_notes_not_empty CHECK (btrim(title) <> '' OR btrim(content_markdown) <> ''),
    CONSTRAINT chk_notes_source_type CHECK (source_type IN ('manual', 'web', 'article', 'chat', 'import', 'api')),
    CONSTRAINT chk_notes_embedding_status CHECK (embedding_status IN ('PENDING', 'INDEXED', 'FAILED', 'SKIPPED'))
);

CREATE INDEX IF NOT EXISTS idx_notes_author_updated
    ON notes(author_id, updated_at DESC)
    WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_notes_folder_updated
    ON notes(folder_id, updated_at DESC)
    WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_notes_archived_updated
    ON notes(archived, updated_at DESC)
    WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_notes_pinned_updated
    ON notes(is_pinned DESC, updated_at DESC)
    WHERE deleted = false AND archived = false;

CREATE INDEX IF NOT EXISTS idx_notes_source_type
    ON notes(source_type)
    WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_notes_fulltext
    ON notes USING gin (
        to_tsvector('simple', left(title || ' ' || COALESCE(summary, '') || ' ' || COALESCE(content_markdown, ''), 200000))
    );

CREATE TABLE IF NOT EXISTS note_tag_links (
    note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES note_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_note_tag_links_tag
    ON note_tag_links(tag_id, note_id);

CREATE TABLE IF NOT EXISTS note_links (
    id BIGSERIAL PRIMARY KEY,
    source_note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    target_note_id BIGINT REFERENCES notes(id) ON DELETE SET NULL,
    target_title VARCHAR(200) NOT NULL,
    link_text VARCHAR(200) NOT NULL,
    position_start INT,
    position_end INT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_note_links_target_title_nonempty CHECK (btrim(target_title) <> ''),
    CONSTRAINT chk_note_links_link_text_nonempty CHECK (btrim(link_text) <> '')
);

CREATE INDEX IF NOT EXISTS idx_note_links_source
    ON note_links(source_note_id);

CREATE INDEX IF NOT EXISTS idx_note_links_target
    ON note_links(target_note_id);

CREATE INDEX IF NOT EXISTS idx_note_links_target_title
    ON note_links(target_title);

CREATE TABLE IF NOT EXISTS note_embeddings (
    id BIGSERIAL PRIMARY KEY,
    note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    profile_id BIGINT REFERENCES search_profiles(id) ON DELETE SET NULL,
    chunk_index INT NOT NULL DEFAULT 0,
    chunk_text TEXT NOT NULL,
    parent_text TEXT,
    embedding vector,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_note_embeddings_status CHECK (status IN ('PENDING', 'INDEXED', 'FAILED', 'SKIPPED')),
    CONSTRAINT chk_note_embeddings_chunk_text_nonempty CHECK (btrim(chunk_text) <> '')
);

CREATE INDEX IF NOT EXISTS idx_note_emb_note_status
    ON note_embeddings(note_id, status);

CREATE INDEX IF NOT EXISTS idx_note_emb_profile_status
    ON note_embeddings(profile_id, status);

INSERT INTO permissions (code, module, action, name, description) VALUES
    ('content.notes.manage', 'content', 'notes.manage', '管理智能笔记', '创建、编辑、归档和删除智能笔记')
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    action = EXCLUDED.action,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'content.notes.manage'
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;
