-- 回滚灵境会话云端持久化：按依赖逆序 DROP（messages 先于 sessions）。
DROP INDEX IF EXISTS uq_agent_chat_messages_session_seq;
DROP TABLE IF EXISTS agent_chat_messages;
DROP INDEX IF EXISTS idx_agent_chat_sessions_user_recency;
DROP TABLE IF EXISTS agent_chat_sessions;
