import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';

const MENU_GAP_PX = 6;
const MENU_MAX_HEIGHT_PX = 256;

export interface StyledSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface StyledSelectProps {
  value: string;
  options: StyledSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
}

export function StyledSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  ariaLabel,
  disabled = false,
  className,
  buttonClassName,
  menuClassName,
}: StyledSelectProps) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const selected = options.find((option) => option.value === value);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex));
  const activeOptionId = open && options[activeIndex] ? `${id}-option-${activeIndex}` : undefined;

  const updateMenuPosition = () => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const showAbove = spaceBelow < MENU_MAX_HEIGHT_PX + 20 && rect.top > MENU_MAX_HEIGHT_PX + 20;

    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      top: showAbove ? undefined : rect.bottom + MENU_GAP_PX,
      bottom: showAbove ? viewportHeight - rect.top + MENU_GAP_PX : undefined,
      width: rect.width,
      zIndex: 10000,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    const handleLayoutChange = () => updateMenuPosition();

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleLayoutChange);
    window.addEventListener('scroll', handleLayoutChange, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleLayoutChange);
      window.removeEventListener('scroll', handleLayoutChange, true);
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex(Math.max(0, selectedIndex));
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const activeOption = menuRef.current?.querySelector<HTMLElement>(
      `[data-select-option-index="${activeIndex}"]`
    );
    activeOption?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const selectOption = (option: StyledSelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const moveActive = (direction: 1 | -1) => {
    if (options.length === 0) return;
    let next = activeIndex;
    for (let i = 0; i < options.length; i += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const handleButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      moveActive(-1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) {
        const option = options[activeIndex];
        if (option) selectOption(option);
      } else {
        setOpen(true);
      }
    }
  };

  const menu = open && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        style={menuStyle}
        className={cn(
          'surface-overlay !rounded-xl !border-[var(--border-default)] p-1 shadow-2xl',
          'max-h-64 overflow-y-auto',
          menuClassName,
        )}
      >
        <ul id={id} role="listbox" aria-label={ariaLabel} className="space-y-0.5">
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            const optionId = `${id}-option-${index}`;
            return (
              <li key={option.value} role="presentation">
                <button
                  id={optionId}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-select-option-index={index}
                  disabled={option.disabled}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onClick={() => selectOption(option)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    isSelected
                      ? 'bg-[var(--color-primary)] text-[var(--text-inverse)]'
                      : 'text-[var(--text-primary)]',
                    !isSelected && isActive && 'bg-[var(--bg-secondary)]',
                    !isSelected && 'hover:bg-[var(--bg-secondary)]',
                    option.disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && <Check className="h-4 w-4 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>,
      document.body,
    )
    : null;

  return (
    <div className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-controls={id}
        aria-activedescendant={activeOptionId}
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleButtonKeyDown}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)]',
          'bg-[var(--bg-secondary)] px-3 text-left text-sm text-[var(--text-primary)]',
          'transition-all hover:border-[var(--border-default)] focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20',
          disabled && 'cursor-not-allowed opacity-60',
          buttonClassName,
        )}
      >
        <span className={cn('truncate', !selected && 'text-[var(--text-muted)]')}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform',
            open && 'rotate-180 text-[var(--text-primary)]',
          )}
        />
      </button>
      {menu}
    </div>
  );
}

export default StyledSelect;
