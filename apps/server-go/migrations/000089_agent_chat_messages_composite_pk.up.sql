-- 000089: agent_chat_messages 主键改为 (session_id, id) 复合键。
--
-- 000088 把消息 id 设计成了全局 TEXT PRIMARY KEY，但客户端消息 id 只保证
-- 会话内唯一：灵境「分支会话」按产品语义原样复制消息（含 id）到新会话，
-- 两个会话先后同步时后者必撞全局主键（23505），整会话 upsert 500。
-- 消息的正确唯一域是会话内 —— 主键收敛为 (session_id, id)。
--
-- 幂等：仅当现存主键仍是单列时才重建；重放为 no-op。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conname = 'agent_chat_messages_pkey'
      AND c.conrelid = 'agent_chat_messages'::regclass
      AND array_length(c.conkey, 1) = 1
  ) THEN
    ALTER TABLE agent_chat_messages DROP CONSTRAINT agent_chat_messages_pkey;
    ALTER TABLE agent_chat_messages
      ADD CONSTRAINT agent_chat_messages_pkey PRIMARY KEY (session_id, id);
  END IF;
END $$;
