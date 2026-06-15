-- ============================================================
-- Team Chat · Agent 纳入与管理 (Phase 2)
-- ============================================================
-- 目标:
--   1. 定义可被纳入聊天的「智能体(Agent)」—— 名称/头像/人设/绑定模型/可见范围。
--   2. 把 Agent 作为成员「入座」到会话(群聊/私聊)，与 Phase 1 预留的
--      chat_messages.sender_type='AGENT' / chat_conversation_members.member_role='AGENT' 对齐。
--   3. 消息可归属到具体 Agent(chat_messages.agent_id)，前端按 Agent 身份渲染气泡。
--
-- 说明: 本阶段只做「纳入与管理 + 身份归属」。Agent 自动生成回复(调用 LLM / 工作流)
--       为 Phase 3，provider_code/model_id/system_prompt 字段在此预留绑定位。
--
-- 红线遵循 CLAUDE.md §3.8: 全部 IF NOT EXISTS、幂等、单事务安全; 占用版本号 000083。
-- ============================================================

-- Agent 定义。
CREATE TABLE IF NOT EXISTS chat_agents (
    id            BIGSERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    slug          VARCHAR(120) NOT NULL UNIQUE,
    avatar        TEXT,
    description   TEXT,
    -- Phase 3 预留: 绑定的 AI provider / 模型 / 人设系统提示，用于自动回复。
    provider_code VARCHAR(50),
    model_id      VARCHAR(120),
    system_prompt TEXT,
    -- 可见范围: PRIVATE(仅创建者) | TEAM(所属团队成员) | GLOBAL(全站，需管理员)
    scope         VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',
    team_id       BIGINT REFERENCES teams(id) ON DELETE CASCADE,
    status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_chat_agent_scope CHECK (scope IN ('PRIVATE', 'TEAM', 'GLOBAL')),
    CONSTRAINT chk_chat_agent_status CHECK (status IN ('ACTIVE', 'DISABLED')),
    -- TEAM 必须绑定 team_id；PRIVATE / GLOBAL 必须不绑定，保证数据一致。
    CONSTRAINT chk_chat_agent_team CHECK (
        (scope = 'TEAM' AND team_id IS NOT NULL)
        OR (scope <> 'TEAM' AND team_id IS NULL)
    ),
    CONSTRAINT chk_chat_agent_name_nonempty CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS idx_chat_agents_scope ON chat_agents(scope);
CREATE INDEX IF NOT EXISTS idx_chat_agents_team ON chat_agents(team_id);
CREATE INDEX IF NOT EXISTS idx_chat_agents_created_by ON chat_agents(created_by);

-- Agent 入座会话（与 chat_conversation_members 平行，但指向 Agent 而非用户）。
CREATE TABLE IF NOT EXISTS chat_conversation_agents (
    conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    agent_id        BIGINT NOT NULL REFERENCES chat_agents(id) ON DELETE CASCADE,
    added_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    joined_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, agent_id),

    CONSTRAINT chk_chat_conv_agent_status CHECK (status IN ('ACTIVE', 'DISABLED'))
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_agents_agent ON chat_conversation_agents(agent_id);

-- 消息归属到 Agent（sender_type='AGENT' 时填）。沿用 Phase 1 的 sender_type 约束。
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS agent_id BIGINT REFERENCES chat_agents(id) ON DELETE SET NULL;
