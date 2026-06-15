-- 回滚 Team Chat · Agent 纳入与管理 (Phase 2)。
-- 先摘除消息归属列，再删入座关系与 Agent 定义。
ALTER TABLE chat_messages DROP COLUMN IF EXISTS agent_id;
DROP TABLE IF EXISTS chat_conversation_agents;
DROP TABLE IF EXISTS chat_agents;
