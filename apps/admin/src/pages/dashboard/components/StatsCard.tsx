import { useRef, useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: number | string; // Changed to support both number and string for formatted values
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
    primary: 'from-primary/20 to-purple-500/10 border-primary/20',
    green: 'from-green-500/20 to-emerald-500/10 border-green-500/20',
    blue: 'from-blue-500/20 to-cyan-500/10 border-blue-500/20',
    orange: 'from-orange-500/20 to-yellow-500/10 border-orange-500/20',
    pink: 'from-pink-500/20 to-rose-500/10 border-pink-500/20',
    purple: 'from-purple-500/20 to-indigo-500/10 border-purple-500/20',
    cyan: 'from-cyan-500/20 to-blue-500/10 border-cyan-500/20',
    indigo: 'from-indigo-500/20 to-purple-500/10 border-indigo-500/20',
    emerald: 'from-emerald-500/20 to-green-500/10 border-emerald-500/20',
  };

  const iconColorStyles = {
    primary: 'bg-primary/20 text-primary',
    green: 'bg-green-500/20 text-green-400',
    blue: 'bg-blue-500/20 text-blue-400',
    orange: 'bg-orange-500/20 text-orange-400',
    pink: 'bg-pink-500/20 text-pink-400',
    purple: 'bg-purple-500/20 text-purple-400',
    cyan: 'bg-cyan-500/20 text-cyan-400',
    indigo: 'bg-indigo-500/20 text-indigo-400',
    emerald: 'bg-emerald-500/20 text-emerald-400',
  };

  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-white/5 border border-white/10 animate-pulse h-[140px]">
        <div className="flex justify-between">
          <div className="w-24 h-4 bg-white/10 rounded" />
          <div className="w-10 h-10 bg-white/10 rounded-lg" />
        </div>
        <div className="mt-4 w-32 h-8 bg-white/10 rounded" />
        <div className="mt-2 w-16 h-4 bg-white/10 rounded" />
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
          <p className="text-gray-400 text-sm font-medium">{title}</p>
          <p className="text-3xl font-bold text-white mt-2 tabular-nums">
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
                  change > 0 ? "bg-green-500/10 text-green-400" :
                  change < 0 ? "bg-red-500/10 text-red-400" :
                  "bg-white/5 text-gray-400"
                )}>
                  {change > 0 ? <TrendingUp className="w-3 h-3" /> :
                   change < 0 ? <TrendingDown className="w-3 h-3" /> :
                   <Minus className="w-3 h-3" />}
                  <span>{Math.abs(change)}%</span>
                </div>
              )}
              {changeLabel && <span className="text-gray-500 text-xs">{changeLabel}</span>}
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
