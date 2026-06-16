'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, FileText } from 'lucide-react';
import { Avatar, spring, transition, variants } from '@aetherblog/ui';
import { sanitizeUrl } from '@/app/lib/sanitizeUrl';
import type { ChatMessage, ChatSettings } from '../lib/types';
import { crossesDay, formatDayLabel, formatSize, formatTime, withinGroupGap } from '../lib/format';

interface Props {
  messages: ChatMessage[];
  currentUserId: number;
  typingNames: string[];
  settings: ChatSettings;
  onLoadMore: () => void;
  hasMore: boolean;
}

/** 预计算的渲染单元：日期分隔 / 系统提示 / 气泡（带分组首尾标记）。 */
type Row =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'system'; key: string; content: string }
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

/**
 * 消息流：iMessage 式分组（连续同发送者折叠头像、仅末条带气泡尾角与时间）、
 * 日期分隔、入场淡入、动效打字气泡，以及滚离底部时浮现的「回到最新」按钮。
 */
export default function MessageThread({
  messages,
  currentUserId,
  typingNames,
  settings,
  onLoadMore,
  hasMore,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastIdRef = useRef<number | null>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);

  const accent = settings.accentColor || 'var(--aurora-1)';
  const fontFamily = settings.fontFamily || undefined;

  // 预计算分组与分隔，避免在 render 中反复比较相邻消息。
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const prev = messages[i - 1];
      const next = messages[i + 1];

      if (crossesDay(prev?.createdAt, m.createdAt)) {
        out.push({ kind: 'divider', key: `d-${m.id}`, label: formatDayLabel(m.createdAt) });
      }

      if (m.messageType === 'SYSTEM' || m.senderType === 'SYSTEM') {
        out.push({ kind: 'system', key: `s-${m.id}`, content: m.content || '' });
        continue;
      }

      const mine = m.senderType === 'USER' && m.senderId === currentUserId;
      const sameAsPrev =
        !!prev &&
        prev.messageType !== 'SYSTEM' &&
        prev.senderType !== 'SYSTEM' &&
        senderKey(prev) === senderKey(m) &&
        withinGroupGap(prev.createdAt, m.createdAt) &&
        !crossesDay(prev.createdAt, m.createdAt);
      const sameAsNext =
        !!next &&
        next.messageType !== 'SYSTEM' &&
        next.senderType !== 'SYSTEM' &&
        senderKey(next) === senderKey(m) &&
        withinGroupGap(m.createdAt, next.createdAt) &&
        !crossesDay(m.createdAt, next.createdAt);

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
  }, [messages, currentUserId]);

  const scrollToEnd = useCallback((behavior: ScrollBehavior = 'smooth') => {
    // 尊重 prefers-reduced-motion：开启时回退为即时滚动，避免眩晕。
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView({ behavior: prefersReduced ? 'auto' : behavior });
    setUnseen(0);
  }, []);

  // 追踪是否贴底（阈值 80px），决定新消息是自动滚底还是浮出「回到最新」。
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setUnseen(0);
  }, []);

  // 仅在底部追加新消息时滚动；切换会话（首帧）瞬时到底，加载历史不滚。
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

  // 自己仍贴底时，对方开始输入也跟随滚动，让打字气泡可见。
  useEffect(() => {
    if (typingNames.length > 0 && atBottomRef.current) {
      requestAnimationFrame(() => scrollToEnd('smooth'));
    }
  }, [typingNames, scrollToEnd]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
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
                <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--ink-muted)]">{row.label}</span>
                <span className="h-px flex-1" style={{ background: 'color-mix(in oklch, var(--ink-primary) 8%, transparent)' }} />
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

          const { msg: m, mine, isAgent, firstInGroup, lastInGroup } = row;
          const radius = bubbleRadius(settings.bubbleStyle, mine, lastInGroup);

          return (
            <motion.div
              key={row.key}
              variants={variants.fadeUp}
              initial="initial"
              animate="animate"
              transition={transition.quick}
              className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${firstInGroup ? 'mt-3' : 'mt-0.5'}`}
            >
              {!mine && (
                <div className="w-8 shrink-0 self-end">
                  {firstInGroup && <Avatar src={m.senderAvatar} fallback={m.senderName || '?'} size="sm" />}
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
                <div
                  className={`px-3.5 py-2 text-[15px] leading-relaxed ${radius}`}
                  style={
                    mine
                      ? { background: accent, color: 'var(--bg-void)' }
                      : {
                          background: 'var(--bg-leaf)',
                          color: 'var(--ink-primary)',
                          border: '1px solid color-mix(in oklch, var(--ink-primary) 8%, transparent)',
                        }
                  }
                >
                  <MessageBody m={m} mine={mine} />
                </div>
                {lastInGroup && (
                  <span className="mt-1 px-1 font-mono text-[10px] text-[var(--ink-subtle)]">
                    {formatTime(m.createdAt)}
                    {m.pending ? ' · 发送中…' : ''}
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
                <span className="mb-1 ml-1 text-[12px] text-[var(--ink-muted)]">
                  {typingNames.join('、')} 正在输入
                </span>
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
            className="absolute bottom-3 right-4 flex items-center gap-1.5 rounded-full py-2 pl-2 pr-3 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)]"
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
              <span className="font-mono text-[11px] font-semibold text-[var(--aurora-1)]">
                {unseen > 99 ? '99+' : unseen} 条新消息
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 消息正文：文本直出；附件先清洗 URL（仅放行 http(s) 与同源相对路径），失效给占位。 */
function MessageBody({ m, mine }: { m: ChatMessage; mine: boolean }) {
  if (m.messageType === 'TEXT' || m.messageType === 'SYSTEM') {
    return <span className="whitespace-pre-wrap break-words">{m.content}</span>;
  }
  const safeUrl = sanitizeUrl(m.attachmentUrl ?? '', '');
  if (!safeUrl) {
    return <span className="italic text-[var(--ink-muted)]">附件链接失效</span>;
  }
  switch (m.messageType) {
    case 'IMAGE':
      return (
        <a href={safeUrl} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={safeUrl}
            alt={m.attachmentName || 'image'}
            className="max-h-72 max-w-full rounded-xl"
            style={{ border: '1px solid color-mix(in oklch, var(--ink-primary) 8%, transparent)' }}
          />
        </a>
      );
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
      return <audio controls src={safeUrl} className="max-w-full" />;
    default:
      return <span className="whitespace-pre-wrap break-words">{m.content}</span>;
  }
}
