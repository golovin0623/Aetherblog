-- 000065: Atlas Phase 3 AI 建议表
--
-- 红线 C3-1: 所有 AI 产出禁止直接写入 atlas_knowledge_points / atlas_typed_relations，
--          必须先入此表。用户 accept 后才"落地"，并打 provenance='ai_suggested'。
--
-- 落地手册: docs/plan/task-aether-knowledge-system.md §3 Phase 3 task-knowledge-P3-03

CREATE TABLE atlas_ai_suggestions (
    id BIGSERIAL PRIMARY KEY,

    -- 建议种类：kp = 抽离知识点；relation = 关系建议
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('kp', 'relation')),

    -- 上下文绑定
    carrier_id BIGINT REFERENCES atlas_carriers(id) ON DELETE CASCADE,
    annotation_id BIGINT REFERENCES atlas_annotations(id) ON DELETE SET NULL,
    from_kp_id BIGINT REFERENCES atlas_knowledge_points(id) ON DELETE CASCADE,
    to_kp_id BIGINT REFERENCES atlas_knowledge_points(id) ON DELETE CASCADE,

    -- 建议内容（kind 决定字段使用）
    proposed_title VARCHAR(300),
    proposed_body TEXT,
    proposed_kp_type VARCHAR(20),
    proposed_relation_type VARCHAR(20),
    proposed_strength REAL,
    proposed_confidence REAL,
    rationale TEXT,

    -- 模型与成本
    model_id VARCHAR(120),
    tokens_in INT,
    tokens_out INT,
    cost_usd NUMERIC(12, 6),

    -- 状态机
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected', 'ignored', 'expired')),
    resolved_kp_id BIGINT REFERENCES atlas_knowledge_points(id) ON DELETE SET NULL,
    resolved_relation_id BIGINT REFERENCES atlas_typed_relations(id) ON DELETE SET NULL,

    author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_atlas_sug_kind_fields CHECK (
        (kind = 'kp' AND proposed_title IS NOT NULL) OR
        (kind = 'relation' AND from_kp_id IS NOT NULL AND to_kp_id IS NOT NULL AND proposed_relation_type IS NOT NULL)
    )
);

CREATE INDEX idx_atlas_sug_status ON atlas_ai_suggestions(status, created_at DESC);
CREATE INDEX idx_atlas_sug_carrier ON atlas_ai_suggestions(carrier_id, status);
CREATE INDEX idx_atlas_sug_kind ON atlas_ai_suggestions(kind, status);

COMMENT ON TABLE atlas_ai_suggestions IS
    'AI 抽取建议（KP / relation）。所有 AI 产出先入此表，用户 accept 后才落到 KP/relation 表，provenance=ai_suggested。';

-- 用户忽略列表（拒绝过的建议指纹，下次不再打扰）
CREATE TABLE atlas_ignored_suggestions (
    id BIGSERIAL PRIMARY KEY,
    fingerprint VARCHAR(128) NOT NULL,
    suggestion_kind VARCHAR(20) NOT NULL CHECK (suggestion_kind IN ('kp', 'relation')),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_atlas_ignored UNIQUE (fingerprint, user_id)
);

CREATE INDEX idx_atlas_ignored_user ON atlas_ignored_suggestions(user_id);

COMMENT ON TABLE atlas_ignored_suggestions IS
    '用户拒绝过的建议指纹（carrier+span+kind hash）。用于去重避免反复推荐。';
