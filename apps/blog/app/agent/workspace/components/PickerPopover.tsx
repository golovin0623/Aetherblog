'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 触发按钮的 ref —— 用于决定 popover 锚点；点这个按钮也算"点了外部"以触发关闭。 */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** 标题（aria-label）。 */
  ariaLabel: string;
  children: React.ReactNode;
  /** 可选 className，让具体 picker 控制宽度等。 */
  className?: string;
}

/**
 * 通用 picker 弹层 —— 在按钮上方左对齐展开（top-start）。
 *
 * 与 ModelPicker 的弹层共享一致的视觉语义（surface-overlay + border + 投影），
 * 但单独抽出来是因为这三个 picker 的 trigger 锚点都在 Composer 内部的 ToolButton
 * 上，需要同一份"点击外部关闭 + ESC 关闭 + 锁背景滚动"的样板代码。
 */
export default function PickerPopover({
  open,
  onClose,
  anchorRef,
  ariaLabel,
  children,
  className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点外部关闭。点 anchor 自身由父组件控制 toggle，所以这里把 anchor 也排除。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={wrapRef}
          role="dialog"
          aria-modal="false"
          aria-label={ariaLabel}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          layout
          transition={{
            duration: 0.16,
            ease: [0.16, 1, 0.3, 1],
            layout: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
          }}
          // inline style 强制实色背景:surface-overlay 在暗模式下走 rgb(... / 0.70)
          // 玻璃半透明,EmptyState 背后有 aurora glow + 推荐卡片,picker 浮在
          // 上面会穿透看到下层。强制 var(--bg-leaf) 让弹层=信息焦点。
          // 与 ModelPicker.tsx 同一 fix。
          style={{ background: 'var(--bg-leaf)' }}
          className={`absolute left-0 bottom-full z-40 mb-3 overflow-hidden rounded-xl border border-[var(--ink-subtle)]/20 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.25)] surface-overlay ${className}`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
