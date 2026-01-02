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
    <div className="p-6 rounded-xl bg-white/5 border border-white/10">
      <h3 className="text-lg font-semibold text-white mb-4">地域分布</h3>
      
      {/* Simple bar-based geo visualization */}
      <div className="space-y-3">
        {sortedData.map((item, index) => (
          <div key={item.country} className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 text-center text-sm text-gray-500">{index + 1}</span>
                <span className="text-white">{item.country}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-gray-400">{item.count.toLocaleString()}</span>
                <span className="text-gray-500 text-sm w-12 text-right">
                  {item.percentage.toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="ml-8 h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-purple-400 transition-all duration-500"
                style={{ width: `${(item.count / maxCount) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-sm text-gray-400">
        <span>总访问量: {sortedData.reduce((sum, d) => sum + d.count, 0).toLocaleString()}</span>
        <span>共 {sortedData.length} 个地区</span>
      </div>
    </div>
  );
}

export default GeoMap;
