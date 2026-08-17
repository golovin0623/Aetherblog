'use client';

import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { transition } from '@aetherblog/ui';

export interface LightboxImage {
  url: string;
  /** 说明行：发送者 · 时间。 */
  caption: string;
}

interface Props {
  images: LightboxImage[];
  index: number | null;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

/**
 * 图片灯箱 —— 设计规范 §5 第六步：深空遮罩 + 24px 模糊，←/→ 切换同会话图片，
 * Esc / 点击遮罩关闭。portal 到 body，独立于聊天滚动容器。
 */
export default function Lightbox({ images, index, onNavigate, onClose }: Props) {
  const open = index !== null && index >= 0 && index < images.length;

  const nav = useCallback(
    (d: number) => {
      if (index === null || images.length === 0) return;
      onNavigate((index + d + images.length) % images.length);
    },
    [index, images.length, onNavigate],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') nav(-1);
      else if (e.key === 'ArrowRight') nav(1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, nav, onClose]);

  if (typeof document === 'undefined') return null;
  const img = open ? images[index] : null;

  return createPortal(
    <AnimatePresence>
      {img && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition.quick}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-[color-mix(in_oklch,var(--bg-void)_88%,transparent)] backdrop-blur-[24px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          role="dialog"
          aria-label="图片查看"
        >
          <div className="flex max-h-[82vh] max-w-[min(920px,88vw)] flex-col gap-3">
            <motion.img
              key={img.url}
              initial={{ scale: 0.94, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={transition.quick}
              src={img.url}
              alt={img.caption}
              className="max-h-[calc(82vh-50px)] max-w-full rounded-2xl object-contain shadow-[0_40px_120px_-30px_rgba(0,0,0,0.8)]"
            />
            <div className="flex items-center justify-between gap-3 font-mono text-[11px] tracking-[0.05em] text-[var(--ink-secondary)] [font-feature-settings:'tnum'_1]">
              <span>
                {img.caption} · {index! + 1} / {images.length}
              </span>
              <span className="text-[var(--ink-muted)]">Esc 关闭 · ←→ 切换</span>
            </div>
          </div>

          {images.length > 1 && (
            <>
              <LbNav side="left" onClick={() => nav(-1)}>
                <ChevronLeft size={19} />
              </LbNav>
              <LbNav side="right" onClick={() => nav(1)}>
                <ChevronRight size={19} />
              </LbNav>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_13%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_70%,transparent)] text-[var(--ink-primary)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] hover:text-[var(--aurora-1)]"
          >
            <X size={18} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function LbNav({ side, onClick, children }: { side: 'left' | 'right'; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? '上一张' : '下一张'}
      className={`absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_13%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_70%,transparent)] text-[var(--ink-primary)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] hover:text-[var(--aurora-1)] ${side === 'left' ? 'left-5' : 'right-5'}`}
    >
      {children}
    </button>
  );
}
