-- 000055: 知识库（Knowledge Base）核心 schema。
--
-- 背景：灵境（AetherHub）现有的 @文章 / #标签 picker 只能引用已发布博文，无法
-- 覆盖用户自有资料（文档/手册/笔记/外部材料）。本 migration 落地"知识库"能力：
--   * 用户创建多个 KB，上传文件后自动向量化
--   * 灵境对话时勾选若干 KB，对应内容按语义召回并注入 prompt
--   * 现有 posts/post_embeddings 作为 kind=SYSTEM_POSTS 的「文章索引库」首次
--     纳入统一 KB 治理界面（块数 / 状态 / 失败原因 / 重建索引）
--   * 每个 KB 拥有独立 kb_profiles（model+chunker+chunk_size+overlap+top_k+threshold）
--   * 权限 = 所有者 + kb_members（USER/TEAM/ROLE 三种 principal，VIEW/USE/EDIT/MANAGE 四级）
--
-- 设计对齐：
--   * search_profiles（000041）—— kb_profiles 复用蓝绿切换的 partial unique index
--     约束 status='active'。
--   * post_embeddings（000034 / 000041 / 000044）—— kb_embeddings 复用 (file_id,
--     profile_id, chunk_index) UNIQUE + parent_text 父段方案。
--   * content_shares（000051）—— 与之并存而非合并：KB 是一等公民（带 owner /
--     folder 的工作空间），不是 content_shares 的"资源"语义。
--
-- 兼容性：纯新增 5 张表 + seed 一行 SYSTEM_POSTS。无对现有表的 ALTER。

-- ============================================================
-- 1. knowledge_bases —— 知识库主表
-- ============================================================
CREATE TABLE knowledge_bases (
    id BIGSERIAL PRIMARY KEY,
    slug VARCHAR(120) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    icon VARCHAR(50) DEFAULT 'Library',
    color VARCHAR(20) DEFAULT '#6366f1',
    cover_image VARCHAR(500),

    -- 内置/用户库分类。SYSTEM_POSTS 是 seed 的「文章索引库」，由 posts/post_embeddings
    -- 实时聚合而成；CUSTOM 是用户在 admin UI 自建。
    kind VARCHAR(20) NOT NULL DEFAULT 'CUSTOM'
        CHECK (kind IN ('CUSTOM', 'SYSTEM_POSTS')),

    -- 所有者。SYSTEM_POSTS 库 owner_id 为 NULL，由系统管理员经 admin 角色访问。
    owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    visibility VARCHAR(20) NOT NULL DEFAULT 'PRIVATE'
        CHECK (visibility IN ('PRIVATE', 'TEAM', 'PUBLIC')),

    -- 物理文件的归档根目录。CUSTOM 库自动指向 /root/_system_kb/<slug>/。
    -- SYSTEM_POSTS 库 folder_id 为 NULL（不接受上传，文件来源是 posts）。
    folder_id BIGINT REFERENCES media_folders(id) ON DELETE SET NULL,

    -- 当前激活的 profile（运行检索/向量化用）。FK 在 kb_profiles 表创建后追加。
    active_profile_id BIGINT,

    -- 统计缓存（由 service 层维护，避免每次查询 join + count）
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

CREATE INDEX idx_kb_owner ON knowledge_bases(owner_id);
CREATE INDEX idx_kb_kind ON knowledge_bases(kind);
CREATE INDEX idx_kb_visibility ON knowledge_bases(visibility);

COMMENT ON TABLE knowledge_bases IS
    '知识库主表。CUSTOM 由用户自建，物理文件存于 media_files；SYSTEM_POSTS 是博客文章自动聚合的虚拟库。';
COMMENT ON COLUMN knowledge_bases.kind IS
    'CUSTOM = 用户自建（接受上传）；SYSTEM_POSTS = 文章索引库（不接受上传，由 posts 派生）。';

-- ============================================================
-- 2. kb_profiles —— 每 KB 独立的索引/检索配置
-- ============================================================
CREATE TABLE kb_profiles (
    id BIGSERIAL PRIMARY KEY,
    kb_id BIGINT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT,

    -- 向量化模型（与 ai_models.model_id 对齐）
    model_id VARCHAR(120) NOT NULL,

    -- 切片策略（与 chunker.py 实现对齐）
    chunker_kind VARCHAR(32) NOT NULL
        CHECK (chunker_kind IN ('recursive', 'fixed', 'markdown', 'qa', 'parent_child')),
    chunk_size_tokens INT NOT NULL DEFAULT 512
        CHECK (chunk_size_tokens > 0 AND chunk_size_tokens <= 8192),
    chunk_overlap_tokens INT NOT NULL DEFAULT 64
        CHECK (chunk_overlap_tokens >= 0),

    -- 召回参数
    top_k INT NOT NULL DEFAULT 6 CHECK (top_k > 0 AND top_k <= 50),
    score_threshold NUMERIC(4, 3) NOT NULL DEFAULT 0.200,

    -- 蓝绿切换状态（参照 search_profiles）
    status VARCHAR(20) NOT NULL DEFAULT 'shadow'
        CHECK (status IN ('active', 'shadow', 'deprecated')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_kb_profile_code UNIQUE (kb_id, code),
    CONSTRAINT chk_kb_profile_overlap CHECK (chunk_overlap_tokens < chunk_size_tokens)
);

-- 每个 KB 最多一行 status='active'，参照 search_profiles 的 partial unique index 模式。
CREATE UNIQUE INDEX uq_kb_profile_one_active
    ON kb_profiles(kb_id) WHERE status = 'active';

CREATE INDEX idx_kb_profile_status ON kb_profiles(kb_id, status);

-- 现在补 knowledge_bases.active_profile_id FK
ALTER TABLE knowledge_bases
    ADD CONSTRAINT fk_kb_active_profile
    FOREIGN KEY (active_profile_id) REFERENCES kb_profiles(id) ON DELETE SET NULL;

COMMENT ON TABLE kb_profiles IS
    '每个 KB 拥有的索引/检索配置档案，支持 model+chunker+chunk_size+overlap+top_k+threshold 组合。蓝绿切换与 search_profiles 同语义。';

-- ============================================================
-- 3. kb_members —— KB 成员授权（USER / TEAM / ROLE 三种 principal）
-- ============================================================
CREATE TABLE kb_members (
    id BIGSERIAL PRIMARY KEY,
    kb_id BIGINT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    principal_type VARCHAR(20) NOT NULL
        CHECK (principal_type IN ('USER', 'TEAM', 'ROLE')),
    principal_id BIGINT NOT NULL,

    -- VIEW   = 看到 KB 元数据与文件清单（不含原文）
    -- USE    = 在灵境对话中勾选使用
    -- EDIT   = 上传 / 删除文件，触发重建
    -- MANAGE = 管理 profile + 成员 + 删除 KB（owner 隐式有 MANAGE）
    permission_level VARCHAR(20) NOT NULL
        CHECK (permission_level IN ('VIEW', 'USE', 'EDIT', 'MANAGE')),

    granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ,

    CONSTRAINT uq_kb_member UNIQUE (kb_id, principal_type, principal_id)
);

CREATE INDEX idx_kb_members_principal ON kb_members(principal_type, principal_id);
CREATE INDEX idx_kb_members_kb_level ON kb_members(kb_id, permission_level);

COMMENT ON TABLE kb_members IS
    'KB 成员授权矩阵。principal_type=USER/TEAM/ROLE，permission_level 四级；owner 隐式 MANAGE 不入此表。';

-- ============================================================
-- 4. kb_files —— KB 内文件记录（引用 media_files 或 posts）
-- ============================================================
CREATE TABLE kb_files (
    id BIGSERIAL PRIMARY KEY,
    kb_id BIGINT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,

    -- CUSTOM 库走 media_file_id；SYSTEM_POSTS 库走 post_id。互斥。
    media_file_id BIGINT REFERENCES media_files(id) ON DELETE CASCADE,
    post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,

    -- 业务字段
    category VARCHAR(50),
    title VARCHAR(255),
    source_url VARCHAR(500),

    -- 文档维度（向量化后回写）
    doc_chars INT,
    doc_tokens INT,

    -- 向量化状态机
    chunk_count INT NOT NULL DEFAULT 0,
    vector_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (vector_status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'STALE')),
    vector_error TEXT,
    vector_profile_id BIGINT REFERENCES kb_profiles(id) ON DELETE SET NULL,
    vectorized_at TIMESTAMPTZ,
    attempt_count INT NOT NULL DEFAULT 0,

    -- 时间归档（便于按年月日聚合 / 时间轴查找）
    archived_year INT,
    archived_month INT,
    archived_day INT,

    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 同一 KB 内一个 media_file 只能出现一次
    CONSTRAINT uq_kb_files_media UNIQUE (kb_id, media_file_id),
    CONSTRAINT uq_kb_files_post UNIQUE (kb_id, post_id),
    CONSTRAINT chk_kb_files_source CHECK (
        (media_file_id IS NOT NULL AND post_id IS NULL) OR
        (media_file_id IS NULL AND post_id IS NOT NULL)
    )
);

CREATE INDEX idx_kb_files_kb_status ON kb_files(kb_id, vector_status);
CREATE INDEX idx_kb_files_kb_date
    ON kb_files(kb_id, archived_year, archived_month, archived_day);
CREATE INDEX idx_kb_files_kb_category ON kb_files(kb_id, category);
CREATE INDEX idx_kb_files_media ON kb_files(media_file_id);
CREATE INDEX idx_kb_files_post ON kb_files(post_id);

COMMENT ON TABLE kb_files IS
    'KB 文件清单。CUSTOM 库引用 media_files；SYSTEM_POSTS 引用 posts。vector_status 记录向量化生命周期。';

-- ============================================================
-- 5. kb_embeddings —— KB 文件的 chunk 向量表
-- ============================================================
CREATE TABLE kb_embeddings (
    id BIGSERIAL PRIMARY KEY,
    kb_file_id BIGINT NOT NULL REFERENCES kb_files(id) ON DELETE CASCADE,
    kb_id BIGINT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    profile_id BIGINT NOT NULL REFERENCES kb_profiles(id) ON DELETE CASCADE,

    chunk_index INT NOT NULL,
    chunk_text TEXT NOT NULL,
    parent_text TEXT,

    -- pgvector 列。最大维度 3072 覆盖 text-embedding-3-large；
    -- 实际维度由 embedding_dim 记录，HNSW 索引按 dim 桶 partial 创建。
    embedding vector(3072),
    embedding_dim INT NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'shadow'
        CHECK (status IN ('active', 'shadow', 'deprecated')),
    token_count INT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_kb_emb UNIQUE (kb_file_id, profile_id, chunk_index)
);

CREATE INDEX idx_kb_emb_profile_status ON kb_embeddings(profile_id, status);
CREATE INDEX idx_kb_emb_kb_status ON kb_embeddings(kb_id, status);
CREATE INDEX idx_kb_emb_kb_file ON kb_embeddings(kb_file_id);
-- HNSW 索引按 dim 桶在 ai-service 启动时按需 partial 创建（沿用 post_embeddings 策略）

COMMENT ON TABLE kb_embeddings IS
    'KB 文件的 chunk 向量表。蓝绿切换通过 (profile_id, status) partial index 实现，与 post_embeddings 同模式。';

-- ============================================================
-- 6. Seed: 文章索引库（SYSTEM_POSTS）
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

COMMENT ON COLUMN knowledge_bases.active_profile_id IS
    '指向 kb_profiles 表的 active 行。SYSTEM_POSTS 库的 profile 由 000056 seed。';
