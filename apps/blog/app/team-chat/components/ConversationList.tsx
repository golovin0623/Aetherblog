'use client';

import type { ChatConversation } from '../lib/types';

interface Props {
  conversations: ChatConversation[];
  activeId: number | null;
  onlineUserIds: Set<number>;
  currentUserId: number;
  onSelect: (conv: ChatConversation) => void;
}

function previewText(conv: ChatConversation): string {
  const lm = conv.lastMessage;
  if (!lm) return '暂无消息';
  switch (lm.messageType) {
    case 'IMAGE':
      return '[图片]';
    case 'FILE':
      return '[文件]';
    case 'VOICE':
      return '[语音]';
    default:
      return lm.content || '';
  }
}

/** 会话侧栏：标题 + 最后一条消息预览 + 未读红点 + 私聊在线状态点。 */
export default function ConversationList({
  conversations,
  activeId,
  onlineUserIds,
  currentUserId,
  onSelect,
}: Props) {
  return (
    <ul className="flex flex-col">
      {conversations.map((conv) => {
        const isActive = conv.id === activeId;
        const peer =
          conv.kind === 'DIRECT'
            ? conv.members?.find((m) => m.userId !== currentUserId)
            : undefined;
        const online = peer ? onlineUserIds.has(peer.userId) : false;
        return (
          <li key={conv.id}>
            <button
              type="button"
              onClick={() => onSelect(conv)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                isActive ? 'bg-[var(--bg-leaf)]' : 'hover:bg-[var(--bg-leaf)]'
              }`}
            >
              <div className="relative shrink-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-raised)] text-[var(--ink-secondary)]">
                  {conv.kind === 'TEAM' ? '#' : (conv.title || '?').slice(0, 1).toUpperCase()}
                </div>
                {peer && (
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--bg-substrate)] ${
                      online ? 'bg-[var(--signal-success)]' : 'bg-[var(--ink-subtle)]'
                    }`}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-[var(--ink-primary)]">
                    {conv.title || (conv.kind === 'TEAM' ? '团队群聊' : '私聊')}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-[var(--signal-danger)] px-2 py-0.5 text-xs text-[var(--bg-void)]">
                      {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                    </span>
                  )}
                </div>
                <p className="truncate text-sm text-[var(--ink-muted)]">{previewText(conv)}</p>
              </div>
            </button>
          </li>
        );
      })}
      {conversations.length === 0 && (
        <li className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">暂无会话</li>
      )}
    </ul>
  );
}
