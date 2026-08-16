'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../utils';

/**
 * Toast —— Aether Codex 通知胶囊
 *
 * 2026-08 从 legacy 色板（bg-green-500/20 等）迁移到 Codex token：
 * surface 走 --bg-raised 实色卡 + ink hairline，状态色只点在图标与 hairline
 * 上（signal-*），不再整卡染色。新增：
 *   · action —— 可选操作按钮（如「撤销」），点击后自动关闭；
 *   · ToastProvider position —— 'top-right'（默认，向后兼容）/ 'bottom-center'
 *     （对话工作台等"操作离手最近"的场景）。
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  /** 自动关闭毫秒数；<=0 表示常驻（需手动关闭）。默认 3000。 */
  duration?: number;
  onClose?: () => void;
  /** 可选操作按钮（如「撤销」）。点击后 toast 立即关闭。 */
  action?: ToastAction;
}

const TYPE_META = {
  success: { Icon: CheckCircle2, color: 'var(--signal-success)' },
  error: { Icon: XCircle, color: 'var(--signal-danger)' },
  warning: { Icon: AlertTriangle, color: 'var(--signal-warn)' },
  info: { Icon: Info, color: 'var(--signal-info)' },
} as const;

export function Toast({ message, type = 'info', duration = 3000, onClose, action }: ToastProps) {
  React.useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => onClose?.(), duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const { Icon, color } = TYPE_META[type];

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex max-w-[min(92vw,26rem)] items-center gap-2.5 rounded-xl border py-2.5 pl-3 pr-2',
        'border-[color-mix(in_oklch,var(--ink-subtle)_45%,transparent)] bg-[var(--bg-raised)]',
        'shadow-[0_18px_40px_-16px_rgba(0,0,0,0.32),0_1px_0_inset_color-mix(in_oklch,var(--ink-primary)_6%,transparent)]',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" style={{ color }} aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--ink-primary)]">
        {message}
      </span>
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onClick();
            onClose?.();
          }}
          className="shrink-0 rounded-lg border border-[color-mix(in_oklch,var(--aurora-1)_38%,transparent)] px-2.5 py-1 text-[12px] font-medium text-[var(--aurora-1)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)]"
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onClose?.()}
        aria-label="关闭通知"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

// 管理多个 Toast 的容器
interface ToastItem extends ToastProps {
  id: string;
}

export type ToastPosition = 'top-right' | 'bottom-center';

interface ToastContextValue {
  toasts: ToastItem[];
  showToast: (props: Omit<ToastProps, 'onClose'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

const POSITION_CLASS: Record<ToastPosition, string> = {
  'top-right': 'top-4 right-4 items-end',
  'bottom-center': 'bottom-40 left-1/2 -translate-x-1/2 items-center',
};

export function ToastProvider({
  children,
  position = 'top-right',
}: {
  children: React.ReactNode;
  position?: ToastPosition;
}) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const showToast = React.useCallback((props: Omit<ToastProps, 'onClose'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...props, id }]);
  }, []);

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fromBottom = position === 'bottom-center';

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
      <div
        className={cn(
          'pointer-events-none fixed z-[120] flex flex-col gap-2',
          POSITION_CLASS[position],
        )}
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: fromBottom ? 10 : -10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: fromBottom ? 8 : -8, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.8 }}
            >
              <Toast {...toast} onClose={() => removeToast(toast.id)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
