'use client';

import { useEffect, useRef } from 'react';
import { sanitizeUrl } from '@/app/lib/sanitizeUrl';
import type { ChatMessage, ChatSettings } from '../lib/types';

interface Props {
  messages: ChatMessage[];
  currentUserId: number;
  typingNames: string[];
  settings: ChatSettings;
  onLoadMore: () => void;
  hasMore: boolean;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function bubbleRadius(style: string, mine: boolean): string {
  switch (style) {
    case 'square':
      return 'rounded-md';
    case 'sharp':
      return mine ? 'rounded-2xl rounded-br-sm' : 'rounded-2xl rounded-bl-sm';
    default:
      return 'rounded-2xl';
  }
}

/** 消息流：气泡渲染 + 附件 + 打字提示，皮肤（气泡形状 / 主题色 / 字体）来自用户偏好。 */
export default function MessageThread({
  messages,
  currentUserId,
  typingNames,
  settings,
  onLoadMore,
  hasMore,
}: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastIdRef = useRef<number | null>(null);

  // 仅在追加到底部的新消息时滚到底，避免「加载更多历史」时跳动。
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && last.id !== lastIdRef.current) {
      lastIdRef.current = last.id;
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const accent = settings.accentColor || 'var(--aurora-1)';
  const fontFamily = settings.fontFamily || undefined;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4" style={{ fontFamily }}>
      {hasMore && (
        <div className="mb-4 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            className="rounded-full border border-[var(--ink-subtle)] px-4 py-1 text-sm text-[var(--ink-secondary)] transition hover:bg-[var(--bg-leaf)]"
          >
            加载更多历史
          </button>
        </div>
      )}
      <div className="flex flex-col gap-3">
        {messages.map((m) => {
          const mine = m.senderId === currentUserId;
          if (m.messageType === 'SYSTEM') {
            return (
              <div key={m.id} className="text-center text-xs text-[var(--ink-muted)]">
                {m.content}
              </div>
            );
          }
          return (
            <div key={m.clientMsgId || m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[75%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                {!mine && (
                  <span className="mb-0.5 flex items-center gap-1 text-xs text-[var(--ink-muted)]">
                    {m.senderName}
                    {m.senderType === 'AGENT' && (
                      <span className="rounded bg-[var(--aurora-2)] px-1 font-mono text-[9px] uppercase tracking-wider text-[var(--bg-void)]">
                        AI
                      </span>
                    )}
                  </span>
                )}
                <div
                  className={`px-3 py-2 text-[var(--ink-primary)] ${bubbleRadius(settings.bubbleStyle, mine)}`}
                  style={
                    mine
                      ? { background: accent, color: 'var(--bg-void)' }
                      : { background: 'var(--bg-leaf)' }
                  }
                >
                  {renderBody(m)}
                </div>
                <span className="mt-0.5 text-[10px] text-[var(--ink-muted)]">
                  {formatTime(m.createdAt)}
                  {m.pending ? ' · 发送中…' : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {typingNames.length > 0 && (
        <div className="mt-3 flex items-center gap-1 text-sm text-[var(--ink-muted)]">
          <span>{typingNames.join('、')} 正在输入</span>
          <span className="animate-pulse">…</span>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function renderBody(m: ChatMessage) {
  if (m.messageType === 'TEXT' || m.messageType === 'SYSTEM') {
    return <span className="whitespace-pre-wrap break-words">{m.content}</span>;
  }
  // 附件类消息：清洗 URL，仅放行 http(s) 与同源相对路径，拦截 javascript:/data: 等危险协议。
  // 缺失或不安全的 URL 给出友好占位，避免渲染失效图片 / 死链 / XSS 链接。
  const safeUrl = sanitizeUrl(m.attachmentUrl ?? '', '');
  if (!safeUrl) {
    return <span className="italic text-[var(--ink-muted)]">附件链接失效</span>;
  }
  switch (m.messageType) {
    case 'IMAGE':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={safeUrl} alt={m.attachmentName || 'image'} className="max-h-64 max-w-full rounded-lg" />
      );
    case 'FILE':
      return (
        <a href={safeUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline">
          📎 {m.attachmentName || '文件'}
        </a>
      );
    case 'VOICE':
      return <audio controls src={safeUrl} className="max-w-full" />;
    default:
      return <span className="whitespace-pre-wrap break-words">{m.content}</span>;
  }
}
