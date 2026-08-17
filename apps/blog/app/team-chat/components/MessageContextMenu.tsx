'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { transition } from '@aetherblog/ui';
import { QUICK_REACTIONS } from '../lib/emoji';

export interface MenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  /** 右缘的键位 / 说明小字（如 "2min"）。 */
  hint?: string;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
  /** 顶部快捷回应排；undefined 则不渲染（会话右键菜单不需要）。 */
  onReact?: (emoji: string) => void;
  onSelect: (key: string) => void;
}

interface Props {
  state: MenuState | null;
  onClose: () => void;
}

/**
 * 消息 / 会话右键菜单（surface-overlay）。fixed 定位 + 视口收敛，portal 到 body
 * 避免被会话滚动容器裁剪；点外 / 滚动 / ESC 关闭。
 */
export default function MessageContextMenu({ state, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // 首帧测量后收敛到视口内，避免菜单溢出右 / 下边缘。
  useLayoutEffect(() => {
    if (!state || !ref.current) {
      setPos(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(state.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(state.y, window.innerHeight - r.height - 8)),
    });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [state, onClose]);

  if (!state || typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.94, y: -3 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={transition.instant}
      className="fixed z-[70] min-w-[180px] rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_13%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_88%,transparent)] p-1.5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)] backdrop-blur-[40px] backdrop-saturate-[180%]"
      style={{
        left: (pos ?? state).x,
        top: (pos ?? state).y,
        visibility: pos ? 'visible' : 'hidden',
        transformOrigin: 'top left',
      }}
      role="menu"
    >
      {state.onReact && (
        <>
          <div className="flex gap-0.5 px-1 pb-1.5 pt-0.5">
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  state.onReact?.(e);
                  onClose();
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[17px] transition-transform hover:scale-[1.15] hover:bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)]"
                aria-label={`回应 ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
          <hr className="mx-2 mb-1 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
        </>
      )}
      {state.items.map((it) => {
        const Icon = it.icon;
        return (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            onClick={() => {
              state.onSelect(it.key);
              onClose();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors"
            style={{ color: it.danger ? 'var(--signal-danger)' : 'var(--ink-primary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = it.danger
                ? 'color-mix(in oklch, var(--signal-danger) 12%, transparent)'
                : 'color-mix(in oklch, var(--aurora-1) 12%, transparent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Icon size={15} className="shrink-0 opacity-80" />
            {it.label}
            {it.hint && (
              <span className="ml-auto font-mono text-[9.5px] text-[var(--ink-muted)]">{it.hint}</span>
            )}
          </button>
        );
      })}
    </motion.div>,
    document.body,
  );
}
