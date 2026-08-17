-- ============================================================
-- Team Chat 交互增强（设计提案「夜航信札」P1 —— docs/design/team-chat-redesign/）
-- ============================================================
-- 目标:
--   1. 消息回应（reactions）：QQ 式 +1 表情聚合，一人对一条消息同一表情最多一次。
--   2. 会话偏好：置顶（pinned_at）—— 免打扰 muted 列 000082 已建，本次仅补置顶。
--   3. @提及（mentions）：消息级被提及用户集合，用于「@我」未读分级与穿透免打扰。
--   4. 消息撤回（recalled_at）：2 分钟窗口软撤回，保留占位行（与 deleted_at 硬删除语义区分）。
--
-- 红线遵循 CLAUDE.md §3.8：全部 IF NOT EXISTS、幂等、单事务安全；取当前最大号 +1 = 000087。
-- ============================================================

-- 消息回应表：主键 (message_id, user_id, emoji) 天然幂等去重。
CREATE TABLE IF NOT EXISTS chat_message_reactions (
    message_id BIGINT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_chat_reactions_message ON chat_message_reactions(message_id);

-- 会话置顶：NULL = 未置顶；置顶时间用于置顶组内排序（后置顶靠前）。
ALTER TABLE chat_conversation_members ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP;

-- @提及：被提及用户 id 集合；「@我」未读计数走 $user = ANY(mentions)。
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS mentions BIGINT[];

-- 撤回：软撤回时间戳。撤回后 content / attachment_* 置空，行保留渲染占位；
-- 与 deleted_at（硬删除，历史查询直接过滤）语义区分。
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMP;

-- 「@我」计数的热路径索引：GIN 支撑 ANY(mentions) 谓词。
CREATE INDEX IF NOT EXISTS idx_chat_messages_mentions ON chat_messages USING GIN (mentions)
    WHERE mentions IS NOT NULL;
