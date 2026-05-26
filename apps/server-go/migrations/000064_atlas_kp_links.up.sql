-- 000064: Atlas Phase 2 衍生表 —— annotation_kp_links + relation_evidence
--
-- 落地手册: docs/plan/task-aether-knowledge-system.md §2.2 衍生表 / §3 Phase 2
--
-- 设计要点:
--   * annotation_kp_links: 标注 -- 知识点 多对多。同一标注可支撑多个 KP；同一 KP 可由多条标注佐证。
--   * relation_evidence:   typed_relation -- annotation 多对多。关系本身的出处。
--
-- 兼容性: 纯新增 2 张表 + atlas_knowledge_points.uuid 加 DEFAULT。
--          无对现有数据的破坏性 ALTER。

-- 1) atlas_knowledge_points.uuid 加默认值，避免 INSERT 必须显式 gen_random_uuid()
ALTER TABLE atlas_knowledge_points
    ALTER COLUMN uuid SET DEFAULT gen_random_uuid();

-- 2) annotation -- KP 多对多
CREATE TABLE atlas_annotation_kp_links (
    id BIGSERIAL PRIMARY KEY,
    annotation_id BIGINT NOT NULL REFERENCES atlas_annotations(id) ON DELETE CASCADE,
    kp_id BIGINT NOT NULL REFERENCES atlas_knowledge_points(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'evidence'
        CHECK (role IN ('evidence', 'definition', 'example', 'counter')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_atlas_ann_kp UNIQUE (annotation_id, kp_id)
);

CREATE INDEX idx_atlas_ann_kp_kp ON atlas_annotation_kp_links(kp_id, role);
CREATE INDEX idx_atlas_ann_kp_ann ON atlas_annotation_kp_links(annotation_id);

COMMENT ON TABLE atlas_annotation_kp_links IS
    '标注与知识点的多对多。role 区分证据 / 定义 / 例子 / 反例。';

-- 3) typed_relation -- annotation 多对多（关系自身可有出处）
CREATE TABLE atlas_relation_evidence (
    id BIGSERIAL PRIMARY KEY,
    relation_id BIGINT NOT NULL REFERENCES atlas_typed_relations(id) ON DELETE CASCADE,
    annotation_id BIGINT NOT NULL REFERENCES atlas_annotations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_atlas_rel_ev UNIQUE (relation_id, annotation_id)
);

CREATE INDEX idx_atlas_rel_ev_relation ON atlas_relation_evidence(relation_id);

COMMENT ON TABLE atlas_relation_evidence IS
    '一条关系的出处标注。关系是一阶公民——可解释、可追溯。';
