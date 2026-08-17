'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Image from 'next/image';
import {
  AlertCircle,
  ArrowDown,
  Check,
  CheckCheck,
  Clock,
  CornerUpLeft,
  FileText,
  MoreHorizontal,
  Pause,
  Play,
} from 'lucide-react';
import { Avatar, spring, transition, variants } from '@aetherblog/ui';
import { sanitizeUrl } from '@/app/lib/sanitizeUrl';
import type { ChatMessage, ChatSettings } from '../lib/types';
import { crossesDay, formatDayLabel, formatSize, formatTime, withinGroupGap } from '../lib/format';
import { isStickerMeta } from '../lib/stickers';
import { QUICK_REACTIONS } from '../lib/emoji';

interface Props {
  messages: ChatMessage[];
  currentUserId: number;
  typingNames: string[];
  settings: ChatSettings;
  onLoadMore: () => void;
  hasMore: boolean;
  /** DIRECT 会话：对端已读位点（消息 id），决定 ✓ → ✓✓。群聊传 undefined，服务端落库即 ✓。 */
  peerReadCursor?: number;
  isDirect: boolean;
  /** 打开会话时的首条未读消息 id —— 渲染「以下为新消息」分隔线。 */
  firstUnreadId?: number | null;
  onToggleReaction: (msg: ChatMessage, emoji: string) => void;
  onReply: (msg: ChatMessage) => void;
  /** 右键 / 长按 / 「更多」按钮唤起消息菜单。 */
  onOpenMenu: (x: number, y: number, msg: ChatMessage) => void;
  /** 点击图片 → 父级灯箱（url 已 sanitize）。 */
  onOpenImage: (url: string) => void;
  /** 失败消息点「重试」。 */
  onRetry: (msg: ChatMessage) => void;
  /** 撤回占位上的「重新编辑」——把原文回填输入框。 */
  onReEdit: (text: string) => void;
}

/** 预计算的渲染单元：日期分隔 / 新消息分隔 / 系统提示或撤回占位 / 气泡（带分组首尾标记）。 */
type Row =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'new-divider'; key: string }
  | { kind: 'system'; key: string; content: string }
  | { kind: 'recalled'; key: string; msg: ChatMessage; mine: boolean }
  | {
      kind: 'msg';
      key: string;
      msg: ChatMessage;
      mine: boolean;
      isAgent: boolean;
      firstInGroup: boolean;
      lastInGroup: boolean;
    };

function senderKey(m: ChatMessage): string {
  return `${m.senderType}:${m.senderId ?? ''}:${m.senderName ?? ''}`;
}

function groupable(m: ChatMessage): boolean {
  return m.messageType !== 'SYSTEM' && m.senderType !== 'SYSTEM' && !m.recalledAt;
}

/**
 * 气泡圆角 —— 尊重用户保存的 bubbleStyle 偏好：
 *  · square：四角小圆角，无尾角
 *  · sharp：圆角 + 末条尖锐尾角
 *  · rounded（默认）：iMessage 式圆角 + 末条柔和尾角
 */
function bubbleRadius(style: string | undefined, mine: boolean, lastInGroup: boolean): string {
  if (style === 'square') return 'rounded-md';
  if (!lastInGroup) return 'rounded-2xl';
  if (style === 'sharp') return mine ? 'rounded-2xl rounded-br-sm' : 'rounded-2xl rounded-bl-sm';
  return mine ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-bl-md';
}

/** 消息摘要（引用块 / 列表预览共用口径）。 */
export function messageSummary(m: ChatMessage): string {
  if (m.recalledAt) return '已撤回的消息';
  switch (m.messageType) {
    case 'IMAGE':
      return isStickerMeta(m.attachmentMeta) ? '[星灵贴纸]' : '[图片]';
    case 'FILE':
      return '[文件]';
    case 'VOICE':
      return '[语音]';
    default:
      return m.content || '';
  }
}

/** 引用预览快照的摘要（被引用消息不在已加载历史页时的兜底口径）。 */
function previewSummary(p: NonNullable<ChatMessage['replyPreview']>): string {
  if (p.recalled) return '已撤回的消息';
  switch (p.messageType) {
    case 'IMAGE':
      return p.sticker ? '[星灵贴纸]' : '[图片]';
    case 'FILE':
      return '[文件]';
    case 'VOICE':
      return '[语音]';
    default:
      return p.content || '';
  }
}

/** 把 @提及 高亮为极光色（纯展示，不构造 DOM 注入 —— React 文本节点安全）。 */
function renderTextWithMentions(text: string, mine: boolean): React.ReactNode {
  const parts = text.split(/(@[一-龥A-Za-z0-9_]+)/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    p.startsWith('@') && p.length > 1 ? (
      <span
        key={i}
        className="font-medium"
        style={mine ? { textDecoration: 'underline', textUnderlineOffset: 2 } : { color: 'var(--aurora-1)' }}
      >
        {p}
      </span>
    ) : (
      p
    ),
  );
}

/**
 * 消息流：iMessage 式分组、日期 § 分隔、「以下为新消息」、悬停快捷回应条、
 * 回应聚合 chips、引用块点击跳回原文、✓/✓✓ 已读回执、撤回占位、贴纸 / 波形语音渲染、
 * 右键与长按菜单、动效打字气泡与「回到最新」。
 */
export default function MessageThread({
  messages,
  currentUserId,
  typingNames,
  settings,
  onLoadMore,
  hasMore,
  peerReadCursor,
  isDirect,
  firstUnreadId,
  onToggleReaction,
  onReply,
  onOpenMenu,
  onOpenImage,
  onRetry,
  onReEdit,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastIdRef = useRef<number | null>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [flashId, setFlashId] = useState<number | null>(null);
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number }>({ timer: null, x: 0, y: 0 });

  const accent = settings.accentColor || 'var(--aurora-1)';
  const fontFamily = settings.fontFamily || undefined;
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const prev = messages[i - 1];
      const next = messages[i + 1];

      if (crossesDay(prev?.createdAt, m.createdAt)) {
        out.push({ kind: 'divider', key: `d-${m.id}`, label: formatDayLabel(m.createdAt) });
      }
      if (firstUnreadId != null && m.id === firstUnreadId) {
        out.push({ kind: 'new-divider', key: `nd-${m.id}` });
      }
      if (m.recalledAt) {
        out.push({ kind: 'recalled', key: `r-${m.id}`, msg: m, mine: m.senderType === 'USER' && m.senderId === currentUserId });
        continue;
      }
      if (m.messageType === 'SYSTEM' || m.senderType === 'SYSTEM') {
        out.push({ kind: 'system', key: `s-${m.id}`, content: m.content || '' });
        continue;
      }

      const mine = m.senderType === 'USER' && m.senderId === currentUserId;
      const sameAsPrev =
        !!prev && groupable(prev) && senderKey(prev) === senderKey(m) &&
        withinGroupGap(prev.createdAt, m.createdAt) && !crossesDay(prev.createdAt, m.createdAt) &&
        !(firstUnreadId != null && m.id === firstUnreadId);
      const sameAsNext =
        !!next && groupable(next) && senderKey(next) === senderKey(m) &&
        withinGroupGap(m.createdAt, next.createdAt) && !crossesDay(m.createdAt, next.createdAt) &&
        !(firstUnreadId != null && next.id === firstUnreadId);

      out.push({
        kind: 'msg',
        key: m.clientMsgId || `m-${m.id}`,
        msg: m,
        mine,
        isAgent: m.senderType === 'AGENT',
        firstInGroup: !sameAsPrev,
        lastInGroup: !sameAsNext,
      });
    }
    return out;
  }, [messages, currentUserId, firstUnreadId]);

  const scrollToEnd = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const prefersReduced =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView({ behavior: prefersReduced ? 'auto' : behavior });
    setUnseen(0);
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = near;
    setAtBottom(near);
    setScrolled(el.scrollTop > 8);
    if (near) setUnseen(0);
  }, []);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.id === lastIdRef.current) return;
    const firstPaint = lastIdRef.current === null;
    lastIdRef.current = last.id;
    if (firstPaint) {
      requestAnimationFrame(() => scrollToEnd('auto'));
    } else if (atBottomRef.current || last.senderId === currentUserId) {
      requestAnimationFrame(() => scrollToEnd('smooth'));
    } else {
      setUnseen((n) => n + 1);
    }
  }, [messages, currentUserId, scrollToEnd]);

  useEffect(() => {
    if (typingNames.length > 0 && atBottomRef.current) {
      requestAnimationFrame(() => scrollToEnd('smooth'));
    }
  }, [typingNames, scrollToEnd]);

  /** 引用块点击：滚到原文并极光闪烁定位。 */
  const jumpToMsg = useCallback((id: number) => {
    const node = document.getElementById(`chat-msg-${id}`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashId(null);
    requestAnimationFrame(() => setFlashId(id));
  }, []);

  useEffect(() => {
    if (flashId === null) return;
    const t = setTimeout(() => setFlashId(null), 2300);
    return () => clearTimeout(t);
  }, [flashId]);

  /** 触屏长按 480ms 唤起菜单（滑动 8px 内视为按住）。 */
  const onPointerDown = useCallback(
    (e: React.PointerEvent, msg: ChatMessage) => {
      if (e.pointerType !== 'touch' || msg.recalledAt) return;
      longPress.current.x = e.clientX;
      longPress.current.y = e.clientY;
      longPress.current.timer = setTimeout(() => onOpenMenu(longPress.current.x, longPress.current.y, msg), 480);
    },
    [onOpenMenu],
  );
  const cancelLongPress = useCallback((e?: React.PointerEvent) => {
    if (e && e.type === 'pointermove' && Math.hypot(e.clientX - longPress.current.x, e.clientY - longPress.current.y) < 8) return;
    if (longPress.current.timer) {
      clearTimeout(longPress.current.timer);
      longPress.current.timer = null;
    }
  }, []);

  /** 我方消息的回执三态：pending 钟面 → ✓（落库/群聊终态）→ ✓✓（私聊对端已读）。 */
  const receipt = (m: ChatMessage): React.ReactNode => {
    if (m.failed) {
      return (
        <span className="inline-flex items-center gap-1 text-[var(--signal-danger)]">
          <AlertCircle size={12} />
          <button type="button" onClick={() => onRetry(m)} className="underline underline-offset-2">
            重试
          </button>
        </span>
      );
    }
    if (m.pending) return <Clock size={12} className="animate-pulse text-[var(--ink-subtle)]" />;
    if (isDirect && peerReadCursor != null && m.id <= peerReadCursor) {
      return <CheckCheck size={13} style={{ color: 'var(--aurora-1)' }} aria-label="已读" />;
    }
    return <Check size={13} className="text-[var(--ink-subtle)]" aria-label="已送达" />;
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-6 transition-opacity duration-[260ms]"
        style={{
          background: 'linear-gradient(to bottom, color-mix(in oklch, var(--bg-substrate) 78%, transparent), transparent)',
          opacity: scrolled ? 1 : 0,
        }}
      />
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4" style={{ fontFamily }}>
        {hasMore && (
          <div className="mb-4 flex justify-center">
            <button
              type="button"
              onClick={onLoadMore}
              className="rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
            >
              加载更早的消息
            </button>
          </div>
        )}

        {rows.map((row) => {
          if (row.kind === 'divider') {
            return (
              <div key={row.key} className="my-5 flex items-center gap-3">
                <span className="h-px flex-1" style={{ background: 'color-mix(in oklch, var(--ink-primary) 8%, transparent)' }} />
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  <span className="font-editorial text-[13px] normal-case" style={{ color: 'color-mix(in oklch, var(--aurora-1) 75%, var(--ink-muted))' }}>
                    §
                  </span>
                  {row.label}
                </span>
                <span className="h-px flex-1" style={{ background: 'color-mix(in oklch, var(--ink-primary) 8%, transparent)' }} />
              </div>
            );
          }
          if (row.kind === 'new-divider') {
            return (
              <div key={row.key} className="my-4 flex items-center gap-3">
                <span className="h-px flex-1" style={{ background: 'color-mix(in oklch, var(--aurora-1) 35%, transparent)' }} />
                <span className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--aurora-1)' }}>
                  以下为新消息
                </span>
                <span className="h-px flex-1" style={{ background: 'color-mix(in oklch, var(--aurora-1) 35%, transparent)' }} />
              </div>
            );
          }
          if (row.kind === 'system') {
            return (
              <div key={row.key} className="my-2.5 flex justify-center">
                <span
                  className="rounded-full px-3 py-1 text-center text-[12px] text-[var(--ink-muted)]"
                  style={{ background: 'color-mix(in oklch, var(--ink-primary) 5%, transparent)' }}
                >
                  {row.content}
                </span>
              </div>
            );
          }
          if (row.kind === 'recalled') {
            return (
              <div key={row.key} className="my-2.5 flex justify-center">
                <span
                  className="rounded-full px-3 py-1 text-center text-[12px] text-[var(--ink-muted)]"
                  style={{ background: 'color-mix(in oklch, var(--ink-primary) 5%, transparent)' }}
                >
                  {row.mine ? '你' : row.msg.senderName || '对方'}撤回了一条消息
                  {row.mine && row.msg.localOrigText ? (
                    <button
                      type="button"
                      onClick={() => onReEdit(row.msg.localOrigText || '')}
                      className="ml-1.5 underline underline-offset-2"
                      style={{ color: 'var(--aurora-1)' }}
                    >
                      重新编辑
                    </button>
                  ) : null}
                </span>
              </div>
            );
          }

          const { msg: m, mine, isAgent, firstInGroup, lastInGroup } = row;
          const radius = bubbleRadius(settings.bubbleStyle, mine, lastInGroup);
          const sticker = m.messageType === 'IMAGE' && isStickerMeta(m.attachmentMeta);
          const bare = sticker; // 贴纸无气泡
          const quoted = m.replyToId ? byId.get(m.replyToId) : undefined;

          return (
            <motion.div
              key={row.key}
              id={`chat-msg-${m.id}`}
              variants={variants.fadeUp}
              initial="initial"
              animate="animate"
              transition={transition.quick}
              className={`group/msg flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${firstInGroup ? 'mt-3' : 'mt-0.5'}`}
              onContextMenu={(e) => {
                e.preventDefault();
                onOpenMenu(e.clientX, e.clientY, m);
              }}
              onPointerDown={(e) => onPointerDown(e, m)}
              onPointerUp={() => cancelLongPress()}
              onPointerMove={(e) => cancelLongPress(e)}
              onPointerCancel={() => cancelLongPress()}
            >
              {!mine && (
                <div className="w-8 shrink-0 self-end">
                  {lastInGroup && <Avatar src={m.senderAvatar} fallback={m.senderName || '?'} size="sm" />}
                </div>
              )}

              <div className={`flex max-w-[78%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                {!mine && firstInGroup && (
                  <span className="mb-1 ml-1 flex items-center gap-1.5 text-[12px] text-[var(--ink-muted)]">
                    {m.senderName || '成员'}
                    {isAgent && (
                      <span
                        className="rounded px-1 py-px font-mono text-[9px] uppercase tracking-wider"
                        style={{ background: 'color-mix(in oklch, var(--aurora-2) 22%, transparent)', color: 'var(--aurora-1)' }}
                      >
                        AI
                      </span>
                    )}
                  </span>
                )}

                <div className={`relative flex items-center gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
                  {/* 悬停快捷条：三枚高频回应 + 回复 + 更多（触屏走长按菜单） */}
                  <div
                    className={`pointer-events-none absolute -top-9 z-[5] flex items-center gap-px rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_13%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_88%,transparent)] p-[3px] opacity-0 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)] backdrop-blur-[24px] backdrop-saturate-[140%] transition-all duration-[260ms] [@media(hover:hover)]:group-hover/msg:pointer-events-auto [@media(hover:hover)]:group-hover/msg:opacity-100 ${mine ? 'right-0' : 'left-0'}`}
                  >
                    {QUICK_REACTIONS.slice(0, 3).map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => onToggleReaction(m, e)}
                        className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[15px] transition-transform hover:scale-[1.12] hover:bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)]"
                        aria-label={`回应 ${e}`}
                      >
                        {e}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onReply(m)}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[var(--ink-secondary)] transition-transform hover:scale-[1.12] hover:bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)]"
                      aria-label="回复"
                    >
                      <CornerUpLeft size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        onOpenMenu(r.left, r.bottom + 6, m);
                      }}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[var(--ink-secondary)] transition-transform hover:scale-[1.12] hover:bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)]"
                      aria-label="更多操作"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>

                  <div
                    className={
                      bare
                        ? 'transition-transform duration-[260ms] hover:-rotate-1 hover:scale-[1.04]'
                        : `px-3.5 py-2 text-[15px] leading-relaxed ${radius} ${flashId === m.id ? 'chat-flash-target' : ''}`
                    }
                    style={
                      bare
                        ? { filter: 'drop-shadow(0 6px 16px color-mix(in oklch, var(--aurora-1) 25%, transparent))' }
                        : mine
                          ? { background: accent, color: 'var(--bg-void)' }
                          : {
                              background: 'var(--bg-leaf)',
                              color: 'var(--ink-primary)',
                              border: '1px solid color-mix(in oklch, var(--ink-primary) 8%, transparent)',
                            }
                    }
                  >
                    {!bare && (quoted || m.replyPreview) && (
                      <button
                        type="button"
                        onClick={() => quoted && jumpToMsg(quoted.id)}
                        title={quoted ? '跳到原消息' : '原消息在更早的历史中'}
                        className={`mb-1.5 block w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-md px-2.5 py-1 text-left text-[12px] leading-normal ${quoted ? '' : 'cursor-default'}`}
                        style={
                          mine
                            ? {
                                borderLeft: '2.5px solid color-mix(in oklch, var(--bg-void) 50%, transparent)',
                                background: 'color-mix(in oklch, var(--bg-void) 16%, transparent)',
                                color: 'inherit',
                              }
                            : {
                                borderLeft: '2.5px solid color-mix(in oklch, var(--aurora-1) 65%, transparent)',
                                background: 'color-mix(in oklch, var(--ink-primary) 6%, transparent)',
                                color: 'var(--ink-secondary)',
                              }
                        }
                      >
                        <span className="block text-[11px] font-medium" style={mine ? { opacity: 0.85 } : { color: 'var(--aurora-1)' }}>
                          {quoted
                            ? quoted.senderName || (quoted.senderId === currentUserId ? '我' : '成员')
                            : m.replyPreview!.senderName || '成员'}
                        </span>
                        {quoted ? messageSummary(quoted) : previewSummary(m.replyPreview!)}
                      </button>
                    )}
                    <MessageBody m={m} mine={mine} sticker={sticker} onOpenImage={onOpenImage} />
                  </div>
                </div>

                {/* 回应聚合 chips */}
                {m.reactions && m.reactions.length > 0 && (
                  <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : ''}`}>
                    {m.reactions.map((r) => {
                      const minean = r.userIds.includes(currentUserId);
                      return (
                        <motion.button
                          key={r.emoji}
                          type="button"
                          initial={{ scale: 0.4 }}
                          animate={{ scale: 1 }}
                          transition={spring.bouncy}
                          onClick={() => onToggleReaction(m, r.emoji)}
                          title={`${r.userIds.length} 人回应`}
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-px text-[12px] transition-transform hover:-translate-y-px"
                          style={
                            minean
                              ? {
                                  borderColor: 'color-mix(in oklch, var(--aurora-1) 55%, transparent)',
                                  background: 'color-mix(in oklch, var(--aurora-1) 13%, transparent)',
                                  color: 'var(--aurora-1)',
                                }
                              : {
                                  borderColor: 'color-mix(in oklch, var(--ink-primary) 13%, transparent)',
                                  background: 'color-mix(in oklch, var(--bg-leaf) 80%, transparent)',
                                  color: 'var(--ink-secondary)',
                                }
                          }
                        >
                          {r.emoji}
                          <span className="font-mono text-[10px] [font-feature-settings:'tnum'_1]">{r.userIds.length}</span>
                        </motion.button>
                      );
                    })}
                  </div>
                )}

                {lastInGroup && (
                  <span className="mt-1 flex items-center gap-1 px-1 font-mono text-[10px] text-[var(--ink-subtle)] [font-feature-settings:'tnum'_1]">
                    {mine && receipt(m)}
                    {formatTime(m.createdAt)}
                    {m.editedAt ? <span className="tracking-[0.04em]">(已编辑)</span> : null}
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}

        {/* 打字气泡 */}
        <AnimatePresence>
          {typingNames.length > 0 && (
            <motion.div
              variants={variants.fadeUp}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transition.quick}
              className="mt-3 flex items-end gap-2"
            >
              <div className="w-8 shrink-0" />
              <div className="flex flex-col items-start">
                <span className="mb-1 ml-1 text-[12px] text-[var(--ink-muted)]">{typingNames.join('、')} 正在输入</span>
                <div
                  className="flex items-center gap-1 rounded-2xl rounded-bl-md px-4 py-3"
                  style={{ background: 'var(--bg-leaf)', border: '1px solid color-mix(in oklch, var(--ink-primary) 8%, transparent)' }}
                >
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: 'var(--ink-muted)' }}
                      animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut', delay: i * 0.18 }}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={endRef} />
      </div>

      {/* 回到最新 —— 滚离底部时浮现，带未读计数 */}
      <AnimatePresence>
        {!atBottom && (
          <motion.button
            type="button"
            onClick={() => scrollToEnd('smooth')}
            initial={{ opacity: 0, scale: 0.8, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 8 }}
            transition={spring.bouncy}
            className="absolute bottom-3 right-4 z-[4] flex items-center gap-1.5 rounded-full py-2 pl-2 pr-3 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)]"
            style={{ background: 'var(--bg-raised)', border: '1px solid color-mix(in oklch, var(--ink-primary) 10%, transparent)' }}
            aria-label="回到最新消息"
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full"
              style={{ background: 'color-mix(in oklch, var(--aurora-1) 16%, transparent)', color: 'var(--aurora-1)' }}
            >
              <ArrowDown size={14} />
            </span>
            {unseen > 0 && (
              <span className="font-mono text-[11px] font-semibold text-[var(--aurora-1)] [font-feature-settings:'tnum'_1]">
                {unseen > 99 ? '99+' : unseen} 条新消息
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* 引用定位闪烁（规范 §7：1.1s × 2 极光外环）。普通 style 标签，避免 app router 下 styled-jsx 的 SSR registry 依赖。 */}
      <style>{`
        @keyframes chat-flash-target {
          0% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--aurora-1) 55%, transparent); }
          35% { box-shadow: 0 0 0 5px color-mix(in oklch, var(--aurora-1) 30%, transparent); }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
        .chat-flash-target { animation: chat-flash-target 1.1s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) 2; }
        @media (prefers-reduced-motion: reduce) {
          .chat-flash-target { animation: none; outline: 2px solid color-mix(in oklch, var(--aurora-1) 55%, transparent); }
        }
      `}</style>
    </div>
  );
}

/** 消息正文：文本(@高亮) / 图片(占位色→淡入,点击灯箱) / 贴纸 / 文件卡 / 波形语音。 */
function MessageBody({
  m,
  mine,
  sticker,
  onOpenImage,
}: {
  m: ChatMessage;
  mine: boolean;
  sticker: boolean;
  onOpenImage: (url: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  if (m.messageType === 'TEXT' || m.messageType === 'SYSTEM') {
    return <span className="whitespace-pre-wrap break-words">{renderTextWithMentions(m.content || '', mine)}</span>;
  }
  const safeUrl = sanitizeUrl(m.attachmentUrl ?? '', '');
  if (!safeUrl) {
    return <span className="italic text-[var(--ink-muted)]">附件链接失效</span>;
  }
  if (sticker) {
    return (
      <Image
        src={safeUrl}
        alt={m.attachmentName || '贴纸'}
        width={108}
        height={108}
        unoptimized
        className="h-[108px] w-[108px]"
      />
    );
  }
  switch (m.messageType) {
    case 'IMAGE': {
      const meta = m.attachmentMeta || {};
      const ph = typeof meta.ph === 'string' && /^#[0-9a-fA-F]{6}$/.test(meta.ph) ? meta.ph : undefined;
      const w = typeof meta.width === 'number' ? meta.width : undefined;
      const h = typeof meta.height === 'number' ? meta.height : undefined;
      return (
        <button
          type="button"
          onClick={() => onOpenImage(safeUrl)}
          className="relative -mx-1 -my-0.5 block cursor-zoom-in overflow-hidden rounded-xl"
          style={w && h ? { aspectRatio: `${w} / ${h}`, maxHeight: 300, maxWidth: '100%' } : undefined}
          aria-label="查看图片"
        >
          {ph && (
            <span
              aria-hidden
              className="absolute inset-0 transition-opacity duration-[520ms]"
              style={{ background: ph, opacity: loaded ? 0 : 1 }}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- 聊天附件为任意来源 URL，next/image 域白名单不适用 */}
          <img
            src={safeUrl}
            alt={m.attachmentName || 'image'}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            className="max-h-72 max-w-full rounded-xl transition-transform duration-[520ms] hover:scale-[1.03]"
            style={{ border: '1px solid color-mix(in oklch, var(--ink-primary) 8%, transparent)' }}
          />
        </button>
      );
    }
    case 'FILE':
      return (
        <a
          href={safeUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5"
          style={{ color: mine ? 'var(--bg-void)' : 'var(--ink-primary)' }}
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={
              mine
                ? { background: 'color-mix(in oklch, white 22%, transparent)' }
                : { background: 'color-mix(in oklch, var(--aurora-1) 14%, transparent)', color: 'var(--aurora-1)' }
            }
          >
            <FileText size={18} />
          </span>
          <span className="min-w-0">
            <span className="block max-w-[12rem] truncate text-[14px] font-medium underline-offset-2 hover:underline">
              {m.attachmentName || '文件'}
            </span>
            {m.attachmentSize ? (
              <span className="block font-mono text-[10px] opacity-70">{formatSize(m.attachmentSize)}</span>
            ) : null}
          </span>
        </a>
      );
    case 'VOICE':
      return <VoiceBody url={safeUrl} meta={m.attachmentMeta} mine={mine} />;
    default:
      return <span className="whitespace-pre-wrap break-words">{m.content}</span>;
  }
}

/** 波形语音播放器：meta.peaks 逐段点亮；无 peaks 元数据回退原生 audio。 */
function VoiceBody({ url, meta, mine }: { url: string; meta?: Record<string, unknown>; mine: boolean }) {
  const peaks = useMemo(() => {
    const raw = meta?.peaks;
    if (!Array.isArray(raw)) return null;
    const nums = raw.filter((v): v is number => typeof v === 'number' && isFinite(v));
    return nums.length >= 8 ? nums.slice(0, 48) : null;
  }, [meta]);
  const duration = typeof meta?.duration === 'number' ? Math.round(meta.duration as number) : null;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setProgress(el.duration ? el.currentTime / el.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnd);
    };
  }, []);

  if (!peaks) {
    return <audio controls src={url} className="max-w-full" preload="metadata" />;
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const shown = playing && audioRef.current?.duration
    ? fmt(audioRef.current.currentTime)
    : duration != null
      ? fmt(duration)
      : '';

  return (
    <span className="flex min-w-[168px] items-center gap-2.5">
      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={() => {
          const el = audioRef.current;
          if (!el) return;
          if (playing) {
            el.pause();
            setPlaying(false);
          } else {
            void el.play().then(() => setPlaying(true)).catch(() => {});
          }
        }}
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full transition-transform active:scale-90"
        style={
          mine
            ? { background: 'color-mix(in oklch, var(--bg-void) 18%, transparent)', color: 'inherit' }
            : { background: 'color-mix(in oklch, var(--aurora-1) 16%, transparent)', color: 'var(--aurora-1)' }
        }
        aria-label={playing ? '暂停' : '播放语音'}
      >
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <span className="flex h-[26px] flex-1 items-center gap-[2px]" aria-hidden>
        {peaks.map((p, i) => (
          <span
            key={i}
            className="w-[2.5px] rounded-sm transition-colors"
            style={{
              height: `${Math.max(4, Math.min(1, Math.abs(p)) * 22)}px`,
              background:
                i / peaks.length <= progress && playing
                  ? 'currentColor'
                  : 'color-mix(in oklch, currentColor 38%, transparent)',
            }}
          />
        ))}
      </span>
      {shown && <span className="shrink-0 font-mono text-[10.5px] opacity-80 [font-feature-settings:'tnum'_1]">{shown}</span>}
    </span>
  );
}
