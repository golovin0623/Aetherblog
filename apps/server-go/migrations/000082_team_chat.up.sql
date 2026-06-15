-- ============================================================
-- Team Chat / Messaging (Phase 1 MVP)
-- ============================================================
-- 目标:
--   1. 在现有 users + teams + team_members（migration 000051）之上落地实时聊天。
--   2. 支持团队群聊（TEAM）与两人私聊（DIRECT）两种会话；GROUP 预留给后续临时群。
--   3. 消息支持 文本 / 图片 / 文件 / 语音 / 系统 五种类型，附件复用 media 体系。
--   4. 为「Agents 智能对话」预留：会话成员 member_role 含 'AGENT'，
--      消息 sender_type 含 'AGENT' / 'SYSTEM' —— 后续 Agent 工作流可直接落座聊天。
--   5. 自定义皮肤 / 气泡 / 字体：chat_user_settings 持久化用户偏好。
--
-- 红线遵循 CLAUDE.md §3.8：全部 IF NOT EXISTS、幂等、单事务安全；新表占用版本号 000082。
-- ============================================================

-- 会话表：一个 conversation 即一条聊天线（团队群 / 私聊 / 预留群）。
CREATE TABLE IF NOT EXISTS chat_conversations (
    id              BIGSERIAL PRIMARY KEY,
    kind            VARCHAR(20) NOT NULL DEFAULT 'DIRECT',
    team_id         BIGINT REFERENCES teams(id) ON DELETE CASCADE,
    title           VARCHAR(200),
    -- dm_key: 私聊唯一键，规范化为 "min:max"（两个 user_id 升序），保证一对用户只有一条 DIRECT 会话。
    dm_key          VARCHAR(64),
    created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    last_message_at TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_chat_conv_kind CHECK (kind IN ('TEAM', 'DIRECT', 'GROUP')),
    -- TEAM 会话必须绑定 team_id；DIRECT 必须有 dm_key。
    CONSTRAINT chk_chat_conv_team CHECK (kind <> 'TEAM' OR team_id IS NOT NULL),
    CONSTRAINT chk_chat_conv_dm CHECK (kind <> 'DIRECT' OR dm_key IS NOT NULL)
);

-- 一个团队最多一条 TEAM 会话；一对用户最多一条 DIRECT 会话。
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conv_team ON chat_conversations(team_id) WHERE kind = 'TEAM';
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conv_dm ON chat_conversations(dm_key) WHERE kind = 'DIRECT';
CREATE INDEX IF NOT EXISTS idx_chat_conv_last_message ON chat_conversations(last_message_at DESC);

-- 会话成员表：谁在这条聊天线里、各自的角色与已读位点。
CREATE TABLE IF NOT EXISTS chat_conversation_members (
    conversation_id      BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_role          VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    last_read_message_id BIGINT,
    muted                BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, user_id),

    -- AGENT 预留：后续智能体作为会话成员入座。
    CONSTRAINT chk_chat_member_role CHECK (member_role IN ('OWNER', 'ADMIN', 'MEMBER', 'AGENT'))
);

CREATE INDEX IF NOT EXISTS idx_chat_member_user ON chat_conversation_members(user_id);

-- 消息表。
CREATE TABLE IF NOT EXISTS chat_messages (
    id              BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    sender_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    -- AGENT / SYSTEM 预留：智能体回复与系统提示（入群、撤回等）共用此表。
    sender_type     VARCHAR(20) NOT NULL DEFAULT 'USER',
    message_type    VARCHAR(20) NOT NULL DEFAULT 'TEXT',
    content         TEXT,
    attachment_url  TEXT,
    attachment_name VARCHAR(255),
    attachment_mime VARCHAR(120),
    attachment_size BIGINT,
    -- attachment_meta: 图片 width/height、语音 duration 等结构化元数据。
    attachment_meta JSONB,
    reply_to_id     BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL,
    -- client_msg_id: 客户端幂等去重（断线重发 / 乐观渲染对账）。
    client_msg_id   VARCHAR(64),
    edited_at       TIMESTAMP,
    deleted_at      TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_chat_msg_sender_type CHECK (sender_type IN ('USER', 'AGENT', 'SYSTEM')),
    CONSTRAINT chk_chat_msg_type CHECK (message_type IN ('TEXT', 'IMAGE', 'FILE', 'VOICE', 'SYSTEM'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, id DESC);
-- 幂等：同一会话内同一 client_msg_id 只落一条。
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_client ON chat_messages(conversation_id, client_msg_id)
    WHERE client_msg_id IS NOT NULL;

-- 用户聊天偏好：自定义皮肤 / 气泡样式 / 字体 / 主题色。
CREATE TABLE IF NOT EXISTS chat_user_settings (
    user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme_skin   VARCHAR(40) NOT NULL DEFAULT 'aurora',
    bubble_style VARCHAR(40) NOT NULL DEFAULT 'rounded',
    font_family  VARCHAR(60),
    accent_color VARCHAR(20),
    -- preferences: 其余可扩展偏好（通知开关、回车发送等），避免频繁加列。
    preferences  JSONB,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
