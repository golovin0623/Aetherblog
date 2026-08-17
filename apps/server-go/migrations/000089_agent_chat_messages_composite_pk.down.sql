-- 回滚：主键还原为单列 id（存在跨会话重复 id 时会失败，需先人工清理）。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conname = 'agent_chat_messages_pkey'
      AND c.conrelid = 'agent_chat_messages'::regclass
      AND array_length(c.conkey, 1) = 2
  ) THEN
    ALTER TABLE agent_chat_messages DROP CONSTRAINT agent_chat_messages_pkey;
    ALTER TABLE agent_chat_messages
      ADD CONSTRAINT agent_chat_messages_pkey PRIMARY KEY (id);
  END IF;
END $$;
