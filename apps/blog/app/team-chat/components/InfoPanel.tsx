'use client';

import { useMemo } from 'react';
import { BellOff, Bot, Pin, X } from 'lucide-react';
import { Avatar } from '@aetherblog/ui';
import { sanitizeUrl } from '@/app/lib/sanitizeUrl';
import type { ChatAgent, ChatConversation, ChatMessage, ChatSettings } from '../lib/types';
import { isStickerMeta } from '../lib/stickers';

interface Props {
  conv: ChatConversation;
  agents: ChatAgent[];
  messages: ChatMessage[];
  settings: ChatSettings;
  currentUserId: number;
  onClose: () => void;
  onTogglePinned: (next: boolean) => void;
  onToggleMuted: (next: boolean) => void;
  onBubbleStyle: (style: string) => void;
  onOpenImage: (url: string) => void;
}

const BUBBLE_STYLES = ['rounded', 'sharp', 'square'] as const;

/**
 * 会话信息面板 —— 设计规范 §2 第四区（按需展开）：
 * 成员（含在席智能体）、媒体墙（已加载历史中的图片，共用灯箱）、
 * 会话偏好（置顶 / 免打扰 → PUT /prefs）、气泡样式（→ PUT /settings）。
 */
export default function InfoPanel({
  conv,
  agents,
  messages,
  settings,
  currentUserId,
  onClose,
  onTogglePinned,
  onToggleMuted,
  onBubbleStyle,
  onOpenImage,
}: Props) {
  const mediaUrls = useMemo(() => {
    const out: string[] = [];
    for (const m of messages) {
      if (m.messageType !== 'IMAGE' || m.recalledAt || isStickerMeta(m.attachmentMeta)) continue;
      const u = sanitizeUrl(m.attachmentUrl ?? '', '');
      if (u) out.push(u);
    }
    return out.slice(-12).reverse();
  }, [messages]);

  return (
    // 桌面：静态右侧栏；移动端（<md）：右缘滑出抽屉覆盖消息区 ——
    // 375px 视口塞 270px 固定侧栏会把会话挤到不可用（评审 P1）。
    <aside
      className="absolute inset-y-0 right-0 z-40 flex w-[min(300px,85vw)] shrink-0 flex-col border-l border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.55)] md:static md:z-auto md:w-[270px] md:bg-[color-mix(in_oklch,var(--bg-leaf)_50%,transparent)] md:shadow-none"
      aria-label="会话信息"
    >
      <header className="flex items-center justify-between border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-4 py-3">
        <h3 className="font-display text-[15.5px] font-semibold text-[var(--ink-primary)]">会话信息</h3>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
          aria-label="关闭信息面板"
        >
          <X size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-3">
        {/* 成员 */}
        <section className="mb-5">
          <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            成员 · {(conv.members?.length ?? 0) + agents.length}
          </p>
          {(conv.members ?? []).map((m) => (
            <div key={m.userId} className="flex items-center gap-2.5 py-1.5">
              <Avatar src={m.avatar} fallback={m.nickname || m.username} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink-primary)]">
                {m.nickname || m.username}
                {m.userId === currentUserId ? '（我）' : ''}
              </span>
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                {m.memberRole}
              </span>
            </div>
          ))}
          {agents.map((a) => (
            <div key={`agent-${a.id}`} className="flex items-center gap-2.5 py-1.5">
              <span
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full"
                style={{ background: 'color-mix(in oklch, var(--aurora-1) 14%, transparent)', color: 'var(--aurora-1)' }}
              >
                <Bot size={15} />
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[13px] text-[var(--ink-primary)]">
                <span className="truncate">{a.name}</span>
                <span
                  className="shrink-0 rounded px-1 py-px font-mono text-[8.5px] uppercase tracking-wider"
                  style={{ background: 'color-mix(in oklch, var(--aurora-2) 22%, transparent)', color: 'var(--aurora-1)' }}
                >
                  AI
                </span>
              </span>
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">AGENT</span>
            </div>
          ))}
        </section>

        {/* 媒体墙 */}
        {mediaUrls.length > 0 && (
          <section className="mb-5">
            <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              媒体墙 · 最近 {mediaUrls.length}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {mediaUrls.map((u, i) => (
                <button
                  key={`${u}-${i}`}
                  type="button"
                  onClick={() => onOpenImage(u)}
                  className="aspect-square cursor-zoom-in overflow-hidden rounded-lg bg-[var(--bg-leaf)]"
                  aria-label="查看图片"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- 聊天附件为任意来源 URL */}
                  <img src={u} alt="媒体" loading="lazy" className="h-full w-full object-cover transition-transform duration-[260ms] hover:scale-105" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 会话偏好 */}
        <section className="mb-5">
          <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">会话偏好</p>
          <ToggleRow
            icon={<Pin size={15} />}
            label="置顶会话"
            on={conv.pinned}
            onToggle={() => onTogglePinned(!conv.pinned)}
          />
          <ToggleRow
            icon={<BellOff size={15} />}
            label="消息免打扰"
            on={conv.muted}
            onToggle={() => onToggleMuted(!conv.muted)}
          />
        </section>

        {/* 气泡样式（写回 chat_settings.bubble_style） */}
        <section>
          <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">气泡样式</p>
          <div className="flex gap-1.5">
            {BUBBLE_STYLES.map((v) => {
              const active = (settings.bubbleStyle || 'rounded') === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => onBubbleStyle(v)}
                  className="flex flex-1 flex-col items-center gap-1.5 rounded-[10px] border px-1 pb-[7px] pt-2 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors"
                  style={
                    active
                      ? {
                          borderColor: 'color-mix(in oklch, var(--aurora-1) 55%, transparent)',
                          color: 'var(--aurora-1)',
                          background: 'color-mix(in oklch, var(--aurora-1) 8%, transparent)',
                        }
                      : { borderColor: 'color-mix(in oklch, var(--ink-primary) 13%, transparent)', color: 'var(--ink-muted)' }
                  }
                >
                  <span
                    aria-hidden
                    className="h-4 w-[30px]"
                    style={{
                      background: active ? 'var(--aurora-1)' : 'color-mix(in oklch, var(--ink-primary) 22%, transparent)',
                      borderRadius: v === 'rounded' ? '8px 8px 8px 3px' : v === 'sharp' ? '7px 7px 7px 1px' : '4px',
                    }}
                  />
                  {v}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
}

function ToggleRow({
  icon,
  label,
  on,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-[7px] text-[13px] text-[var(--ink-primary)]">
      <span className="flex items-center gap-2 text-[var(--ink-secondary)]">
        <span className="text-[var(--ink-muted)]">{icon}</span>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
        style={{ background: on ? 'var(--aurora-1)' : 'color-mix(in oklch, var(--ink-primary) 14%, transparent)' }}
      >
        <span
          className="absolute left-[3px] top-[3px] h-4 w-4 rounded-full transition-transform"
          style={{
            background: on ? 'var(--bg-void)' : 'var(--ink-primary)',
            opacity: on ? 1 : 0.85,
            transform: on ? 'translateX(16px)' : 'translateX(0)',
          }}
        />
      </button>
    </div>
  );
}
