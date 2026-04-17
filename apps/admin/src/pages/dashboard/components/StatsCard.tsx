import React, { useEffect } from 'react';
import { motion, animate } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: number | string; // 改为支持格式化值的数字和字符串
  prefix?: string;
  suffix?: string;
  change?: number;
  changeLabel?: React.ReactNode;
  icon: React.ReactNode;
  color?: 'primary' | 'green' | 'blue' | 'orange' | 'pink' | 'purple' | 'cyan' | 'indigo' | 'emerald';
  loading?: boolean;
}

function Counter({ value, prefix, suffix }: { value: number; prefix: string; suffix: string }) {
  const nodeRef = React.useRef<HTMLSpanElement>(null);
  const lastValueRef = React.useRef(value);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;

    node.textContent = `${prefix}${Math.round(lastValueRef.current).toLocaleString()}${suffix}`;

    const controls = animate(lastValueRef.current, value, {
      duration: 1.2,
      ease: "easeOut",
      onUpdate(current) {
        lastValueRef.current = current;
        node.textContent = `${prefix}${Math.round(current).toLocaleString()}${suffix}`;
      },
    });

    return () => controls.stop();
  }, [value, prefix, suffix]);

  return <span ref={nodeRef} />;
}

export function StatsCard({
  title,
  value,
  prefix = '',
  suffix = '',
  change,
  changeLabel,
  icon,
  color = 'primary',
  loading = false,
}: StatsCardProps) {
  // primary/indigo/purple 原本是三份同义的"主色" —— 统一折叠到极光体系的 aurora-1/2/3
  // 让 Dashboard 上同时出现三张这种色的卡片时也会呈现清晰的色相阶梯,而不是几乎一样的指纹。
  // 其他色继续作为 KPI 类别信号色。
  const colorStyles = {
    primary: 'from-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] to-[color-mix(in_oklch,var(--aurora-1)_6%,transparent)] border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]',
    indigo: 'from-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] to-[color-mix(in_oklch,var(--aurora-2)_6%,transparent)] border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]',
    purple: 'from-[color-mix(in_oklch,var(--aurora-2)_18%,transparent)] to-[color-mix(in_oklch,var(--aurora-3)_6%,transparent)] border-[color-mix(in_oklch,var(--aurora-2)_22%,transparent)]',
    green: 'from-green-500/20 to-emerald-500/10 border-green-500/20',
    blue: 'from-blue-500/20 to-cyan-500/10 border-blue-500/20',
    orange: 'from-orange-500/20 to-yellow-500/10 border-orange-500/20',
    pink: 'from-pink-500/20 to-rose-500/10 border-pink-500/20',
    cyan: 'from-cyan-500/20 to-blue-500/10 border-cyan-500/20',
    emerald: 'from-emerald-500/20 to-green-500/10 border-emerald-500/20',
  };

  const iconColorStyles = {
    primary: 'bg-[color-mix(in_oklch,var(--aurora-1)_20%,transparent)] text-[var(--aurora-1)]',
    indigo: 'bg-[color-mix(in_oklch,var(--aurora-1)_20%,transparent)] text-[var(--aurora-1)]',
    purple: 'bg-[color-mix(in_oklch,var(--aurora-2)_20%,transparent)] text-[var(--aurora-2)]',
    green: 'bg-green-500/20 text-green-600 dark:text-green-400',
    blue: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
    orange: 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
    pink: 'bg-pink-500/20 text-pink-600 dark:text-pink-400',
    cyan: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400',
    emerald: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  };

  if (loading) {
    return (
      <div
        className={cn(
          "surface-leaf p-4 lg:p-6 bg-gradient-to-br transition-all duration-300",
          colorStyles[color]
        )}
      >
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1 w-full pr-4">
            {/* Title Skeleton */}
            <div className="h-5 w-24 bg-[var(--bg-secondary)] rounded-md animate-pulse" />

            {/* Value Skeleton */}
            <div className="mt-2 h-8 lg:h-9 w-32 bg-[var(--bg-secondary)] rounded-md animate-pulse" />

            {/* Change/Subtext Skeleton */}
            {(change !== undefined || changeLabel) && (
              <div className="flex items-center gap-2 mt-3">
                {change !== undefined && (
                  <div className="h-5 w-16 bg-[var(--bg-secondary)] rounded-full animate-pulse" />
                )}
                {changeLabel && (
                  <div className="h-4 w-20 bg-[var(--bg-secondary)] rounded-md animate-pulse" />
                )}
              </div>
            )}
          </div>

          {/* Icon Skeleton */}
          <div className={cn("p-3 rounded-xl shrink-0 animate-pulse", iconColorStyles[color])}>
            <div className="w-5 h-5 opacity-0" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      whileHover={{ y: -2 }}
      data-interactive
      className={cn(
        "surface-leaf p-4 lg:p-6 bg-gradient-to-br transition-all duration-300",
        colorStyles[color]
      )}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[var(--text-secondary)] text-sm font-medium">{title}</p>
          <p className="text-2xl lg:text-3xl font-bold text-[var(--text-primary)] mt-2 tabular-nums truncate">
            {typeof value === 'string' ? (
              value
            ) : (
              <Counter value={value} prefix={prefix} suffix={suffix} />
            )}
          </p>

          {(change !== undefined || changeLabel) && (
            <div className="mt-3 flex items-start gap-2 text-sm overflow-hidden">
              {change !== undefined && (
                <div className={cn(
                  "flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium shrink-0",
                  change > 0 ? "bg-green-500/10 text-green-600 dark:text-green-400" :
                  change < 0 ? "bg-red-500/10 text-red-600 dark:text-red-400" :
                  "bg-[var(--bg-secondary)] text-[var(--text-muted)]"
                )}>
                  {change > 0 ? <TrendingUp className="w-3 h-3" /> :
                   change < 0 ? <TrendingDown className="w-3 h-3" /> :
                   <Minus className="w-3 h-3" />}
                  <span>{Math.abs(change).toFixed(1)}%</span>
                </div>
              )}
              {changeLabel && (
                typeof changeLabel === 'string' ? (
                  <span className="min-w-0 truncate text-xs text-[var(--text-muted)]">{changeLabel}</span>
                ) : (
                  <div className="min-w-0 text-xs text-[var(--text-muted)]">{changeLabel}</div>
                )
              )}
            </div>
          )}
        </div>

        <div className={cn("p-3 rounded-xl shrink-0", iconColorStyles[color])}>
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

export default StatsCard;
