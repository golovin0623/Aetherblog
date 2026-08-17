-- ============================================================
-- 灵境 AI 会话云端持久化（/api/v1/agent/sessions）
-- ============================================================
-- 目标：
--   1. 把 admin / blog 前端 localStorage 里的灵境会话（AgentSession/AgentMessage）
--      同步到服务端，实现跨设备漫游。
--   2. 同步模型 = 整会话 upsert（PUT 全量替换 meta + messages），LWW 冲突判定
--      使用客户端毫秒时间戳 client_updated_at（客户端主导时钟）。
--   3. id 由客户端生成（uuid 或 sess_/msg_ 前缀串），服务端用 CHECK 约束校验
--      字符集与长度 ^[A-Za-z0-9_-]{8,64}$。
--   4. 消息的所有可选流式元数据（think/sources/retrieval/usage/attachments 元信息/
--      translation/requestSnapshot/error/errorCode/retryable/各时间戳）收进单个
--      payload JSONB，避免 20 个稀疏列；服务端不解析、原样回传。
--
-- 红线遵循 CLAUDE.md §3.8：取空号 000088（当前最大 000087 +1，不顺移）；
-- 全部 IF NOT EXISTS，幂等、单事务安全。
-- ============================================================

-- 会话表：一行 = 一个灵境对话（不含消息）。
CREATE TABLE IF NOT EXISTS agent_chat_sessions (
    -- 客户端生成 id（uuid / sess_ 前缀串）
    id                TEXT PRIMARY KEY,
    user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title             TEXT NOT NULL DEFAULT '',
    -- chat / cowork / code（应用层校验，DB 不加 CHECK 以免新增模式要动 schema）
    mode              TEXT NOT NULL DEFAULT 'chat',
    model_id          TEXT,
    provider_code     TEXT,
    -- temperature / top_p / max_tokens 等模型参数（前端 AgentModelParams）
    model_params      JSONB,
    pinned            BOOLEAN NOT NULL DEFAULT FALSE,
    -- 上下文断点：该 id 的消息（含）之前的历史不再随请求发送
    context_break_id  TEXT,
    -- 未发送的输入框草稿
    draft             TEXT NOT NULL DEFAULT '',
    -- 客户端毫秒时间戳（主导时钟）；client_updated_at 用于 LWW 冲突判定
    client_created_at BIGINT NOT NULL DEFAULT 0,
    client_updated_at BIGINT NOT NULL DEFAULT 0,
    -- 服务端 TIMESTAMPTZ 视图（由客户端毫秒换算），供排序 / 运维排查
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_agent_chat_session_id CHECK (id ~ '^[A-Za-z0-9_-]{8,64}$')
);

-- 侧栏列表查询：按用户取会话，置顶优先、按最近更新倒序。
CREATE INDEX IF NOT EXISTS idx_agent_chat_sessions_user_recency
    ON agent_chat_sessions (user_id, pinned DESC, updated_at DESC);

-- 消息表：一行 = 会话内一条消息，seq 为会话内顺序（PUT 时按数组下标重排）。
CREATE TABLE IF NOT EXISTS agent_chat_messages (
    -- 客户端生成 id（uuid / msg_ 前缀串）
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_chat_sessions(id) ON DELETE CASCADE,
    seq        INT NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    -- 全部可选元数据（think/sources/retrieval/usage/attachments 元信息(不含 dataUrl)/
    -- translation/requestSnapshot/error/errorCode/retryable/startedAt/firstTokenAt/finishedAt）
    payload    JSONB,
    -- 客户端毫秒时间戳
    created_at BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT chk_agent_chat_message_id   CHECK (id ~ '^[A-Za-z0-9_-]{8,64}$'),
    CONSTRAINT chk_agent_chat_message_role CHECK (role IN ('user', 'assistant'))
);

-- 会话内顺序唯一；同时覆盖"按会话取全部消息按 seq 排序"的查询。
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_chat_messages_session_seq
    ON agent_chat_messages (session_id, seq);
