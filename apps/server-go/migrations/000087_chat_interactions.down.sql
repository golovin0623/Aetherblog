-- 回滚 000087：撤销聊天交互增强。
DROP INDEX IF EXISTS idx_chat_messages_mentions;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS recalled_at;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS mentions;
ALTER TABLE chat_conversation_members DROP COLUMN IF EXISTS pinned_at;
DROP INDEX IF EXISTS idx_chat_reactions_message;
DROP TABLE IF EXISTS chat_message_reactions;
