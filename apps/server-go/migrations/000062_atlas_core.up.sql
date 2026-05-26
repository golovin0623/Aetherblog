-- 000062: Aether Knowledge (Atlas) 核心 schema —— Phase 0 数据骨架
--
-- 背景：把 docs/plan/knowledge.md「Carrier × Annotation × KnowledgePoint × TypedRelation」四层
--      架构落地为 admin 后台私有「输入流 / 标注图谱」子产品。本 migration 只建骨架，不接入任何
--      worker / UI 行为。Phase 1 起标注层与 PDF Carrier 才进入实际写入路径。
--
-- 落地手册：docs/plan/task-aether-knowledge-system.md §2（数据骨架） §3 Phase 0
--
-- 与既有 schema 的关系（红线: 不动现有表）:
--   * notes (000054) 通过 service 层 MarkdownCarrierAdapter 包装为 carriers.type='markdown'
--     —— 不在此 migration 写入 carrier 行，由运行时按需懒创建。
--   * knowledge_bases (000058) 完全独立，仅在 Phase 3 Hybrid Retrieval 时复用其 chunker。
--   * users / roles / permissions 体系沿用现有 RBAC，新增 content.atlas.* 权限码（见 000063）。
--
-- 兼容性：纯新增 5 张表。无对现有表的 ALTER。回滚 (down) 全表 DROP CASCADE。

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1. carriers —— 多模态载体（PDF/EPUB/MD/Web/Video/Audio/Image）
-- ============================================================
CREATE TABLE atlas_carriers (
    id BIGSERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('pdf', 'epub', 'markdown', 'web', 'video', 'audio', 'image')),

    -- 原始资源指针。markdown 类型时 source_uri = 'notes://{note_id}'，由 service 解析。
    source_uri TEXT NOT NULL,

    -- 不可变内容指纹（sha256）。在 carrier_versions 里也存一份，便于版本对照。
    content_hash CHAR(64) NOT NULL,

    title VARCHAR(300) NOT NULL DEFAULT '',
    author VARCHAR(200),
    language VARCHAR(20),

    -- 多模态特定元数据。例: pdf {pages, dimensions}; video {duration_ms, codec}; web {snapshot_url}
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,

    -- 生命周期：ingesting -> ready -> failed。markdown 适配器跳过 ingesting 直接 ready。
    status VARCHAR(20) NOT NULL DEFAULT 'ready'
        CHECK (status IN ('ingesting', 'ready', 'failed')),
    status_message TEXT,

    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_atlas_carriers_uri_nonempty CHECK (btrim(source_uri) <> ''),
    CONSTRAINT chk_atlas_carriers_hash_len CHECK (length(content_hash) = 64)
);

CREATE INDEX idx_atlas_carriers_type_owner
    ON atlas_carriers(type, owner_id, updated_at DESC)
    WHERE deleted = false;

CREATE INDEX idx_atlas_carriers_status
    ON atlas_carriers(status)
    WHERE deleted = false;

CREATE INDEX idx_atlas_carriers_metadata
    ON atlas_carriers USING gin (metadata);

COMMENT ON TABLE atlas_carriers IS
    'Atlas 载体表（PDF/EPUB/Markdown/Web/Video/Audio/Image）。原文不可变，由 carrier_versions 维护版本叠加。markdown 类型由 MarkdownCarrierAdapter 包装 notes 表。';
COMMENT ON COLUMN atlas_carriers.source_uri IS
    'markdown: notes://{id} | pdf/epub/image/video/audio: media://{media_file_id} | web: 原 URL';

-- ============================================================
-- 2. atlas_carrier_versions —— 原文不可变 + 版本叠加
-- ============================================================
CREATE TABLE atlas_carrier_versions (
    id BIGSERIAL PRIMARY KEY,
    carrier_id BIGINT NOT NULL REFERENCES atlas_carriers(id) ON DELETE CASCADE,
    version_no INT NOT NULL,

    content_hash CHAR(64) NOT NULL,
    storage_uri TEXT NOT NULL,

    -- 与上一版的差异统计。例: { added_chars: 1234, removed_chars: 567, sections_renamed: [..] }
    diff_from_prev JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- 该版本的产生原因：original | ocr_fix | reformat | reupload | user_edit
    reason VARCHAR(30) NOT NULL DEFAULT 'original',

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_atlas_carrier_version UNIQUE (carrier_id, version_no),
    CONSTRAINT chk_atlas_carrier_version_no CHECK (version_no >= 1)
);

CREATE INDEX idx_atlas_carrier_versions_carrier
    ON atlas_carrier_versions(carrier_id, version_no DESC);

COMMENT ON TABLE atlas_carrier_versions IS
    'Atlas 载体版本叠加。原文不可变，每次版本切换跑一次锚定迁移管线（Phase 1）。';

-- ============================================================
-- 3. atlas_annotations —— W3C WADM 标注层
-- ============================================================
CREATE TABLE atlas_annotations (
    id BIGSERIAL PRIMARY KEY,
    carrier_id BIGINT NOT NULL REFERENCES atlas_carriers(id) ON DELETE CASCADE,
    carrier_version_id BIGINT REFERENCES atlas_carrier_versions(id) ON DELETE SET NULL,

    -- W3C 多选择器 array：[TextQuoteSelector, TextPositionSelector, CssSelector|FragmentSelector, ...]
    -- 红线（手册 §3 Phase 1 C1-1）：至少 3 个 selector，校验在 service 层。
    selectors JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Y.RelativePosition 字节编码。D1=Tiptap 时存；D1=纯 W3C 时留 NULL。
    rel_position BYTEA,

    body_type VARCHAR(20) NOT NULL DEFAULT 'highlight'
        CHECK (body_type IN ('highlight', 'note', 'image', 'link', 'sticker')),
    body_text TEXT,

    -- 颜色 / 图标 / 私有标签
    body_meta JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- 锚定三态: anchored=直命中；soft_anchored=模糊/向量回退命中需用户确认；orphan=完全失锚
    anchor_state VARCHAR(20) NOT NULL DEFAULT 'anchored'
        CHECK (anchor_state IN ('anchored', 'soft_anchored', 'orphan')),
    anchor_score REAL NOT NULL DEFAULT 1.0
        CHECK (anchor_score >= 0 AND anchor_score <= 1),

    author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,

    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_atlas_anno_selectors_nonempty CHECK (jsonb_array_length(selectors) >= 1)
);

CREATE INDEX idx_atlas_anno_carrier
    ON atlas_annotations(carrier_id, anchor_state)
    WHERE deleted = false;

CREATE INDEX idx_atlas_anno_author
    ON atlas_annotations(author_id, updated_at DESC)
    WHERE deleted = false;

CREATE INDEX idx_atlas_anno_selectors
    ON atlas_annotations USING gin (selectors);

COMMENT ON TABLE atlas_annotations IS
    'Atlas W3C WADM 标注。每条标注存多选择器（TextQuote + TextPosition + 载体专属一个）+ Y.RelativePosition 双轨。';
COMMENT ON COLUMN atlas_annotations.anchor_state IS
    'anchored=精确命中；soft_anchored=Bitap/向量回退命中等待用户确认；orphan=载体重大变更失锚';

-- ============================================================
-- 4. atlas_knowledge_points —— 一阶公民
-- ============================================================
CREATE TABLE atlas_knowledge_points (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL UNIQUE,

    title VARCHAR(300) NOT NULL,
    body_markdown TEXT NOT NULL DEFAULT '',

    -- 6 种 KP 类型 + 2 个组织辅助（person/source 用于人物与文献节点）
    type VARCHAR(20) NOT NULL DEFAULT 'concept'
        CHECK (type IN ('claim', 'concept', 'question', 'definition', 'method', 'example', 'person', 'source')),

    confidence REAL NOT NULL DEFAULT 0.7
        CHECK (confidence >= 0 AND confidence <= 1),

    -- evergreen note 生命周期状态
    status VARCHAR(20) NOT NULL DEFAULT 'seed'
        CHECK (status IN ('seed', 'growing', 'evergreen', 'archived')),

    -- 语义向量。dim 不锁定，HNSW 索引在 Phase 3 hybrid retrieval 上线时按 dim 桶 partial 创建。
    embedding vector,
    embedding_dim INT,

    author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,

    -- 来源溯源：user=用户直接创建；ai_suggested=AI 抽取经用户确认；imported=外部导入
    provenance VARCHAR(20) NOT NULL DEFAULT 'user'
        CHECK (provenance IN ('user', 'ai_suggested', 'imported')),

    -- 若 provenance=ai_suggested，指向 ai_suggestions.id（Phase 3 建表，先占字段）
    ai_suggestion_id BIGINT,

    archived BOOLEAN NOT NULL DEFAULT FALSE,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_atlas_kp_title_nonempty CHECK (btrim(title) <> '')
);

CREATE INDEX idx_atlas_kp_author_status
    ON atlas_knowledge_points(author_id, status, updated_at DESC)
    WHERE deleted = false;

CREATE INDEX idx_atlas_kp_type
    ON atlas_knowledge_points(type)
    WHERE deleted = false AND archived = false;

CREATE INDEX idx_atlas_kp_provenance
    ON atlas_knowledge_points(provenance)
    WHERE deleted = false;

CREATE INDEX idx_atlas_kp_fulltext
    ON atlas_knowledge_points USING gin (
        to_tsvector('simple', left(title || ' ' || body_markdown, 200000))
    );

-- HNSW vector index 在 Phase 3 单独 migration 建（按 dim 桶 partial）

COMMENT ON TABLE atlas_knowledge_points IS
    'Atlas 知识点（一阶公民）。Annotation 是出处证据，KP 是用户综合产物——二者解耦防止 Readwise 病。';
COMMENT ON COLUMN atlas_knowledge_points.provenance IS
    'user=用户创建；ai_suggested=AI 抽取且用户接受；imported=外部导入';

-- ============================================================
-- 5. atlas_typed_relations —— 9 种有类型关系
-- ============================================================
CREATE TABLE atlas_typed_relations (
    id BIGSERIAL PRIMARY KEY,
    from_kp_id BIGINT NOT NULL REFERENCES atlas_knowledge_points(id) ON DELETE CASCADE,
    to_kp_id BIGINT NOT NULL REFERENCES atlas_knowledge_points(id) ON DELETE CASCADE,

    -- 严格 9 种最小集（手册 §3 Phase 2 C2-1：不允许扩展，扩展走 RFC）
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('supports', 'refutes', 'specializes', 'generalizes',
                        'precedes', 'causes', 'similar_to', 'cites', 'instance_of')),

    strength REAL NOT NULL DEFAULT 0.8
        CHECK (strength >= 0 AND strength <= 1),

    -- 关系本身可以有解释 + 出处（Phase 2 的 relation_evidence 衍生表）
    body_markdown TEXT,

    provenance VARCHAR(20) NOT NULL DEFAULT 'user'
        CHECK (provenance IN ('user', 'ai_suggested', 'imported')),
    ai_suggestion_id BIGINT,

    author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,

    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_atlas_rel UNIQUE (from_kp_id, to_kp_id, type),
    CONSTRAINT chk_atlas_rel_no_self CHECK (from_kp_id <> to_kp_id)
);

CREATE INDEX idx_atlas_rel_from
    ON atlas_typed_relations(from_kp_id, type)
    WHERE deleted = false;

CREATE INDEX idx_atlas_rel_to
    ON atlas_typed_relations(to_kp_id, type)
    WHERE deleted = false;

CREATE INDEX idx_atlas_rel_type
    ON atlas_typed_relations(type)
    WHERE deleted = false;

COMMENT ON TABLE atlas_typed_relations IS
    'Atlas KP 之间的 9 种有类型关系。关系自身是一阶公民——有方向、强度、出处、解释。';
