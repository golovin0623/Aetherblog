import { useMemo } from 'react';

interface BarChartProps {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  showLabels?: boolean;
  horizontal?: boolean;
}

export function BarChart({
  data,
  height = 200,
  color = 'var(--color-primary)',
  showLabels = true,
  horizontal = false,
}: BarChartProps) {
  const maxValue = useMemo(() => Math.max(...data.map((d) => d.value), 1), [data]);

  if (horizontal) {
    return (
      <div className="space-y-3">
        {data.map((item, i) => (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-[var(--text-tertiary)]">{item.label}</span>
              <span className="text-[var(--text-muted)]">{item.value}</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--border-subtle)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(item.value / maxValue) * 100}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <div className="flex items-end justify-between h-full gap-2">
        {data.map((item, i) => (
          <div key={i} className="flex-1 flex flex-col items-center h-full">
            <div className="flex-1 w-full flex items-end">
              <div
                className="w-full rounded-t-md transition-all duration-500"
                style={{
                  height: `${(item.value / maxValue) * 100}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            {showLabels && (
              <span className="mt-2 text-xs text-[var(--text-muted)] truncate max-w-full">{item.label}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default BarChart;
