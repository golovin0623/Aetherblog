import React, { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: number | string; // 改为支持格式化值的数字和字符串
  prefix?: string;
  suffix?: string;
  change?: number;
  changeLabel?: string;
  icon: React.ReactNode;
  color?: 'primary' | 'green' | 'blue' | 'orange' | 'pink' | 'purple' | 'cyan' | 'indigo' | 'emerald';
  loading?: boolean;
}

function Counter({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const spring = useSpring(0, { mass: 0.8, stiffness: 75, damping: 15 });
  const display = useTransform(spring, (current) => 
    `${prefix}${Math.round(current).toLocaleString()}${suffix}`
  );

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span>{display}</motion.span>;
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
  const colorStyles = {
    primary: 'from-zinc-800/20 to-zinc-600/10 border-zinc-800/20 dark:from-indigo-500/20 dark:to-purple-500/10 dark:border-indigo-500/20',
    green: 'from-green-500/20 to-emerald-500/10 border-green-500/20',
    blue: 'from-blue-500/20 to-cyan-500/10 border-blue-500/20',
    orange: 'from-orange-500/20 to-yellow-500/10 border-orange-500/20',
    pink: 'from-pink-500/20 to-rose-500/10 border-pink-500/20',
    purple: 'from-zinc-700/20 to-zinc-500/10 border-zinc-700/20 dark:from-purple-500/20 dark:to-indigo-500/10 dark:border-purple-500/20',
    cyan: 'from-cyan-500/20 to-blue-500/10 border-cyan-500/20',
    indigo: 'from-zinc-800/20 to-zinc-600/10 border-zinc-800/20 dark:from-indigo-500/20 dark:to-purple-500/10 dark:border-indigo-500/20',
    emerald: 'from-emerald-500/20 to-green-500/10 border-emerald-500/20',
  };

  const iconColorStyles = {
    primary: 'bg-zinc-800/20 text-zinc-700 dark:bg-indigo-500/20 dark:text-indigo-400',
    green: 'bg-green-500/20 text-green-600 dark:text-green-400',
    blue: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
    orange: 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
    pink: 'bg-pink-500/20 text-pink-600 dark:text-pink-400',
    purple: 'bg-zinc-700/20 text-zinc-600 dark:bg-purple-500/20 dark:text-purple-400',
    cyan: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400',
    indigo: 'bg-zinc-800/20 text-zinc-700 dark:bg-indigo-500/20 dark:text-indigo-400',
    emerald: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  };

  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] animate-pulse h-[140px]">
        <div className="flex justify-between">
          <div className="w-24 h-4 bg-[var(--bg-secondary)] rounded" />
          <div className="w-10 h-10 bg-[var(--bg-secondary)] rounded-lg" />
        </div>
        <div className="mt-4 w-32 h-8 bg-[var(--bg-secondary)] rounded" />
        <div className="mt-2 w-16 h-4 bg-[var(--bg-secondary)] rounded" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      whileHover={{ y: -2 }}
      className={cn(
        "p-6 rounded-xl bg-gradient-to-br border backdrop-blur-sm transition-all duration-300",
        colorStyles[color]
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[var(--text-secondary)] text-sm font-medium">{title}</p>
          <p className="text-3xl font-bold text-[var(--text-primary)] mt-2 tabular-nums">
            {typeof value === 'string' ? (
              value
            ) : (
              <Counter value={value} prefix={prefix} suffix={suffix} />
            )}
          </p>

          {(change !== undefined || changeLabel) && (
            <div className="flex items-center gap-2 mt-3 text-sm overflow-hidden">
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
              {changeLabel && <span className="text-[var(--text-muted)] text-xs truncate">{changeLabel}</span>}
            </div>
          )}
        </div>

        <div className={cn("p-3 rounded-xl", iconColorStyles[color])}>
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

export default StatsCard;
