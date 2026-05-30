-- ============================================================
-- Agent Workflow full iteration foundation
-- migration: 000068
-- ref: .agent/plans/intelligent-orchestration-gap-analysis-iteration-checklist.md
-- ============================================================
-- This migration keeps the long-term roadmap honest in the data model: run
-- lifecycle control, governance, schedules, eval, templates/marketplace,
-- human input, Cowork handoff, notifications and error-workflow bindings all
-- have durable boundaries before the product UI exposes them.

ALTER TABLE agent_workflow_runs
    ADD COLUMN IF NOT EXISTS retry_of_run_id BIGINT REFERENCES agent_workflow_runs(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS resume_from_node VARCHAR(80),
    ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) NOT NULL DEFAULT 'canvas',
    ADD COLUMN IF NOT EXISTS source_ref VARCHAR(200),
    ADD COLUMN IF NOT EXISTS redaction_policy VARCHAR(24) NOT NULL DEFAULT 'auto',
    ADD COLUMN IF NOT EXISTS max_tokens INT,
    ADD COLUMN IF NOT EXISTS max_cost_usd DECIMAL(14, 6),
    ADD COLUMN IF NOT EXISTS max_duration_ms INT,
    ADD COLUMN IF NOT EXISTS max_nodes INT,
    ADD COLUMN IF NOT EXISTS error_code VARCHAR(80),
    ADD COLUMN IF NOT EXISTS error_category VARCHAR(40),
    ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS canonicalized_workflow_id BIGINT REFERENCES agent_workflows(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_workflow_runs_retry
    ON agent_workflow_runs(retry_of_run_id)
    WHERE retry_of_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_workflow_runs_queue
    ON agent_workflow_runs(status, created_at)
    WHERE status IN ('pending', 'running', 'paused');
CREATE INDEX IF NOT EXISTS idx_agent_workflow_runs_source
    ON agent_workflow_runs(source_type, source_ref)
    WHERE source_ref IS NOT NULL;

ALTER TABLE agent_workflow_node_logs
    ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE agent_schedules
    ADD COLUMN IF NOT EXISTS missed_run_policy VARCHAR(20) NOT NULL DEFAULT 'skip',
    ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE agent_publications
    ADD COLUMN IF NOT EXISTS trusted_internal_only BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS agent_workflow_approvals (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES agent_workflow_runs(id) ON DELETE CASCADE,
    node_id VARCHAR(80) NOT NULL,
    tool_code VARCHAR(80),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    requested_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    decision_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    decided_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    decided_at TIMESTAMP,
    CONSTRAINT chk_agent_workflow_approvals_status CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_agent_workflow_approvals_run
    ON agent_workflow_approvals(run_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_publication_invocations (
    id BIGSERIAL PRIMARY KEY,
    publication_id BIGINT NOT NULL REFERENCES agent_publications(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    client_key VARCHAR(160) NOT NULL,
    invoked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_publication_invocations_window
    ON agent_publication_invocations(publication_id, client_key, invoked_at DESC);

CREATE TABLE IF NOT EXISTS agent_workflow_eval_cases (
    id BIGSERIAL PRIMARY KEY,
    workflow_id BIGINT REFERENCES agent_workflows(id) ON DELETE CASCADE,
    slug VARCHAR(120) NOT NULL,
    name VARCHAR(160) NOT NULL,
    inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
    expected JSONB NOT NULL DEFAULT '{}'::jsonb,
    scoring JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_id BIGINT REFERENCES agent_workflow_runs(id) ON DELETE SET NULL,
    last_score DECIMAL(6, 4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workflow_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_agent_workflow_eval_cases_workflow
    ON agent_workflow_eval_cases(workflow_id, enabled);

CREATE TABLE IF NOT EXISTS agent_workflow_marketplace_items (
    id BIGSERIAL PRIMARY KEY,
    workflow_id BIGINT REFERENCES agent_workflows(id) ON DELETE SET NULL,
    template_key VARCHAR(120) NOT NULL UNIQUE,
    title VARCHAR(160) NOT NULL,
    description TEXT,
    category VARCHAR(60) NOT NULL DEFAULT 'content',
    definition_json JSONB NOT NULL,
    dependency_manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
    review_status VARCHAR(20) NOT NULL DEFAULT 'approved',
    installed_count BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_agent_workflow_marketplace_review CHECK (review_status IN ('draft', 'pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_agent_workflow_marketplace_category
    ON agent_workflow_marketplace_items(category, review_status, installed_count DESC);

CREATE TABLE IF NOT EXISTS agent_workflow_error_bindings (
    id BIGSERIAL PRIMARY KEY,
    workflow_id BIGINT NOT NULL REFERENCES agent_workflows(id) ON DELETE CASCADE,
    error_workflow_id BIGINT NOT NULL REFERENCES agent_workflows(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    trigger_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workflow_id, error_workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_workflow_error_bindings_workflow
    ON agent_workflow_error_bindings(workflow_id, enabled);

CREATE TABLE IF NOT EXISTS agent_workflow_human_inputs (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES agent_workflow_runs(id) ON DELETE CASCADE,
    node_id VARCHAR(80) NOT NULL,
    prompt TEXT NOT NULL,
    schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_json JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP,
    responded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_agent_workflow_human_inputs_status CHECK (status IN ('pending', 'submitted', 'cancelled', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_agent_workflow_human_inputs_run
    ON agent_workflow_human_inputs(run_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS agent_cowork_tasks (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workflow_id BIGINT REFERENCES agent_workflows(id) ON DELETE SET NULL,
    title VARCHAR(160) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'draft',
    schedule_id BIGINT REFERENCES agent_schedules(id) ON DELETE SET NULL,
    notification_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_run_id BIGINT REFERENCES agent_workflow_runs(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_agent_cowork_tasks_status CHECK (status IN ('draft', 'active', 'paused', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_agent_cowork_tasks_user
    ON agent_cowork_tasks(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_workflow_notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id BIGINT REFERENCES agent_workflow_runs(id) ON DELETE CASCADE,
    type VARCHAR(40) NOT NULL,
    title VARCHAR(160) NOT NULL,
    body TEXT,
    action_url VARCHAR(500),
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_workflow_notifications_user
    ON agent_workflow_notifications(user_id, read_at, created_at DESC);

INSERT INTO agent_workflow_marketplace_items (
    template_key,
    title,
    description,
    category,
    definition_json,
    dependency_manifest,
    review_status
)
VALUES
    (
        'article-audit',
        'Article Audit',
        '读取真实文章，调用 LLM 生成发布前审计报告。',
        'content',
        '{
          "version": 1,
          "name": "Article Audit",
          "mode": "fixed",
          "description": "发布前文章质量审计模板。",
          "inputs": {"post_id": {"type": "integer", "required": true}},
          "nodes": [
            {"id": "input_1", "type": "input", "label": "输入文章 ID", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "load_post", "type": "tool", "label": "读取文章", "position": {"x": 260, "y": 0}, "data": {"toolCode": "kb_get_post", "args": {"id": "{{ inputs.post_id }}"}}},
            {"id": "audit_agent", "type": "agent", "label": "审计 Agent", "position": {"x": 520, "y": 0}, "data": {"prompt": "请审计这篇文章并输出 JSON 报告。", "source": "{{ nodes.load_post.output }}", "allowedTools": ["kb_search"], "maxIterations": 4}},
            {"id": "final_report", "type": "output", "label": "审计报告", "position": {"x": 780, "y": 0}, "data": {"outputPath": "{{ nodes.audit_agent.output }}"}}
          ],
          "edges": [
            {"source": "input_1", "target": "load_post"},
            {"source": "load_post", "target": "audit_agent"},
            {"source": "audit_agent", "target": "final_report"}
          ]
        }'::jsonb,
        '{"tools":["kb_get_post","kb_search"],"llm":true}'::jsonb,
        'approved'
    ),
    (
        'seo-and-tags',
        'SEO & Tags',
        '读取文章后给出 SEO 标题、摘要和标签建议。',
        'content',
        '{
          "version": 1,
          "name": "SEO & Tags",
          "mode": "fixed",
          "inputs": {"post_id": {"type": "integer", "required": true}},
          "nodes": [
            {"id": "load_post", "type": "tool", "label": "读取文章", "position": {"x": 0, "y": 0}, "data": {"toolCode": "kb_get_post", "args": {"id": "{{ inputs.post_id }}"}}},
            {"id": "seo_llm", "type": "llm", "label": "生成 SEO 建议", "position": {"x": 260, "y": 0}, "data": {"prompt": "基于文章生成 SEO 标题、摘要和标签 JSON。", "source": "{{ nodes.load_post.output }}"}},
            {"id": "output_1", "type": "output", "label": "SEO 建议", "position": {"x": 520, "y": 0}, "data": {"outputPath": "{{ nodes.seo_llm.output }}"}}
          ],
          "edges": [{"source": "load_post", "target": "seo_llm"}, {"source": "seo_llm", "target": "output_1"}]
        }'::jsonb,
        '{"tools":["kb_get_post"],"llm":true}'::jsonb,
        'approved'
    ),
    (
        'kb-sweep',
        'KB Sweep',
        '检索知识库并输出索引维护建议。',
        'knowledge',
        '{
          "version": 1,
          "name": "KB Sweep",
          "mode": "fixed",
          "inputs": {"query": {"type": "string", "required": true}},
          "nodes": [
            {"id": "search", "type": "tool", "label": "检索知识库", "position": {"x": 0, "y": 0}, "data": {"toolCode": "kb_search", "args": {"query": "{{ inputs.query }}", "limit": 10}}},
            {"id": "output_1", "type": "output", "label": "维护建议", "position": {"x": 260, "y": 0}, "data": {"outputPath": "{{ nodes.search.output }}"}}
          ],
          "edges": [{"source": "search", "target": "output_1"}]
        }'::jsonb,
        '{"tools":["kb_search"]}'::jsonb,
        'approved'
    )
ON CONFLICT (template_key) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    definition_json = EXCLUDED.definition_json,
    dependency_manifest = EXCLUDED.dependency_manifest,
    review_status = EXCLUDED.review_status,
    updated_at = CURRENT_TIMESTAMP;

COMMENT ON COLUMN agent_workflow_runs.retry_of_run_id IS 'Parent run when this run is a retry.';
COMMENT ON COLUMN agent_workflow_runs.source_type IS 'canvas, publication, schedule, article, chat, cowork, eval or canonicalize.';
COMMENT ON COLUMN agent_workflow_runs.redaction_policy IS 'auto/manual/production/full controls trace detail persistence.';
COMMENT ON TABLE agent_workflow_approvals IS 'Approval requests emitted by governed tools or human review nodes.';
COMMENT ON TABLE agent_workflow_eval_cases IS 'Gold cases used by Article Audit / SEO / KB Search workflow eval gates.';
COMMENT ON TABLE agent_workflow_marketplace_items IS 'Approved recipes/templates installable by users.';
COMMENT ON TABLE agent_workflow_error_bindings IS 'n8n-style error workflow bindings.';
COMMENT ON TABLE agent_cowork_tasks IS 'Cowork task shell backed by Agent Workflow runtime.';
