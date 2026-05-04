import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isAfter,
  isBefore,
  startOfYear,
  startOfDay,
  subDays,
  isValid,
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { cn } from '../utils';
import { transition, variants } from '../motion';

/**
 * DateRangePicker · Aether Codex 自绘日期范围选择器
 *
 * 取代两个原生 <input type="date">：
 * - trigger 与 Select 同尺寸/圆角，保证表单视觉一致
 * - popover 走 .surface-overlay，portal 到 body
 * - 左侧 8 个常用预设（今天/昨天/最近 7/30 天/本月/上月/本年/全部时间）
 * - 右侧单月日历，hover 时实时预览 range
 * - 选择预设直接 commit；自定义两次点击（起始 → 结束）后 commit
 * - 输出 ISO date 'YYYY-MM-DD'，与后端 query 参数对齐
 *
 * 规范:.claude/design-system/05-components.md · §Form
 */

export interface DateRangeValue {
  /** ISO date 'YYYY-MM-DD'，空字符串/undefined 视为未设置 */
  startTime?: string;
  endTime?: string;
}

export interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  /** 未选时占位 */
  placeholder?: string;
  /** trigger 高度 */
  size?: 'sm' | 'md';
  /** trigger 占满父容器 */
  fullWidth?: boolean;
  className?: string;
  /** 屏幕阅读器文案 */
  ariaLabel?: string;
  /** trigger 前缀图标，缺省 Calendar */
  prefix?: React.ReactNode;
  id?: string;
  disabled?: boolean;
}

interface Preset {
  key: string;
  label: string;
  /** 当前选中预设的判断（基于 value 反推） */
  match: (start: Date | null, end: Date | null) => boolean;
  /** 预设触发时给出的 range */
  resolve: () => { start: Date; end: Date };
}

/**
 * 预设清单 —— 全部以"今天"为锚点
 *
 * 关键设计：每个 resolve / match 闭包内部都重新计算 today（`startOfDay(new Date())`），
 * 而不是在 buildPresets 顶层捕获一次。原因：admin 页面在 useMemo([]) 中缓存
 * presets 后会跨过午夜，若 today 是模块加载时一次性算的，"今天 / 最近 7 天 /
 * 本月" 会一直用昨天作为锚点，发出过期日期。延迟到点击 / 比对时计算可避免。
 */
function buildPresets(): Preset[] {
  return [
    {
      key: 'today',
      label: '今天',
      resolve: () => {
        const today = startOfDay(new Date());
        return { start: today, end: today };
      },
      match: (s, e) => {
        const today = startOfDay(new Date());
        return !!s && !!e && isSameDay(s, today) && isSameDay(e, today);
      },
    },
    {
      key: 'yesterday',
      label: '昨天',
      resolve: () => {
        const y = subDays(startOfDay(new Date()), 1);
        return { start: y, end: y };
      },
      match: (s, e) => {
        const y = subDays(startOfDay(new Date()), 1);
        return !!s && !!e && isSameDay(s, y) && isSameDay(e, y);
      },
    },
    {
      key: 'last7',
      label: '最近 7 天',
      resolve: () => {
        const today = startOfDay(new Date());
        return { start: subDays(today, 6), end: today };
      },
      match: (s, e) => {
        const today = startOfDay(new Date());
        return !!s && !!e && isSameDay(s, subDays(today, 6)) && isSameDay(e, today);
      },
    },
    {
      key: 'last30',
      label: '最近 30 天',
      resolve: () => {
        const today = startOfDay(new Date());
        return { start: subDays(today, 29), end: today };
      },
      match: (s, e) => {
        const today = startOfDay(new Date());
        return !!s && !!e && isSameDay(s, subDays(today, 29)) && isSameDay(e, today);
      },
    },
    {
      key: 'thisMonth',
      label: '本月',
      resolve: () => {
        const today = startOfDay(new Date());
        return { start: startOfMonth(today), end: today };
      },
      match: (s, e) => {
        const today = startOfDay(new Date());
        return !!s && !!e && isSameDay(s, startOfMonth(today)) && isSameDay(e, today);
      },
    },
    {
      key: 'lastMonth',
      label: '上月',
      resolve: () => {
        const prev = subMonths(startOfDay(new Date()), 1);
        return { start: startOfMonth(prev), end: endOfMonth(prev) };
      },
      match: (s, e) => {
        const prev = subMonths(startOfDay(new Date()), 1);
        return (
          !!s &&
          !!e &&
          isSameDay(s, startOfMonth(prev)) &&
          isSameDay(e, endOfMonth(prev))
        );
      },
    },
    {
      key: 'thisYear',
      label: '本年',
      resolve: () => {
        const today = startOfDay(new Date());
        return { start: startOfYear(today), end: today };
      },
      match: (s, e) => {
        const today = startOfDay(new Date());
        return !!s && !!e && isSameDay(s, startOfYear(today)) && isSameDay(e, today);
      },
    },
  ];
}

/* -----------------------------------------------------------
 * 工具：ISO ⇄ Date
 * ----------------------------------------------------------- */
function toDate(iso?: string): Date | null {
  if (!iso) return null;
  const d = parseISO(iso);
  return isValid(d) ? startOfDay(d) : null;
}
function toIso(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}
function formatDisplay(d: Date): string {
  return format(d, 'yyyy 年 M 月 d 日', { locale: zhCN });
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = '选择时间范围',
  size = 'md',
  fullWidth = true,
  className,
  ariaLabel,
  prefix,
  id,
  disabled = false,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({});

  // 解析 value
  const valueStart = toDate(value.startTime);
  const valueEnd = toDate(value.endTime);

  // 内部草稿：用户点击日历时仅更新草稿，预设直接 commit
  const [draftStart, setDraftStart] = React.useState<Date | null>(valueStart);
  const [draftEnd, setDraftEnd] = React.useState<Date | null>(valueEnd);
  const [hoverDay, setHoverDay] = React.useState<Date | null>(null);

  // 当前展示月份（默认 = draftEnd ?? draftStart ?? today）
  const [viewMonth, setViewMonth] = React.useState<Date>(() => {
    return valueEnd ?? valueStart ?? startOfDay(new Date());
  });

  // 打开时同步草稿
  React.useEffect(() => {
    if (isOpen) {
      setDraftStart(valueStart);
      setDraftEnd(valueEnd);
      setHoverDay(null);
      setViewMonth(valueEnd ?? valueStart ?? startOfDay(new Date()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 计算 popover 位置 + 尺寸
  React.useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const SAFE_GUTTER = 8;

    // 宽度：理想 580，但窄屏（≈360px 起）下要 clamp 到 viewport - 16，
    // 否则日历会横向溢出导致结束日期不可点击。
    const popW = Math.min(580, viewportW - SAFE_GUTTER * 2);
    const desiredH = 380;

    // 横向：默认 left 对齐 trigger.left，溢出则贴右；clamp 到左 8px
    let left = rect.left;
    if (left + popW > viewportW - SAFE_GUTTER) {
      left = Math.max(SAFE_GUTTER, viewportW - popW - SAFE_GUTTER);
    }
    if (left < SAFE_GUTTER) left = SAFE_GUTTER;

    // 纵向：选择空间更大的一侧，再 clamp height 到该侧可用区。
    // 短视口（手机横屏 / 分屏）下两边都不到 380 时，maxHeight 会让内部
    // 滚动而不是把 panel 推出屏幕。
    const spaceBelow = viewportH - rect.bottom - SAFE_GUTTER - 6;
    const spaceAbove = rect.top - SAFE_GUTTER - 6;
    const flipUp = spaceBelow < desiredH && spaceAbove > spaceBelow;
    const availableH = Math.max(160, flipUp ? spaceAbove : spaceBelow);
    const popMaxH = Math.min(desiredH, availableH);

    const next: React.CSSProperties = {
      position: 'fixed',
      left,
      width: popW,
      maxHeight: popMaxH,
      overflowY: 'auto',
      zIndex: 9999,
    };
    if (flipUp) next.bottom = viewportH - rect.top + 6;
    else next.top = rect.bottom + 6;
    setMenuStyle(next);
  }, [isOpen]);

  // 点击外部 / 滚动 / resize 关闭
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
      // 仅当滚动发生在 trigger 之外时关闭，避免在自身 popover 内滚动也关闭
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

  const presets = React.useMemo(buildPresets, []);

  const commit = (start: Date | null, end: Date | null) => {
    onChange({
      startTime: start ? toIso(start) : '',
      endTime: end ? toIso(end) : '',
    });
  };

  const onPresetClick = (p: Preset) => {
    const { start, end } = p.resolve();
    setDraftStart(start);
    setDraftEnd(end);
    setViewMonth(end);
    commit(start, end);
    setIsOpen(false);
  };

  const onDayClick = (d: Date) => {
    if (!draftStart || (draftStart && draftEnd)) {
      // 开始新一段
      setDraftStart(d);
      setDraftEnd(null);
      return;
    }
    // 已有 start，没 end
    if (isBefore(d, draftStart)) {
      setDraftStart(d);
      setDraftEnd(null);
      return;
    }
    setDraftEnd(d);
    commit(draftStart, d);
    setIsOpen(false);
  };

  const onClear = () => {
    setDraftStart(null);
    setDraftEnd(null);
    commit(null, null);
    setIsOpen(false);
  };

  const sizeClasses = size === 'sm' ? 'h-9 px-3 text-sm' : 'h-10 px-3.5 text-sm';

  // trigger 文本
  const triggerLabel = (() => {
    if (!valueStart && !valueEnd) return placeholder;
    if (valueStart && valueEnd && isSameDay(valueStart, valueEnd)) {
      return formatDisplay(valueStart);
    }
    if (valueStart && valueEnd) {
      // 同年简写：2026/5/1 - 6/3
      if (valueStart.getFullYear() === valueEnd.getFullYear()) {
        return `${format(valueStart, 'yyyy/M/d')} – ${format(valueEnd, 'M/d')}`;
      }
      return `${format(valueStart, 'yyyy/M/d')} – ${format(valueEnd, 'yyyy/M/d')}`;
    }
    return valueStart ? formatDisplay(valueStart) : formatDisplay(valueEnd!);
  })();

  // 当前预设是否被命中
  const matchedPresetKey = presets.find((p) => p.match(valueStart, valueEnd))?.key;

  // 计算日历网格（6 周 × 7 天）
  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // 当前 hover-range（仅在已选 start 没选 end 时启用）
  const previewEnd =
    draftStart && !draftEnd && hoverDay && isAfter(hoverDay, draftStart)
      ? hoverDay
      : null;

  const isInRange = (d: Date): boolean => {
    if (draftStart && draftEnd) {
      return (
        (isAfter(d, draftStart) || isSameDay(d, draftStart)) &&
        (isBefore(d, draftEnd) || isSameDay(d, draftEnd))
      );
    }
    if (draftStart && previewEnd) {
      return (
        (isAfter(d, draftStart) || isSameDay(d, draftStart)) &&
        (isBefore(d, previewEnd) || isSameDay(d, previewEnd))
      );
    }
    return false;
  };

  const isRangeStart = (d: Date): boolean => {
    if (!draftStart) return false;
    return isSameDay(d, draftStart);
  };

  const isRangeEnd = (d: Date): boolean => {
    if (draftEnd) return isSameDay(d, draftEnd);
    if (previewEnd) return isSameDay(d, previewEnd);
    return false;
  };

  const today = startOfDay(new Date());

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((v) => !v)}
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
        <span className="flex items-center text-[var(--ink-muted)] [&_svg]:w-4 [&_svg]:h-4 shrink-0">
          {prefix ?? <CalendarIcon />}
        </span>
        <span
          className={cn(
            'flex-1 text-left truncate',
            !valueStart && !valueEnd && 'text-[var(--ink-muted)]'
          )}
        >
          {triggerLabel}
        </span>
        {(valueStart || valueEnd) && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="清除时间范围"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="shrink-0 p-1 -mr-1 rounded hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </span>
        )}
      </button>

      {typeof window !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isOpen && (
              <motion.div
                ref={menuRef}
                role="dialog"
                aria-label="时间范围选择"
                style={menuStyle}
                variants={variants.dropDown}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={transition.quick}
                className="surface-overlay rounded-xl overflow-hidden"
              >
                <div className="flex">
                  {/* 左侧预设 */}
                  <div className="w-[140px] shrink-0 p-2 border-r border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] space-y-0.5">
                    <div className="px-2 py-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                      快捷范围
                    </div>
                    {presets.map((p) => {
                      const active = matchedPresetKey === p.key;
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => onPresetClick(p)}
                          className={cn(
                            'w-full text-left px-2.5 py-1.5 rounded-md text-sm',
                            'transition-[background-color,color] duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                            active
                              ? 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--ink-primary)] font-medium'
                              : 'text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_6%,transparent)] hover:text-[var(--ink-primary)]'
                          )}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                    <div className="my-1 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
                    <button
                      type="button"
                      onClick={onClear}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-md text-sm',
                        'transition-[background-color,color] duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                        'text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] hover:text-[var(--signal-danger)]'
                      )}
                    >
                      清空
                    </button>
                  </div>

                  {/* 右侧日历 */}
                  <div className="flex-1 p-3">
                    {/* 月份导航 */}
                    <div className="flex items-center justify-between mb-2">
                      <button
                        type="button"
                        aria-label="上一月"
                        onClick={() => setViewMonth((m) => subMonths(m, 1))}
                        className="w-8 h-8 inline-flex items-center justify-center rounded-md text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] hover:text-[var(--ink-primary)] transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <div className="font-display text-base text-[var(--ink-primary)]">
                        {format(viewMonth, 'yyyy 年 M 月', { locale: zhCN })}
                      </div>
                      <button
                        type="button"
                        aria-label="下一月"
                        onClick={() => setViewMonth((m) => addMonths(m, 1))}
                        className="w-8 h-8 inline-flex items-center justify-center rounded-md text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] hover:text-[var(--ink-primary)] transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    {/* 星期标头 */}
                    <div className="grid grid-cols-7 gap-0.5 mb-1">
                      {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
                        <div
                          key={w}
                          className="h-7 text-center text-[11px] font-mono uppercase tracking-[0.12em] text-[var(--ink-muted)] flex items-center justify-center"
                        >
                          {w}
                        </div>
                      ))}
                    </div>

                    {/* 日期网格 */}
                    <div className="grid grid-cols-7 gap-0.5">
                      {days.map((d) => {
                        const inMonth = isSameMonth(d, viewMonth);
                        const isStart = isRangeStart(d);
                        const isEnd = isRangeEnd(d);
                        const isInside = isInRange(d) && !isStart && !isEnd;
                        const isToday = isSameDay(d, today);
                        const isFuture = isAfter(d, today);

                        return (
                          <button
                            key={d.toISOString()}
                            type="button"
                            disabled={isFuture}
                            onClick={() => !isFuture && onDayClick(d)}
                            onMouseEnter={() => setHoverDay(d)}
                            onMouseLeave={() => setHoverDay(null)}
                            className={cn(
                              'relative h-9 text-sm font-medium rounded-md',
                              'transition-[background-color,color,box-shadow] duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                              !inMonth && 'text-[var(--ink-subtle)]',
                              inMonth && !isStart && !isEnd && !isInside && 'text-[var(--ink-secondary)]',
                              isFuture && 'opacity-40 cursor-not-allowed',
                              !isFuture && !isStart && !isEnd && !isInside && 'hover:bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] hover:text-[var(--ink-primary)]',
                              isInside &&
                                'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--ink-primary)]',
                              (isStart || isEnd) &&
                                'bg-[var(--aurora-1)] text-[var(--bg-void)] font-semibold shadow-[0_0_0_1px_color-mix(in_oklch,var(--aurora-1)_60%,transparent),0_4px_12px_-4px_color-mix(in_oklch,var(--aurora-1)_40%,transparent)]'
                            )}
                          >
                            {format(d, 'd')}
                            {isToday && !isStart && !isEnd && (
                              <span
                                aria-hidden
                                className="absolute left-1/2 -translate-x-1/2 bottom-1 w-1 h-1 rounded-full bg-[var(--aurora-1)]"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* 底部状态 */}
                    <div className="mt-3 pt-2.5 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-[var(--ink-muted)] font-mono">
                        <span
                          className={cn(
                            'px-1.5 py-0.5 rounded',
                            draftStart
                              ? 'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--ink-primary)]'
                              : 'text-[var(--ink-muted)]'
                          )}
                        >
                          {draftStart ? format(draftStart, 'yyyy-MM-dd') : '起始日'}
                        </span>
                        <span className="text-[var(--ink-muted)]">→</span>
                        <span
                          className={cn(
                            'px-1.5 py-0.5 rounded',
                            draftEnd
                              ? 'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--ink-primary)]'
                              : 'text-[var(--ink-muted)]'
                          )}
                        >
                          {draftEnd
                            ? format(draftEnd, 'yyyy-MM-dd')
                            : draftStart && previewEnd
                              ? format(previewEnd, 'yyyy-MM-dd')
                              : '结束日'}
                        </span>
                      </div>
                      <div className="text-[var(--ink-muted)]">
                        {draftStart && !draftEnd && '点选结束日期'}
                        {!draftStart && '点选起始日期'}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
