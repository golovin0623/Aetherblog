'use client';

import { motion } from 'framer-motion';
import { BellOff, Check, CheckCheck, Clock, Hash, Pin, Users } from 'lucide-react';
import { Avatar, transition, variants } from '@aetherblog/ui';
import type { ChatConversation } from '../lib/types';
import { formatListTime } from '../lib/format';
import { isStickerMeta } from '../lib/stickers';

interface Props {
  conversations: ChatConversation[];
  activeId: number | null;
  onlineUserIds: Set<number>;
  /** 当前有人正在输入的会话 ID 集合（不含自己）。 */
  typingConvIds: Set<number>;
  currentUserId: number;
  /** 会话草稿（未发送内容），列表预览红字提示。 */
  drafts: ReadonlyMap<number, string>;
  onSelect: (conv: ChatConversation) => void;
  /** 右键会话 → 置顶 / 免打扰 / 标为已读 菜单。 */
  onContextMenu: (x: number, y: number, conv: ChatConversation) => void;
}

function previewText(conv: ChatConversation): string {
  const lm = conv.lastMessage;
  if (!lm) return '暂无消息';
  if (lm.recalledAt) return '撤回了一条消息';
  switch (lm.messageType) {
    case 'IMAGE':
      return isStickerMeta(lm.attachmentMeta) ? '[星灵贴纸]' : '[图片]';
    case 'FILE':
      return '[文件]';
    case 'VOICE':
      return '[语音]';
    default:
      return lm.content || '';
  }
}

/**
 * 会话侧栏 —— 置顶分组、未读极光徽标（免打扰降级灰点）、@我 信号红徽标、
 * 我方末条回执 ✓/✓✓ 预览、[草稿] 红字、在线点与输入态。右键唤起会话菜单。
 */
export default function ConversationList({
  conversations,
  activeId,
  onlineUserIds,
  typingConvIds,
  currentUserId,
  drafts,
  onSelect,
  onContextMenu,
}: Props) {
  if (conversations.length === 0) {
    return (
      <p className="px-4 py-12 text-center text-[13px] leading-relaxed text-[var(--ink-muted)]">暂无会话</p>
    );
  }

  const pinned = conversations.filter((c) => c.pinned);
  const rest = conversations.filter((c) => !c.pinned);

  const renderItem = (conv: ChatConversation) => {
    const isActive = conv.id === activeId;
    const peer = conv.kind === 'DIRECT' ? conv.members?.find((m) => m.userId !== currentUserId) : undefined;
    const online = peer ? onlineUserIds.has(peer.userId) : false;
    const isTyping = typingConvIds.has(conv.id);
    const title = conv.title || (conv.kind === 'TEAM' ? '团队群聊' : conv.kind === 'GROUP' ? '群聊' : '私聊');
    const draft = activeId !== conv.id ? drafts.get(conv.id) : undefined;
    const lm = conv.lastMessage;
    const mineLast = !!lm && lm.senderId === currentUserId && !lm.recalledAt;
    // 私聊已读回执预览：对端已读位点 ≥ 我方末条 → ✓✓。
    const peerRead =
      mineLast && conv.kind === 'DIRECT' && peer?.lastReadMessageId != null && lm!.id <= peer.lastReadMessageId;

    return (
      <motion.li key={conv.id} layout variants={variants.fadeUp} initial="initial" animate="animate" transition={transition.quick}>
        <button
          type="button"
          onClick={() => onSelect(conv)}
          onContextMenu={(e) => {
            e.preventDefault();
            onContextMenu(e.clientX, e.clientY, conv);
          }}
          aria-current={isActive ? 'true' : undefined}
          className="group relative flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors"
          style={{
            background: isActive ? 'color-mix(in oklch, var(--aurora-1) 12%, transparent)' : 'transparent',
          }}
        >
          {!isActive && (
            <span
              className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity group-hover:opacity-100"
              style={{ background: 'color-mix(in oklch, var(--ink-primary) 5%, transparent)' }}
              aria-hidden
            />
          )}
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
                style={
                  conv.kind === 'TEAM'
                    ? { background: 'color-mix(in oklch, var(--aurora-1) 16%, transparent)', color: 'var(--aurora-1)' }
                    : { background: 'color-mix(in oklch, var(--aurora-3) 18%, transparent)', color: 'var(--aurora-3)' }
                }
              >
                {conv.kind === 'TEAM' ? <Hash size={18} /> : <Users size={17} />}
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
              <span className="flex min-w-0 items-center gap-1 truncate font-medium text-[var(--ink-primary)]">
                {conv.pinned && <Pin size={11} className="shrink-0 text-[var(--ink-muted)]" aria-label="已置顶" />}
                <span className="truncate">{title}</span>
                {conv.muted && <BellOff size={11} className="shrink-0 text-[var(--ink-subtle)]" aria-label="免打扰" />}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-[var(--ink-muted)] [font-feature-settings:'tnum'_1]">
                {formatListTime(conv.lastMessageAt || conv.lastMessage?.createdAt)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              {isTyping ? (
                <span className="truncate text-[13px] text-[var(--aurora-1)]">正在输入…</span>
              ) : draft ? (
                <p className="truncate text-[13px] text-[var(--ink-muted)]">
                  <b className="font-medium" style={{ color: 'var(--signal-danger)' }}>
                    [草稿]
                  </b>{' '}
                  {draft}
                </p>
              ) : (
                <p className="flex min-w-0 items-center gap-1 truncate text-[13px] text-[var(--ink-muted)]">
                  {mineLast &&
                    (lm!.pending ? (
                      <Clock size={11} className="shrink-0 text-[var(--ink-subtle)]" />
                    ) : peerRead ? (
                      <CheckCheck size={12} className="shrink-0" style={{ color: 'var(--aurora-1)' }} />
                    ) : (
                      <Check size={12} className="shrink-0 text-[var(--ink-subtle)]" />
                    ))}
                  <span className="truncate">{previewText(conv)}</span>
                </p>
              )}
              <span className="flex shrink-0 items-center gap-1.5">
                {conv.mentionCount > 0 && (
                  <span
                    className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 font-mono text-[10.5px] font-semibold"
                    style={{ background: 'var(--signal-danger)', color: '#FFF7F2' }}
                    aria-label={`${conv.mentionCount} 条 @我`}
                  >
                    @
                  </span>
                )}
                {conv.unreadCount > 0 &&
                  (conv.muted && conv.mentionCount === 0 ? (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: 'color-mix(in oklch, var(--ink-primary) 30%, transparent)' }}
                      aria-label={`${conv.unreadCount} 条未读（免打扰）`}
                      title={`${conv.unreadCount} 条未读（免打扰）`}
                    />
                  ) : (
                    <span
                      className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-semibold [font-feature-settings:'tnum'_1]"
                      style={{ background: 'var(--aurora-1)', color: 'var(--bg-void)' }}
                    >
                      {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                    </span>
                  ))}
              </span>
            </div>
          </div>
        </button>
      </motion.li>
    );
  };

  return (
    <div className="flex flex-col px-2 pb-3">
      {pinned.length > 0 && (
        <>
          <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            <Pin size={10} />
            置顶
          </p>
          <ul className="flex flex-col gap-0.5">{pinned.map(renderItem)}</ul>
        </>
      )}
      {rest.length > 0 && (
        <>
          {pinned.length > 0 && (
            <p className="px-2.5 pb-1 pt-3 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">全部会话</p>
          )}
          <ul className="flex flex-col gap-0.5">{rest.map(renderItem)}</ul>
        </>
      )}
    </div>
  );
}
