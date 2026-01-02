import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: React.ReactNode;
  color?: 'primary' | 'green' | 'blue' | 'orange' | 'pink';
}

export function StatsCard({
  title,
  value,
  change,
  changeLabel,
  icon,
  color = 'primary',
}: StatsCardProps) {
  const colorStyles = {
    primary: 'from-primary/20 to-purple-500/20 border-primary/30',
    green: 'from-green-500/20 to-emerald-500/20 border-green-500/30',
    blue: 'from-blue-500/20 to-cyan-500/20 border-blue-500/30',
    orange: 'from-orange-500/20 to-yellow-500/20 border-orange-500/30',
    pink: 'from-pink-500/20 to-rose-500/20 border-pink-500/30',
  };

  const iconColorStyles = {
    primary: 'text-primary',
    green: 'text-green-400',
    blue: 'text-blue-400',
    orange: 'text-orange-400',
    pink: 'text-pink-400',
  };

  return (
    <div
      className={`p-6 rounded-xl bg-gradient-to-br ${colorStyles[color]} border backdrop-blur-sm`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-400 text-sm">{title}</p>
          <p className="text-3xl font-bold text-white mt-2">{value}</p>
          {change !== undefined && (
            <div className="flex items-center gap-1 mt-2">
              {change > 0 ? (
                <TrendingUp className="w-4 h-4 text-green-400" />
              ) : change < 0 ? (
                <TrendingDown className="w-4 h-4 text-red-400" />
              ) : (
                <Minus className="w-4 h-4 text-gray-400" />
              )}
              <span
                className={`text-sm ${
                  change > 0 ? 'text-green-400' : change < 0 ? 'text-red-400' : 'text-gray-400'
                }`}
              >
                {change > 0 ? '+' : ''}
                {change}%
              </span>
              {changeLabel && <span className="text-sm text-gray-500">{changeLabel}</span>}
            </div>
          )}
        </div>
        <div className={`p-3 rounded-lg bg-white/10 ${iconColorStyles[color]}`}>{icon}</div>
      </div>
    </div>
  );
}

export default StatsCard;
