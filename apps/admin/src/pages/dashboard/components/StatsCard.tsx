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
    primary: 'from-primary/20 to-accent/10 border-primary/20',
    green: 'from-status-success/20 to-status-success/10 border-status-success/20',
    blue: 'from-status-info/20 to-status-info/10 border-status-info/20',
    orange: 'from-status-warning/20 to-status-warning/10 border-status-warning/20',
    pink: 'from-pink-500/20 to-rose-500/10 border-pink-500/20',
    purple: 'from-accent/20 to-primary/10 border-accent/20',
    cyan: 'from-cyan-500/20 to-status-info/10 border-cyan-500/20',
    indigo: 'from-primary/20 to-accent/10 border-primary/20',
    emerald: 'from-status-success/20 to-status-success/10 border-status-success/20',
  };

  const iconColorStyles = {
    primary: 'bg-primary/20 text-primary',
    green: 'bg-status-success-light text-status-success',
    blue: 'bg-status-info-light text-status-info',
    orange: 'bg-status-warning-light text-status-warning',
    pink: 'bg-pink-500/20 text-pink-500',
    purple: 'bg-accent/20 text-accent',
    cyan: 'bg-cyan-500/20 text-cyan-500',
    indigo: 'bg-primary/20 text-primary',
    emerald: 'bg-status-success-light text-status-success',
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
            <div className="flex items-center gap-2 mt-3 text-sm">
              {change !== undefined && (
                <div className={cn(
                  "flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium",
                  change > 0 ? "bg-status-success-light text-status-success" :
                  change < 0 ? "bg-status-danger-light text-status-danger" :
                  "bg-[var(--bg-secondary)] text-[var(--text-muted)]"
                )}>
                  {change > 0 ? <TrendingUp className="w-3 h-3" /> :
                   change < 0 ? <TrendingDown className="w-3 h-3" /> :
                   <Minus className="w-3 h-3" />}
                  <span>{Math.abs(change)}%</span>
                </div>
              )}
              {changeLabel && <span className="text-[var(--text-muted)] text-xs">{changeLabel}</span>}
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
