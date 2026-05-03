import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../utils';
import { transition, variants } from '../motion';

/**
 * Select · Aether Codex 自绘下拉
 *
 * 取代原生 <select>，与 token 体系对齐：
 * - trigger 与 Input 同尺寸/圆角/border，保证表单视觉一致
 * - popover 走 .surface-overlay，portal 到 body 避免被父容器 overflow 截断
 * - 键盘导航：Up/Down 高亮、Enter 选中、Esc 关闭、Home/End 跳首尾
 * - 触发器宽度 = popover 宽度（除非显式 menuWidth 覆盖）
 *
 * 规范:.claude/design-system/05-components.md · §Dropdown
 */

export interface SelectOption {
  /** 选项唯一值（受控）。空字符串 '' 视为「未选」哨兵，会显示 placeholder。 */
  value: string;
  /** 选项主标签 */
  label: string;
  /** 二行说明（mono 小字） */
  description?: string;
  /** 选项前缀图标（优先于 selectionIcon） */
  icon?: React.ComponentType<{ className?: string }>;
  /** 单条禁用 */
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onValueChange: (next: string) => void;
  options: SelectOption[];
  /** 未选时占位 */
  placeholder?: string;
  /** 整体禁用 */
  disabled?: boolean;
  /** disabled 状态的提示（替代 placeholder） */
  disabledHint?: string;
  /** trigger 高度 */
  size?: 'sm' | 'md';
  /** trigger / popover 宽度 */
  fullWidth?: boolean;
  className?: string;
  /** trigger 前缀（图标，不随选项变化） */
  prefix?: React.ReactNode;
  /** 屏幕阅读器文案 */
  ariaLabel?: string;
  /** id 透传给 trigger，便于 <label htmlFor> */
  id?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = '请选择',
  disabled = false,
  disabledHint,
  size = 'md',
  fullWidth = true,
  className,
  prefix,
  ariaLabel,
  id,
}: SelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState<number>(-1);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const optionsRef = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({});

  const selected = options.find((o) => o.value === value);

  // 打开时：把 activeIndex 指向当前选中项（若无则 0）
  React.useEffect(() => {
    if (isOpen) {
      const idx = options.findIndex((o) => o.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, options, value]);

  // 计算 popover 位置 —— 优先下方，下方不够则上方
  React.useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - rect.bottom;
    const spaceAbove = rect.top;
    const desiredMenuH = Math.min(360, options.length * 44 + 16);
    const flipUp = spaceBelow < desiredMenuH + 12 && spaceAbove > spaceBelow;

    const next: React.CSSProperties = {
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(360, flipUp ? spaceAbove - 16 : spaceBelow - 16),
      zIndex: 9999,
    };
    if (flipUp) {
      next.bottom = viewportH - rect.top + 6;
    } else {
      next.top = rect.bottom + 6;
    }
    setMenuStyle(next);
  }, [isOpen, options.length]);

  // 点击外部 / 滚动 / resize → 关闭
  React.useEffect(() => {
    if (!isOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(t) &&
        menuRef.current &&
        !menuRef.current.contains(t)
      ) {
        setIsOpen(false);
      }
    };
    const onScroll = (e: Event) => {
      // 在 popover 内部滚动选项时不关闭
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    const onResize = () => setIsOpen(false);
    document.addEventListener('mousedown', onClick);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen]);

  // 把 active 选项滚动到可视区
  React.useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const el = optionsRef.current[activeIndex];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex]);

  const moveActive = (delta: number) => {
    const enabled = options
      .map((o, i) => ({ i, disabled: o.disabled }))
      .filter((x) => !x.disabled);
    if (enabled.length === 0) return;
    const currentEnabledIdx = enabled.findIndex((x) => x.i === activeIndex);
    let next = currentEnabledIdx + delta;
    if (next < 0) next = enabled.length - 1;
    if (next >= enabled.length) next = 0;
    setActiveIndex(enabled[next].i);
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(options.findIndex((o) => !o.disabled));
        break;
      case 'End': {
        e.preventDefault();
        for (let i = options.length - 1; i >= 0; i--) {
          if (!options[i].disabled) {
            setActiveIndex(i);
            break;
          }
        }
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const opt = options[activeIndex];
        if (opt && !opt.disabled) {
          onValueChange(opt.value);
          setIsOpen(false);
          triggerRef.current?.focus();
        }
        break;
      }
      case 'Escape':
      case 'Tab':
        setIsOpen(false);
        if (e.key === 'Escape') triggerRef.current?.focus();
        break;
    }
  };

  const sizeClasses = size === 'sm' ? 'h-9 px-3 text-sm' : 'h-10 px-3.5 text-sm';

  const SelectedIcon = selected?.icon;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'group inline-flex items-center gap-2 rounded-lg',
          'bg-[var(--bg-leaf)] border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]',
          'text-[var(--ink-primary)]',
          'transition-[border-color,box-shadow,background-color] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
          'hover:border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)]',
          'hover:shadow-[0_0_0_1px_color-mix(in_oklch,var(--aurora-1)_18%,transparent)]',
          'focus-visible:outline-none focus-visible:border-[color-mix(in_oklch,var(--aurora-1)_50%,transparent)]',
          'focus-visible:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_22%,transparent)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'data-[open=true]:border-[color-mix(in_oklch,var(--aurora-1)_50%,transparent)]',
          'data-[open=true]:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_22%,transparent)]',
          fullWidth && 'w-full',
          sizeClasses,
          className
        )}
        data-open={isOpen}
      >
        {prefix && (
          <span className="flex items-center text-[var(--ink-muted)] [&_svg]:w-4 [&_svg]:h-4 shrink-0">
            {prefix}
          </span>
        )}
        {SelectedIcon && !prefix && (
          <SelectedIcon className="w-4 h-4 text-[var(--ink-muted)] shrink-0" />
        )}
        <span
          className={cn(
            'flex-1 text-left truncate',
            !selected && 'text-[var(--ink-muted)]'
          )}
        >
          {disabled && disabledHint
            ? disabledHint
            : selected
              ? selected.label
              : placeholder}
        </span>
        <ChevronDown
          className={cn(
            'w-4 h-4 text-[var(--ink-muted)] shrink-0',
            'transition-transform duration-[var(--dur-quick)] ease-[var(--ease-out)]',
            isOpen && 'rotate-180 text-[var(--aurora-1)]'
          )}
        />
      </button>

      {typeof window !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isOpen && (
              <motion.div
                ref={menuRef}
                role="listbox"
                aria-label={ariaLabel}
                style={menuStyle}
                variants={variants.dropDown}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={transition.quick}
                className="surface-overlay overflow-y-auto p-1.5 rounded-xl"
              >
                {options.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[var(--ink-muted)] text-sm">
                    无可选项
                  </div>
                ) : (
                  <ul className="space-y-0.5">
                    {options.map((opt, i) => {
                      const isSelected = opt.value === value;
                      const isActive = i === activeIndex;
                      const Icon = opt.icon;
                      return (
                        <li key={opt.value}>
                          <button
                            ref={(el) => {
                              optionsRef.current[i] = el;
                            }}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            disabled={opt.disabled}
                            onClick={() => {
                              if (opt.disabled) return;
                              onValueChange(opt.value);
                              setIsOpen(false);
                              triggerRef.current?.focus();
                            }}
                            onMouseEnter={() => !opt.disabled && setActiveIndex(i)}
                            className={cn(
                              'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left',
                              'transition-[background-color,color] duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                              'text-sm text-[var(--ink-secondary)]',
                              'disabled:opacity-40 disabled:cursor-not-allowed',
                              isActive &&
                                !opt.disabled &&
                                'bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] text-[var(--ink-primary)]',
                              isSelected &&
                                'text-[var(--ink-primary)] font-medium'
                            )}
                          >
                            {Icon && (
                              <Icon
                                className={cn(
                                  'w-4 h-4 shrink-0',
                                  isSelected ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-muted)]'
                                )}
                              />
                            )}
                            <span className="flex-1 min-w-0">
                              <span className="truncate block">{opt.label}</span>
                              {opt.description && (
                                <span className="block text-xs font-mono text-[var(--ink-muted)] mt-0.5 truncate">
                                  {opt.description}
                                </span>
                              )}
                            </span>
                            {isSelected && (
                              <Check className="w-4 h-4 text-[var(--aurora-1)] shrink-0" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
