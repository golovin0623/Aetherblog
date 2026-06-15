-- ============================================================
-- AetherBlog - 试卷智能拆题 / 校对 / 修复 / 审批入库闭环
-- ============================================================
-- 契约源：docs/features/qa-document-workflow.md
--
-- 设计：原始文件只读落 media_files；所有校对/修复/合并/Diff 基于 Canonical
-- Document Tree（qa_doc_blocks + 版本快照）。Agent 只产出 Patch（qa_patches），
-- 审批前不写正式题库（qa_questions）。每个 Worker 阶段在 qa_document_jobs 留痕。
--
-- 红线：本迁移取空号 000081（当前最大 000080 +1，不顺移已合并迁移）；全部建表
-- 带 IF NOT EXISTS、索引带 IF NOT EXISTS、单事务安全、可重放幂等。
-- ============================================================

-- 1. 文档主记录 + 状态机 ----------------------------------------------------
CREATE TABLE IF NOT EXISTS qa_documents (
    id                BIGSERIAL PRIMARY KEY,
    title             VARCHAR(255) NOT NULL,
    media_file_id     BIGINT REFERENCES media_files(id) ON DELETE SET NULL,
    file_type         VARCHAR(20) NOT NULL DEFAULT 'IMAGE'
        CHECK (file_type IN ('IMAGE', 'PDF')),
    page_count        INT NOT NULL DEFAULT 0,
    split_granularity VARCHAR(20) NOT NULL DEFAULT 'FINE'
        CHECK (split_granularity IN ('COARSE', 'STANDARD', 'FINE', 'ULTRA_FINE')),
    status            VARCHAR(20) NOT NULL DEFAULT 'UPLOADED'
        CHECK (status IN ('UPLOADED','PREPROCESSING','SEGMENTED','OCR_DONE','STRUCTURED',
                          'REVIEW_READY','ANNOTATED','AGENT_RUNNING','PATCH_PROPOSED',
                          'MERGED','DIFF_READY','APPROVED','PUBLISHED','FAILED')),
    current_version   INT NOT NULL DEFAULT 0,
    error_message     TEXT,
    owner_id          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    deleted           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_qa_documents_status ON qa_documents(status) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_qa_documents_owner  ON qa_documents(owner_id) WHERE deleted = FALSE;

-- 2. 异步流水线任务（幂等/重试/日志）---------------------------------------
CREATE TABLE IF NOT EXISTS qa_document_jobs (
    id              BIGSERIAL PRIMARY KEY,
    document_id     BIGINT NOT NULL REFERENCES qa_documents(id) ON DELETE CASCADE,
    stage           VARCHAR(24) NOT NULL
        CHECK (stage IN ('PREPROCESS','SEGMENT','OCR','STRUCTURE','QUALITY_CHECK',
                         'AGENT_FIX','MERGE','PUBLISH')),
    status          VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
    idempotency_key VARCHAR(120) NOT NULL,
    attempt_count   INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 3,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    log             TEXT,
    error           TEXT,
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_qa_job_idem UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_qa_jobs_pending  ON qa_document_jobs(status, id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_qa_jobs_document ON qa_document_jobs(document_id, id);

-- 3. 版本快照（Canonical Tree 整树 JSON + 来源）----------------------------
CREATE TABLE IF NOT EXISTS qa_document_versions (
    id          BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES qa_documents(id) ON DELETE CASCADE,
    version_no  INT NOT NULL,
    source      VARCHAR(16) NOT NULL DEFAULT 'OCR'
        CHECK (source IN ('OCR','STRUCTURE','AGENT','MERGE','MANUAL')),
    tree_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
    note        TEXT,
    created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_qa_version UNIQUE (document_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_qa_versions_document ON qa_document_versions(document_id, version_no DESC);

-- 4. Canonical Tree 节点（可查询，按 version 归属）-------------------------
CREATE TABLE IF NOT EXISTS qa_doc_blocks (
    id              BIGSERIAL PRIMARY KEY,
    document_id     BIGINT NOT NULL REFERENCES qa_documents(id) ON DELETE CASCADE,
    version_id      BIGINT NOT NULL REFERENCES qa_document_versions(id) ON DELETE CASCADE,
    parent_id       BIGINT REFERENCES qa_doc_blocks(id) ON DELETE CASCADE,
    stable_key      VARCHAR(160) NOT NULL,
    block_type      VARCHAR(16) NOT NULL
        CHECK (block_type IN ('PAGE','BLOCK','QUESTION','STEM','OPTION','ANSWER',
                              'ANALYSIS','SUB_QUESTION','FORMULA','TABLE','TABLE_CELL')),
    page_no         INT NOT NULL DEFAULT 1,
    bbox            JSONB,
    text            TEXT,
    confidence      NUMERIC(4,3) NOT NULL DEFAULT 1.000,
    source_crop_url VARCHAR(500),
    field_path      VARCHAR(200),
    order_index     INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_qa_block_key UNIQUE (version_id, stable_key)
);
CREATE INDEX IF NOT EXISTS idx_qa_blocks_version ON qa_doc_blocks(version_id, order_index);
CREATE INDEX IF NOT EXISTS idx_qa_blocks_parent  ON qa_doc_blocks(parent_id);

-- 5. 校对标注 --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qa_annotations (
    id              BIGSERIAL PRIMARY KEY,
    document_id     BIGINT NOT NULL REFERENCES qa_documents(id) ON DELETE CASCADE,
    version_id      BIGINT REFERENCES qa_document_versions(id) ON DELETE SET NULL,
    stable_key      VARCHAR(160) NOT NULL,
    annotation_type VARCHAR(20) NOT NULL
        CHECK (annotation_type IN ('TYPO','MISSING','FORMULA_ERROR','TABLE_ERROR',
                                   'NUMBER_ERROR','SPLIT_ERROR','ANSWER_ERROR','ANALYSIS_ERROR')),
    original_text   TEXT,
    corrected_text  TEXT,
    note            TEXT,
    status          VARCHAR(12) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','RESOLVED','DISMISSED')),
    created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_qa_annotations_doc ON qa_annotations(document_id, status);

-- 6. Agent Patch Proposal --------------------------------------------------
CREATE TABLE IF NOT EXISTS qa_patches (
    id           BIGSERIAL PRIMARY KEY,
    document_id  BIGINT NOT NULL REFERENCES qa_documents(id) ON DELETE CASCADE,
    base_version BIGINT NOT NULL REFERENCES qa_document_versions(id) ON DELETE CASCADE,
    status       VARCHAR(12) NOT NULL DEFAULT 'PROPOSED'
        CHECK (status IN ('PROPOSED','MERGED','APPROVED','REJECTED','CONFLICT')),
    summary      TEXT,
    operations   JSONB NOT NULL DEFAULT '[]'::jsonb,
    agent_model  VARCHAR(120),
    created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_qa_patches_doc ON qa_patches(document_id, id DESC);

-- 7. 合并产生的 Diff -------------------------------------------------------
CREATE TABLE IF NOT EXISTS qa_document_diffs (
    id           BIGSERIAL PRIMARY KEY,
    document_id  BIGINT NOT NULL REFERENCES qa_documents(id) ON DELETE CASCADE,
    patch_id     BIGINT REFERENCES qa_patches(id) ON DELETE SET NULL,
    from_version BIGINT REFERENCES qa_document_versions(id) ON DELETE SET NULL,
    to_version   BIGINT REFERENCES qa_document_versions(id) ON DELETE SET NULL,
    diff_level   VARCHAR(12) NOT NULL DEFAULT 'CHAR'
        CHECK (diff_level IN ('CHAR','FIELD','STRUCTURE')),
    has_conflict BOOLEAN NOT NULL DEFAULT FALSE,
    diff         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_qa_diffs_doc ON qa_document_diffs(document_id, id DESC);

-- 8. 审批发布后的正式题库（带溯源 + 版本号）-------------------------------
CREATE TABLE IF NOT EXISTS qa_questions (
    id               BIGSERIAL PRIMARY KEY,
    document_id      BIGINT NOT NULL REFERENCES qa_documents(id) ON DELETE CASCADE,
    version_no       INT NOT NULL,
    question_type    VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
    stem             TEXT NOT NULL,
    options          JSONB NOT NULL DEFAULT '[]'::jsonb,
    answer           TEXT,
    analysis         TEXT,
    source_block_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    order_index      INT NOT NULL DEFAULT 0,
    created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_qa_questions_doc ON qa_questions(document_id, version_no, order_index);

-- 9. 审计日志 --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qa_audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES qa_documents(id) ON DELETE CASCADE,
    actor_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(48) NOT NULL,
    from_status VARCHAR(20),
    to_status   VARCHAR(20),
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_qa_audit_doc ON qa_audit_logs(document_id, id DESC);
