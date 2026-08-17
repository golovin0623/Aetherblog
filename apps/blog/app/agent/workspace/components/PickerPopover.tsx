'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, ease } from '@aetherblog/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 触发按钮的 ref —— 用于决定 popover 锚点；点这个按钮也算"点了外部"以触发关闭。 */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** 标题（aria-label）。 */
  ariaLabel: string;
  children: React.ReactNode;
  /** 可选 className，让具体 picker 控制宽度等。基类在 sm+ 不带宽度（w-full 只作用于
   *  移动端 in-flow 形态），消费方必须传 sm: 宽度（如 sm:w-[min(360px,…)]），
   *  否则桌面端会拉满定位祖先（composer 岛）的整宽。 */
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
          transition={{ duration: 0.16, ease: ease.out }}
          // inline style 强制实色背景:surface-overlay 在暗模式下走 rgb(... / 0.70)
          // 玻璃半透明,EmptyState 背后有 aurora glow + 推荐卡片,picker 浮在
          // 上面会穿透看到下层。强制 var(--bg-leaf) 让弹层=信息焦点。
          // 与 ModelPicker.tsx 同一 fix。
          // 注:不放 sm:w-auto / layout —— 前者会压过消费方传入的 sm:w-[min(…)]
          // 固定宽度,让弹层随内容伸缩;后者把内容高度变化渲染成整框缩放形变。
          // 两者叠加就是"切换模式/勾选知识库时整个框大小在变"的根因。
          // 类名用 cn()(tailwind-merge)合并:同特异性冲突由"后传入者赢"确定性
          // 裁决,不再依赖生成样式表的顺序。
          style={{ background: 'var(--bg-leaf)' }}
          className={cn(
            'relative z-40 mb-3 w-full overflow-hidden rounded-xl border border-[var(--ink-subtle)]/20 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.25)] surface-overlay sm:absolute sm:left-0 sm:bottom-full',
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
