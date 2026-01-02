import { useMemo } from 'react';

interface LineChartProps {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  showGrid?: boolean;
  showLabels?: boolean;
}

export function LineChart({
  data,
  height = 200,
  color = '#8b5cf6',
  showGrid = true,
  showLabels = true,
}: LineChartProps) {
  const { maxValue, minValue, points, gridLines } = useMemo(() => {
    const values = data.map((d) => d.value);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;

    const pts = data.map((d, i) => ({
      x: (i / (data.length - 1 || 1)) * 100,
      y: ((max - d.value) / range) * 100,
      label: d.label,
      value: d.value,
    }));

    const lines = [0, 25, 50, 75, 100].map((pct) => ({
      y: pct,
      value: max - (pct / 100) * range,
    }));

    return { maxValue: max, minValue: min, points: pts, gridLines: lines };
  }, [data]);

  const pathD = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((acc, pt, i) => {
      return acc + (i === 0 ? `M ${pt.x} ${pt.y}` : ` L ${pt.x} ${pt.y}`);
    }, '');
  }, [points]);

  return (
    <div className="relative" style={{ height }}>
      <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* Grid */}
        {showGrid &&
          gridLines.map((line, i) => (
            <line
              key={i}
              x1="0"
              y1={line.y}
              x2="100"
              y2={line.y}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="0.5"
            />
          ))}

        {/* Area */}
        <path
          d={`${pathD} L 100 100 L 0 100 Z`}
          fill={`url(#gradient-${color.replace('#', '')})`}
          opacity="0.3"
        />

        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />

        {/* Points */}
        {points.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r="3" fill={color} vectorEffect="non-scaling-stroke" />
        ))}

        {/* Gradient Definition */}
        <defs>
          <linearGradient id={`gradient-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      {/* Labels */}
      {showLabels && (
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          {data.map((d, i) => (
            <span key={i}>{d.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default LineChart;
