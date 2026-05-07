import { motion } from 'framer-motion';
import { cn } from '../utils';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * 标准开关切换 —— 在所有管理后台页面保持一致。
 *
 * 尺寸：
 *  - sm: 36×20 px  (模型卡片、紧凑行)
 *  - md: 44×24 px  (设置、表单 —— 默认)
 */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  className,
}: ToggleProps) {
  const isMd = size === 'md';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]',
        isMd ? 'h-6 w-11' : 'h-5 w-9',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        checked
          ? 'bg-primary'
          : 'bg-[var(--bg-quaternary)] shadow-[inset_0_0_0_1px_var(--border-hover)]',
        className,
      )}
    >
      <motion.span
        initial={false}
        animate={{ x: checked ? (isMd ? 20 : 16) : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={cn(
          'absolute top-0.5 left-0.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] ring-1 ring-black/10',
          isMd ? 'h-5 w-5' : 'h-4 w-4',
        )}
      />
    </button>
  );
}
