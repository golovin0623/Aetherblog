import { LineChart } from '../../../components/charts';

interface VisitorChartProps {
  data: { date: string; pv: number; uv: number }[];
}

export function VisitorChart({ data }: VisitorChartProps) {
  const chartData = data.map((d) => ({
    label: d.date.slice(-5),
    value: d.pv,
  }));

  return (
    <div className="p-6 rounded-xl bg-white/5 border border-white/10">
      <h3 className="text-lg font-semibold text-white mb-4">访问趋势</h3>
      <LineChart data={chartData} height={200} color="#8b5cf6" />
      <div className="flex items-center justify-center gap-6 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-primary" />
          <span className="text-sm text-gray-400">页面浏览量 (PV)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-cyan-400" />
          <span className="text-sm text-gray-400">独立访客 (UV)</span>
        </div>
      </div>
    </div>
  );
}

export default VisitorChart;
