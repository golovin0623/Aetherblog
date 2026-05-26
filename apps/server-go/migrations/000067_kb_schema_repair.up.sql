-- 000067: 知识库（KB）schema 幂等修复。
--
-- 背景 / 事故：KB 迁移块在 commit 8a70196 被整体 +3 重新编号
--   （000055_knowledge_bases → 000058_knowledge_bases，
--     000058_kb_embedding_hnsw → 000061_kb_embedding_hnsw 等）。
--   golang-migrate 只在 schema_migrations 里记录一个整数 version，对「同一槽位
--   文件内容已变」无感知。任何在重编号前/期间 version ledger 已越过 58、或
--   backend 镜像被带外更新（手工 `docker compose up -d` 绕过 deploy.sh 的
--   pre-deploy `migrate up`）的环境，槽位 58 的新内容（创建 knowledge_bases）
--   永远不会被执行 —— 生产因此报 `relation "knowledge_bases" does not exist`
--   （admin /api/v1/admin/kbs → kb_repo.go ListAll）。
--
-- 修复策略：本前向迁移把 000058+000059+000060+000061 收敛后的 KB 最终 schema
--   用 `IF NOT EXISTS` / `ON CONFLICT` / catalog 守卫**幂等**重建。
--     * 槽位被跳过的环境：在此补齐缺失的表 / 索引 / 约束 / seed。
--     * 已正确迁移的环境：每条语句都是 no-op。
--   遵循本项目既有的「前向修复迁移」惯例（参见 deploy.sh 关于 000036/000039 的注释）。
--
-- 注意：kb_embeddings.embedding 直接建为不锁维度的 `vector`（000060 收敛后的
--   形态），避免再走一次 ALTER。已存在的表由 000060 早已转换，IF NOT EXISTS 跳过。

-- ============================================================
-- 1. knowledge_bases —— 知识库主表（active_profile_id FK 延后到 kb_profiles 之后）
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge_bases (
    id BIGSERIAL PRIMARY KEY,
    slug VARCHAR(120) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    icon VARCHAR(50) DEFAULT 'Library',
    color VARCHAR(20) DEFAULT '#6366f1',
    cover_image VARCHAR(500),
    kind VARCHAR(20) NOT NULL DEFAULT 'CUSTOM'
        CHECK (kind IN ('CUSTOM', 'SYSTEM_POSTS')),
    owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    visibility VARCHAR(20) NOT NULL DEFAULT 'PRIVATE'
        CHECK (visibility IN ('PRIVATE', 'TEAM', 'PUBLIC')),
    folder_id BIGINT REFERENCES media_folders(id) ON DELETE SET NULL,
    active_profile_id BIGINT,
    file_count INT NOT NULL DEFAULT 0,
    chunk_count INT NOT NULL DEFAULT 0,
    vectorized_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kb_owner ON knowledge_bases(owner_id);
CREATE INDEX IF NOT EXISTS idx_kb_kind ON knowledge_bases(kind);
CREATE INDEX IF NOT EXISTS idx_kb_visibility ON knowledge_bases(visibility);

-- ============================================================
-- 2. kb_profiles —— 每 KB 独立的索引/检索配置
-- ============================================================
CREATE TABLE IF NOT EXISTS kb_profiles (
    id BIGSERIAL PRIMARY KEY,
    kb_id BIGINT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    model_id VARCHAR(120) NOT NULL,
    chunker_kind VARCHAR(32) NOT NULL
        CHECK (chunker_kind IN ('recursive', 'fixed', 'markdown', 'qa', 'parent_child')),
    chunk_size_tokens INT NOT NULL DEFAULT 512
        CHECK (chunk_size_tokens > 0 AND chunk_size_tokens <= 8192),
    chunk_overlap_tokens INT NOT NULL DEFAULT 64
        CHECK (chunk_overlap_tokens >= 0),
    top_k INT NOT NULL DEFAULT 6 CHECK (top_k > 0 AND top_k <= 50),
    score_threshold NUMERIC(4, 3) NOT NULL DEFAULT 0.200,
    status VARCHAR(20) NOT NULL DEFAULT 'shadow'
        CHECK (status IN ('active', 'shadow', 'deprecated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_kb_profile_code UNIQUE (kb_id, code),
    CONSTRAINT chk_kb_profile_overlap CHECK (chunk_overlap_tokens < chunk_size_tokens)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_profile_one_active
    ON kb_profiles(kb_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_kb_profile_status ON kb_profiles(kb_id, status);

-- knowledge_bases.active_profile_id 的 FK —— Postgres 不支持 ADD CONSTRAINT
-- IF NOT EXISTS，用 catalog 守卫。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE con.conname = 'fk_kb_active_profile' AND rel.relname = 'knowledge_bases'
    ) THEN
        ALTER TABLE knowledge_bases
            ADD CONSTRAINT fk_kb_active_profile
            FOREIGN KEY (active_profile_id) REFERENCES kb_profiles(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================================
-- 3. kb_members —— KB 成员授权
-- ============================================================
CREATE TABLE IF NOT EXISTS kb_members (
    id BIGSERIAL PRIMARY KEY,
    kb_id BIGINT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    principal_type VARCHAR(20) NOT NULL
        CHECK (principal_type IN ('USER', 'TEAM', 'ROLE')),
    principal_id BIGINT NOT NULL,
    permission_level VARCHAR(20) NOT NULL
        CHECK (permission_level IN ('VIEW', 'USE', 'EDIT', 'MANAGE')),
    granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ,
    CONSTRAINT uq_kb_member UNIQUE (kb_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_members_principal ON kb_members(principal_type, principal_id);
CREATE INDEX IF NOT EXISTS idx_kb_members_kb_level ON kb_members(kb_id, permission_level);

-- ============================================================
-- 4. kb_files —— KB 内文件记录
-- ============================================================
CREATE TABLE IF NOT EXISTS kb_files (
    id BIGSERIAL PRIMARY KEY,
    kb_id BIGINT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    media_file_id BIGINT REFERENCES media_files(id) ON DELETE CASCADE,
    post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
    category VARCHAR(50),
    title VARCHAR(255),
    source_url VARCHAR(500),
    doc_chars INT,
    doc_tokens INT,
    chunk_count INT NOT NULL DEFAULT 0,
    vector_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (vector_status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'STALE')),
    vector_error TEXT,
    vector_profile_id BIGINT REFERENCES kb_profiles(id) ON DELETE SET NULL,
    vectorized_at TIMESTAMPTZ,
    attempt_count INT NOT NULL DEFAULT 0,
    archived_year INT,
    archived_month INT,
    archived_day INT,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_kb_files_media UNIQUE (kb_id, media_file_id),
    CONSTRAINT uq_kb_files_post UNIQUE (kb_id, post_id),
    CONSTRAINT chk_kb_files_source CHECK (
        (media_file_id IS NOT NULL AND post_id IS NULL) OR
        (media_file_id IS NULL AND post_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_kb_files_kb_status ON kb_files(kb_id, vector_status);
CREATE INDEX IF NOT EXISTS idx_kb_files_kb_date
    ON kb_files(kb_id, archived_year, archived_month, archived_day);
CREATE INDEX IF NOT EXISTS idx_kb_files_kb_category ON kb_files(kb_id, category);
CREATE INDEX IF NOT EXISTS idx_kb_files_media ON kb_files(media_file_id);
CREATE INDEX IF NOT EXISTS idx_kb_files_post ON kb_files(post_id);

-- ============================================================
-- 5. kb_embeddings —— KB 文件的 chunk 向量表（embedding 列不锁维度）
-- ============================================================
CREATE TABLE IF NOT EXISTS kb_embeddings (
    id BIGSERIAL PRIMARY KEY,
    kb_file_id BIGINT NOT NULL REFERENCES kb_files(id) ON DELETE CASCADE,
    kb_id BIGINT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    profile_id BIGINT NOT NULL REFERENCES kb_profiles(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    chunk_text TEXT NOT NULL,
    parent_text TEXT,
    embedding vector,
    embedding_dim INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'shadow'
        CHECK (status IN ('active', 'shadow', 'deprecated')),
    token_count INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_kb_emb UNIQUE (kb_file_id, profile_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_kb_emb_profile_status ON kb_embeddings(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_emb_kb_status ON kb_embeddings(kb_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_emb_kb_file ON kb_embeddings(kb_file_id);

-- 维度桶 partial HNSW 索引（与 000061 一致）
CREATE INDEX IF NOT EXISTS idx_kb_emb_1536_active ON kb_embeddings
    USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 1536 AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_kb_emb_3072_active ON kb_embeddings
    USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 3072 AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_kb_emb_1024_active ON kb_embeddings
    USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 1024 AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_kb_emb_768_active ON kb_embeddings
    USING hnsw ((embedding::vector(768)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding_dim = 768 AND status = 'active';

-- ============================================================
-- 6. Seed: 文章索引库（SYSTEM_POSTS）+ 默认 active profile
--    （收敛 000058 seed + 000059 default profile，整体幂等）
-- ============================================================
INSERT INTO knowledge_bases (
    slug, name, description, kind, visibility, icon, color, owner_id
)
VALUES (
    'posts',
    '文章索引库',
    '博客已发布文章自动构成的系统级知识库。由 posts 同步生成，不接受上传；'
    '可在此重建向量索引、查看分块状态与失败原因。',
    'SYSTEM_POSTS', 'PUBLIC', 'BookOpen', '#34D399', NULL
)
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE
    posts_kb_id BIGINT;
    active_profile BIGINT;
    target_model VARCHAR(120);
BEGIN
    SELECT id INTO posts_kb_id FROM knowledge_bases WHERE slug = 'posts' LIMIT 1;
    IF posts_kb_id IS NULL THEN
        RAISE NOTICE 'knowledge_bases.posts row missing, skip seeding default profile';
        RETURN;
    END IF;

    -- 健康 / 用户已自定义的环境：posts KB 已有一个 active profile（可能是 default，
    -- 也可能是用户晋升的其他 profile）。此时绝不强制把 default 置回 active ——
    -- 否则会撞 uq_kb_profile_one_active 唯一约束、令本修复迁移在健康库上反而中止。
    SELECT id INTO active_profile
        FROM kb_profiles WHERE kb_id = posts_kb_id AND status = 'active' LIMIT 1;

    IF active_profile IS NULL THEN
        -- 仅当当前没有任何 active profile（被跳过槽位的破损环境）才补默认 profile。
        SELECT COALESCE(
            NULLIF((SELECT setting_value FROM site_settings
                    WHERE setting_key = 'search.active_embedding_model'), ''),
            (SELECT m.model_id FROM ai_task_routing r
                JOIN ai_models m ON m.id = r.primary_model_id
                JOIN ai_task_types t ON t.id = r.task_type_id
                WHERE t.code = 'embedding' LIMIT 1),
            'text-embedding-3-large'
        ) INTO target_model;

        INSERT INTO kb_profiles (
            kb_id, code, name, description, model_id, chunker_kind,
            chunk_size_tokens, chunk_overlap_tokens, top_k, score_threshold, status
        )
        VALUES (
            posts_kb_id,
            'default',
            '默认 · 递归 Markdown 切片',
            '按 H1/H2 标题 → 段落 → 句子递归切分；超过 chunk_size_tokens 回退到 token 级硬切。'
            '相邻 chunk 之间保留 chunk_overlap_tokens token 重叠以防边界丢失上下文。'
            'chunk_size=512, overlap=64，对 Markdown 友好。',
            target_model,
            'recursive', 512, 64,
            6, 0.200,
            'active'
        )
        ON CONFLICT (kb_id, code) DO UPDATE SET status = 'active'
        RETURNING id INTO active_profile;
    END IF;

    -- 仅在 active_profile_id 缺失时回填，尊重用户可能的自定义指向。
    IF active_profile IS NOT NULL THEN
        UPDATE knowledge_bases
            SET active_profile_id = active_profile
            WHERE id = posts_kb_id AND active_profile_id IS NULL;
    END IF;
END $$;
