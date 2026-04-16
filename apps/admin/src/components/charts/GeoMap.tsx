interface GeoData {
  country: string;
  count: number;
  percentage: number;
}

interface GeoMapProps {
  data: GeoData[];
}

export function GeoMap({ data }: GeoMapProps) {
  const sortedData = [...data].sort((a, b) => b.count - a.count);
  const maxCount = sortedData[0]?.count || 1;

  return (
    <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-default)]">
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">地域分布</h3>
      
      {/* Simple bar-based geo visualization */}
      <div className="space-y-3">
        {sortedData.map((item, index) => (
          <div key={item.country} className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 text-center text-sm text-[var(--text-muted)]">{index + 1}</span>
                <span className="text-[var(--text-primary)]">{item.country}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[var(--text-muted)]">{item.count.toLocaleString()}</span>
                <span className="text-[var(--text-muted)] text-sm w-12 text-right">
                  {item.percentage.toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="ml-8 h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                style={{ width: `${(item.count / maxCount) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between text-sm text-[var(--text-muted)]">
        <span>总访问量: {sortedData.reduce((sum, d) => sum + d.count, 0).toLocaleString()}</span>
        <span>共 {sortedData.length} 个地区</span>
      </div>
    </div>
  );
}

export default GeoMap;
