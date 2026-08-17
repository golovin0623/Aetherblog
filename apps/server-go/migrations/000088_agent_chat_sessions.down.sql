-- 回滚灵境 AI 会话云端持久化。依赖顺序：先删消息，再删会话。
DROP TABLE IF EXISTS agent_chat_messages;
DROP TABLE IF EXISTS agent_chat_sessions;
