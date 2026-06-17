'use client';

import { motion } from 'framer-motion';
import { Hash } from 'lucide-react';
import { Avatar, transition, variants } from '@aetherblog/ui';
import type { ChatConversation } from '../lib/types';
import { formatListTime } from '../lib/format';

interface Props {
  conversations: ChatConversation[];
  activeId: number | null;
  onlineUserIds: Set<number>;
  /** 当前有人正在输入的会话 ID 集合（不含自己）。 */
  typingConvIds: Set<number>;
  currentUserId: number;
  onSelect: (conv: ChatConversation) => void;
}

function previewText(conv: ChatConversation): string {
  const lm = conv.lastMessage;
  if (!lm) return '暂无消息';
  switch (lm.messageType) {
    case 'IMAGE':
      return '［图片］';
    case 'FILE':
      return '［文件］';
    case 'VOICE':
      return '［语音］';
    default:
      return lm.content || '';
  }
}

/** 会话侧栏：头像 + 标题 + 末条预览 + 相对时间 + 未读极光徽标 + 私聊在线点 + 输入态。 */
export default function ConversationList({
  conversations,
  activeId,
  onlineUserIds,
  typingConvIds,
  currentUserId,
  onSelect,
}: Props) {
  if (conversations.length === 0) {
    return (
      <p className="px-4 py-12 text-center text-[13px] leading-relaxed text-[var(--ink-muted)]">
        暂无会话
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5 px-2 pb-3">
      {conversations.map((conv) => {
        const isActive = conv.id === activeId;
        const peer =
          conv.kind === 'DIRECT'
            ? conv.members?.find((m) => m.userId !== currentUserId)
            : undefined;
        const online = peer ? onlineUserIds.has(peer.userId) : false;
        const isTyping = typingConvIds.has(conv.id);
        const title = conv.title || (conv.kind === 'TEAM' ? '团队群聊' : '私聊');

        return (
          <motion.li key={conv.id} layout variants={variants.fadeUp} initial="initial" animate="animate" transition={transition.quick}>
            <button
              type="button"
              onClick={() => onSelect(conv)}
              aria-current={isActive ? 'true' : undefined}
              className="group relative flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors"
              style={{
                background: isActive
                  ? 'color-mix(in oklch, var(--aurora-1) 12%, transparent)'
                  : 'transparent',
              }}
            >
              {/* 非激活态：hover 浅底 */}
              {!isActive && (
                <span
                  className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ background: 'color-mix(in oklch, var(--ink-primary) 5%, transparent)' }}
                  aria-hidden
                />
              )}
              {/* 激活态：左侧极光光带（在会话间滑动） */}
              {isActive && (
                <motion.span
                  layoutId="conv-active-bar"
                  className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full"
                  style={{ background: 'var(--aurora-1)', boxShadow: '0 0 8px var(--aurora-1)' }}
                  aria-hidden
                />
              )}

              <div className="relative z-10 shrink-0">
                {conv.kind === 'DIRECT' ? (
                  <Avatar src={peer?.avatar} fallback={peer?.nickname || peer?.username || title} size="md" />
                ) : (
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full"
                    style={{ background: 'color-mix(in oklch, var(--aurora-1) 16%, transparent)', color: 'var(--aurora-1)' }}
                  >
                    <Hash size={18} />
                  </div>
                )}
                {peer && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2"
                    style={{
                      borderColor: 'var(--bg-leaf)',
                      background: online ? 'var(--signal-success)' : 'var(--ink-subtle)',
                    }}
                    aria-label={online ? '在线' : '离线'}
                  />
                )}
              </div>

              <div className="relative z-10 min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-[var(--ink-primary)]">{title}</span>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--ink-muted)]">
                    {formatListTime(conv.lastMessageAt || conv.lastMessage?.createdAt)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  {isTyping ? (
                    <span className="truncate text-[13px] text-[var(--aurora-1)]">正在输入…</span>
                  ) : (
                    <p className="truncate text-[13px] text-[var(--ink-muted)]">{previewText(conv)}</p>
                  )}
                  {conv.unreadCount > 0 && (
                    <span
                      className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold"
                      style={{ background: 'var(--aurora-1)', color: 'var(--bg-void)' }}
                    >
                      {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          </motion.li>
        );
      })}
    </ul>
  );
}
