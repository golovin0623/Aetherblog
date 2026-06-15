-- 回滚 Team Chat / Messaging（Phase 1 MVP）。
-- 依赖顺序：先删消息与成员，再删会话；用户偏好独立。
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_conversation_members;
DROP TABLE IF EXISTS chat_conversations;
DROP TABLE IF EXISTS chat_user_settings;
