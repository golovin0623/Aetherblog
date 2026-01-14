import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface DeviceChartProps {
  data?: { name: string; value: number }[];
  loading?: boolean;
}

const COLORS: Record<string, string> = {
  '桌面端': '#8b5cf6', // purple-500
  '移动端': '#06b6d4', // cyan-500
  '平板': '#f59e0b',   // amber-500
  '其他': '#71717a',   // zinc-500
};

export function DeviceChart({
  data,
  loading
}: DeviceChartProps) {

  // Process data to add colors
  const chartData = (data && data.length > 0) ? data.map(item => ({
    ...item,
    color: COLORS[item.name] || '#71717a'
  })) : [
    // Empty state or default
    { name: '暂无数据', value: 1, color: '#27272a' }
  ];

  // If loading, show skeleton
  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-white/5 border border-white/10 h-[420px]">
        <div className="w-24 h-6 bg-white/10 rounded animate-pulse mb-4" />
        <div className="h-[340px] flex items-center justify-center">
          <div className="w-48 h-48 rounded-full bg-white/5 animate-pulse relative overflow-hidden">
            {/* Shimmer effect */}
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl bg-white/5 border border-white/10 h-[420px] flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">设备分布</h3>
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="p-3 bg-zinc-900/90 backdrop-blur-md border border-white/10 rounded-lg shadow-xl">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: payload[0].payload.color }}
                        />
                        <span className="text-white">
                          {payload[0].name}: {payload[0].value} 
                          {/* Calculate percentage relative to total shown */}
                           ({payload[0].value && chartData ? (Number(payload[0].value) / chartData.reduce((acc, curr) => acc + (curr.value || 0), 0) * 100).toFixed(1) : 0}%)
                        </span>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              iconType="circle"
              formatter={(value) => <span className="text-sm text-gray-400 ml-1">{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default DeviceChart;
