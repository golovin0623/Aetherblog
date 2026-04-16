import { useMemo } from 'react';

interface PieChartProps {
  data: { label: string; value: number; color?: string }[];
  size?: number;
  showLegend?: boolean;
}

const DEFAULT_COLORS = [
  'oklch(from var(--color-primary) l c h)',
  'oklch(from var(--color-primary) calc(l + 0.05) c calc(h + 30))',
  'oklch(from var(--color-primary) calc(l + 0.08) c calc(h + 60))',
  'oklch(from var(--color-primary) calc(l - 0.05) c calc(h - 30))',
  'var(--signal-info)',
  'var(--signal-success)',
  'var(--signal-warn)',
  'var(--signal-danger)',
];

export function PieChart({ data, size = 160, showLegend = true }: PieChartProps) {
  const total = useMemo(() => data.reduce((sum, d) => sum + d.value, 0), [data]);

  const segments = useMemo(() => {
    let currentAngle = -90;
    return data.map((d, i) => {
      const percentage = total > 0 ? (d.value / total) * 100 : 0;
      const angle = (percentage / 100) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;
      currentAngle = endAngle;

      const startRad = (startAngle * Math.PI) / 180;
      const endRad = (endAngle * Math.PI) / 180;

      const x1 = 50 + 40 * Math.cos(startRad);
      const y1 = 50 + 40 * Math.sin(startRad);
      const x2 = 50 + 40 * Math.cos(endRad);
      const y2 = 50 + 40 * Math.sin(endRad);

      const largeArc = angle > 180 ? 1 : 0;

      return {
        ...d,
        percentage,
        color: d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        path:
          percentage >= 100
            ? `M 50 10 A 40 40 0 1 1 49.99 10`
            : `M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`,
      };
    });
  }, [data, total]);

  return (
    <div className="flex items-center gap-6">
      {/* Chart */}
      <div style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="w-full h-full">
          {segments.map((seg, i) => (
            <path
              key={i}
              d={seg.path}
              fill={seg.color}
              className="transition-all duration-300 hover:opacity-80"
            />
          ))}
          {/* Center hole */}
          <circle cx="50" cy="50" r="20" fill="var(--bg-secondary)" />
        </svg>
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="flex-1 space-y-2">
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: seg.color }} />
              <span className="text-sm text-[var(--text-tertiary)] flex-1">{seg.label}</span>
              <span className="text-sm text-[var(--text-muted)]">{seg.percentage.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PieChart;
