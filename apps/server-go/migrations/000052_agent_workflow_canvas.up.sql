-- ============================================================
-- Agent Workflow Canvas
-- migration: 000052
-- ref: .agent/plans/agent-workflow-canvas-module-plan.md
-- ============================================================
-- 目标：
--   1. 为后台「智能体编排」提供画布定义、版本、运行、trace 的持久化边界。
--   2. 支持 MCP / Skill / HTTP / OpenAPI / builtin connector 注册。
--   3. 支持变量与 secret_ref 分离，避免把真实密钥下发到前端。
--   4. 支持 workflow 发布为前台/后台可调用的站内 Agent 能力。
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_connectors (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(80) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    description TEXT,
    protocol VARCHAR(16) NOT NULL,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_agent_connectors_protocol CHECK (protocol IN ('builtin', 'http', 'openapi', 'mcp', 'skill'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_connectors_user_code
    ON agent_connectors(user_id, code)
    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_connectors_system_code
    ON agent_connectors(code)
    WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_connectors_protocol ON agent_connectors(protocol, enabled);

CREATE TABLE IF NOT EXISTS agent_tools (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    connector_id BIGINT REFERENCES agent_connectors(id) ON DELETE SET NULL,
    code VARCHAR(80) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    description TEXT,
    category VARCHAR(40) NOT NULL DEFAULT 'custom',
    args_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    handler_type VARCHAR(16) NOT NULL,
    handler_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
    rate_limit_per_min INT NOT NULL DEFAULT 60,
    timeout_ms INT NOT NULL DEFAULT 30000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_agent_tools_handler_type CHECK (handler_type IN ('builtin', 'http', 'openapi', 'mcp', 'skill', 'code')),
    CONSTRAINT chk_agent_tools_timeout CHECK (timeout_ms BETWEEN 1000 AND 300000),
    CONSTRAINT chk_agent_tools_rate_limit CHECK (rate_limit_per_min BETWEEN 1 AND 600)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_tools_user_code
    ON agent_tools(user_id, code)
    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_tools_system_code
    ON agent_tools(code)
    WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_tools_owner_enabled ON agent_tools(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_agent_tools_public ON agent_tools(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_agent_tools_connector ON agent_tools(connector_id);

CREATE TABLE IF NOT EXISTS agent_agents (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL,
    model_id VARCHAR(120),
    provider_code VARCHAR(80),
    max_iterations INT NOT NULL DEFAULT 8,
    max_tool_calls INT NOT NULL DEFAULT 24,
    max_tokens INT NOT NULL DEFAULT 60000,
    allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_agent_agents_iterations CHECK (max_iterations BETWEEN 1 AND 50),
    CONSTRAINT chk_agent_agents_tool_calls CHECK (max_tool_calls BETWEEN 1 AND 200),
    CONSTRAINT chk_agent_agents_tokens CHECK (max_tokens BETWEEN 1000 AND 1000000),
    UNIQUE (user_id, code)
);

CREATE INDEX IF NOT EXISTS idx_agent_agents_owner_enabled ON agent_agents(user_id, enabled);

CREATE TABLE IF NOT EXISTS agent_workflows (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    mode VARCHAR(16) NOT NULL DEFAULT 'fixed',
    definition_json JSONB NOT NULL,
    definition_ast JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_template BOOLEAN NOT NULL DEFAULT FALSE,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    version INT NOT NULL DEFAULT 1,
    parent_workflow_id BIGINT REFERENCES agent_workflows(id) ON DELETE SET NULL,
    run_count BIGINT NOT NULL DEFAULT 0,
    last_run_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_agent_workflows_mode CHECK (mode IN ('fixed', 'autonomous', 'hybrid')),
    CONSTRAINT chk_agent_workflows_version CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_agent_workflows_owner_updated ON agent_workflows(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_workflows_public ON agent_workflows(is_public, run_count DESC) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_agent_workflows_template ON agent_workflows(is_template, updated_at DESC) WHERE is_template = TRUE;

CREATE TABLE IF NOT EXISTS agent_workflow_versions (
    id BIGSERIAL PRIMARY KEY,
    workflow_id BIGINT NOT NULL REFERENCES agent_workflows(id) ON DELETE CASCADE,
    version INT NOT NULL,
    definition_json JSONB NOT NULL,
    definition_ast JSONB NOT NULL DEFAULT '{}'::jsonb,
    change_note VARCHAR(280),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workflow_id, version)
);

CREATE TABLE IF NOT EXISTS agent_variables (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    workflow_id BIGINT REFERENCES agent_workflows(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    scope VARCHAR(16) NOT NULL,
    value_type VARCHAR(32) NOT NULL,
    value_json JSONB,
    secret_ref VARCHAR(160),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_agent_variables_scope CHECK (scope IN ('system', 'user', 'workflow', 'run')),
    CONSTRAINT chk_agent_variables_value_type CHECK (
        value_type IN ('string', 'number', 'integer', 'boolean', 'object', 'array', 'array[string]', 'array[number]', 'array[object]', 'array[boolean]', 'file')
    ),
    CONSTRAINT chk_agent_variables_secret_or_value CHECK (NOT (secret_ref IS NOT NULL AND value_json IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_agent_variables_workflow ON agent_variables(workflow_id, scope);
CREATE INDEX IF NOT EXISTS idx_agent_variables_user ON agent_variables(user_id, scope);

CREATE TABLE IF NOT EXISTS agent_workflow_runs (
    id BIGSERIAL PRIMARY KEY,
    workflow_id BIGINT NOT NULL REFERENCES agent_workflows(id) ON DELETE CASCADE,
    version INT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
    outputs JSONB,
    current_node VARCHAR(80),
    paused_reason VARCHAR(40),
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    duration_ms INT,
    total_node_count INT NOT NULL DEFAULT 0,
    prompt_tokens INT,
    completion_tokens INT,
    total_cost_usd DECIMAL(14, 6),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_agent_workflow_runs_status CHECK (status IN ('pending', 'running', 'paused', 'success', 'failed', 'cancelled', 'budget_exceeded'))
);

CREATE INDEX IF NOT EXISTS idx_agent_workflow_runs_workflow ON agent_workflow_runs(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_workflow_runs_user_status ON agent_workflow_runs(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_workflow_node_logs (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES agent_workflow_runs(id) ON DELETE CASCADE,
    sequence INT NOT NULL,
    node_id VARCHAR(80) NOT NULL,
    node_type VARCHAR(24) NOT NULL,
    status VARCHAR(16) NOT NULL,
    input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_json JSONB,
    tool_id BIGINT REFERENCES agent_tools(id) ON DELETE SET NULL,
    model_id VARCHAR(120),
    prompt_tokens INT,
    completion_tokens INT,
    duration_ms INT,
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP,
    CONSTRAINT chk_agent_node_logs_type CHECK (node_type IN ('input', 'output', 'llm', 'agent', 'tool', 'extractor', 'branch', 'loop', 'code')),
    CONSTRAINT chk_agent_node_logs_status CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_node_logs_run_sequence ON agent_workflow_node_logs(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_agent_node_logs_run_node ON agent_workflow_node_logs(run_id, node_id);

CREATE TABLE IF NOT EXISTS agent_schedules (
    id BIGSERIAL PRIMARY KEY,
    workflow_id BIGINT NOT NULL REFERENCES agent_workflows(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    cron_expr VARCHAR(120) NOT NULL,
    timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Shanghai',
    inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
    next_run_at TIMESTAMP,
    last_run_at TIMESTAMP,
    last_run_id BIGINT REFERENCES agent_workflow_runs(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_schedules_next ON agent_schedules(enabled, next_run_at) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_agent_schedules_workflow ON agent_schedules(workflow_id);

CREATE TABLE IF NOT EXISTS agent_publications (
    id BIGSERIAL PRIMARY KEY,
    workflow_id BIGINT NOT NULL REFERENCES agent_workflows(id) ON DELETE CASCADE,
    version INT NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    description TEXT,
    input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    allowed_origins JSONB NOT NULL DEFAULT '[]'::jsonb,
    rate_limit_per_min INT NOT NULL DEFAULT 30,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_agent_publications_rate CHECK (rate_limit_per_min BETWEEN 1 AND 300)
);

CREATE INDEX IF NOT EXISTS idx_agent_publications_enabled ON agent_publications(enabled, slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_publications_workflow ON agent_publications(workflow_id);

INSERT INTO agent_connectors (user_id, code, display_name, description, protocol, config_json, enabled)
SELECT NULL, 'builtin', '内置工具', 'AetherBlog 站内文章、搜索与文本处理工具。', 'builtin', '{}'::jsonb, TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM agent_connectors WHERE user_id IS NULL AND code = 'builtin'
);

INSERT INTO agent_connectors (user_id, code, display_name, description, protocol, config_json, enabled)
SELECT NULL, 'mcp_controlled_search', '受控联网搜索', '需要显式启用并通过 SSRF/审批策略的 MCP 搜索连接器。', 'mcp', '{}'::jsonb, FALSE
WHERE NOT EXISTS (
    SELECT 1 FROM agent_connectors WHERE user_id IS NULL AND code = 'mcp_controlled_search'
);

INSERT INTO agent_connectors (user_id, code, display_name, description, protocol, config_json, enabled)
SELECT NULL, 'skill_manifest', 'Skill Manifest', '从本地 Skill manifest 暴露的只读工具入口。', 'skill', '{}'::jsonb, FALSE
WHERE NOT EXISTS (
    SELECT 1 FROM agent_connectors WHERE user_id IS NULL AND code = 'skill_manifest'
);

INSERT INTO agent_tools (
    user_id,
    connector_id,
    code,
    display_name,
    description,
    category,
    args_schema,
    output_schema,
    handler_type,
    handler_config,
    is_public,
    enabled,
    requires_approval,
    rate_limit_per_min,
    timeout_ms
)
SELECT
    NULL,
    c.id,
    item.code,
    item.display_name,
    item.description,
    item.category,
    item.args_schema::jsonb,
    item.output_schema::jsonb,
    item.handler_type,
    item.handler_config::jsonb,
    item.is_public,
    item.enabled,
    item.requires_approval,
    item.rate_limit_per_min,
    item.timeout_ms
FROM agent_connectors c
JOIN (
    VALUES
        (
            'kb_get_post',
            '读取文章',
            '按文章 ID 读取标题、正文、摘要与标签。',
            'builtin',
            '{"type":"object","required":["id"],"properties":{"id":{"type":"integer"}}}',
            '{"type":"object"}',
            'builtin',
            '{"tool":"kb_get_post"}',
            TRUE,
            TRUE,
            FALSE,
            120,
            10000
        ),
        (
            'kb_search',
            '站内搜索',
            '站内文章关键词与语义检索。',
            'builtin',
            '{"type":"object","required":["query"],"properties":{"query":{"type":"string"},"limit":{"type":"integer","default":5}}}',
            '{"type":"object","properties":{"items":{"type":"array"}}}',
            'builtin',
            '{"tool":"kb_search"}',
            TRUE,
            TRUE,
            FALSE,
            120,
            15000
        ),
        (
            'text_join',
            '文本拼接',
            '把数组内容按指定分隔符拼接成文本。',
            'builtin',
            '{"type":"object","required":["items"],"properties":{"items":{"type":"array"},"separator":{"type":"string","default":"\\n"}}}',
            '{"type":"string"}',
            'builtin',
            '{"tool":"text_join"}',
            TRUE,
            TRUE,
            FALSE,
            300,
            5000
        ),
        (
            'echo',
            '参数回显',
            '用于调试输入、变量与模板解析的安全工具。',
            'builtin',
            '{"type":"object"}',
            '{"type":"object"}',
            'builtin',
            '{"tool":"echo"}',
            TRUE,
            TRUE,
            FALSE,
            300,
            5000
        )
) AS item (
    code,
    display_name,
    description,
    category,
    args_schema,
    output_schema,
    handler_type,
    handler_config,
    is_public,
    enabled,
    requires_approval,
    rate_limit_per_min,
    timeout_ms
)
    ON c.user_id IS NULL AND c.code = 'builtin'
WHERE NOT EXISTS (
    SELECT 1 FROM agent_tools existing
    WHERE existing.user_id IS NULL AND existing.code = item.code
);

INSERT INTO agent_tools (
    user_id,
    connector_id,
    code,
    display_name,
    description,
    category,
    args_schema,
    output_schema,
    handler_type,
    handler_config,
    is_public,
    enabled,
    requires_approval,
    rate_limit_per_min,
    timeout_ms
)
SELECT
    NULL,
    c.id,
    'web_search',
    '联网搜索',
    '通过受控 MCP 搜索连接器获取外部结果，默认需要人工批准。',
    'mcp',
    '{"type":"object","required":["query"],"properties":{"query":{"type":"string"}}}'::jsonb,
    '{"type":"object"}'::jsonb,
    'mcp',
    '{"connector":"mcp_controlled_search","tool":"web_search"}'::jsonb,
    FALSE,
    FALSE,
    TRUE,
    30,
    30000
FROM agent_connectors c
WHERE c.user_id IS NULL
  AND c.code = 'mcp_controlled_search'
  AND NOT EXISTS (
      SELECT 1 FROM agent_tools existing WHERE existing.user_id IS NULL AND existing.code = 'web_search'
  );

INSERT INTO agent_tools (
    user_id,
    connector_id,
    code,
    display_name,
    description,
    category,
    args_schema,
    output_schema,
    handler_type,
    handler_config,
    is_public,
    enabled,
    requires_approval,
    rate_limit_per_min,
    timeout_ms
)
SELECT
    NULL,
    c.id,
    'skill_security_audit',
    '安全审计 Skill',
    '从 Skill manifest 暴露的安全审计工具，默认需要人工批准。',
    'skill',
    '{"type":"object"}'::jsonb,
    '{"type":"object"}'::jsonb,
    'skill',
    '{"connector":"skill_manifest","skill":"security-audit"}'::jsonb,
    FALSE,
    FALSE,
    TRUE,
    10,
    60000
FROM agent_connectors c
WHERE c.user_id IS NULL
  AND c.code = 'skill_manifest'
  AND NOT EXISTS (
      SELECT 1 FROM agent_tools existing WHERE existing.user_id IS NULL AND existing.code = 'skill_security_audit'
  );

COMMENT ON TABLE agent_workflows IS 'Agent Workflow Canvas 定义表，definition_json 是画布真相源。';
COMMENT ON TABLE agent_workflow_versions IS 'Agent Workflow 版本快照，运行时必须引用冻结版本。';
COMMENT ON TABLE agent_workflow_runs IS 'Agent Workflow 运行实例，记录输入、输出、状态与资源消耗。';
COMMENT ON TABLE agent_workflow_node_logs IS 'Agent Workflow 节点级 trace，用于调试器与 SSE 回放。';
COMMENT ON TABLE agent_connectors IS 'MCP / Skill / HTTP / OpenAPI / builtin connector 注册表。';
COMMENT ON TABLE agent_publications IS '发布为前台/后台可调用智能体的 runtime 入口。';
