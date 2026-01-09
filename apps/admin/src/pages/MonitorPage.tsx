import { SystemTrends, SystemStatus } from './dashboard/components';

export default function MonitorPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">系统监控</h1>
        <p className="text-gray-400 mt-1">实时监控系统运行状态与资源趋势</p>
      </div>

      {/* System Trends & Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SystemTrends />
        </div>
        <div>
          <SystemStatus refreshInterval={30} />
        </div>
      </div>
    </div>
  );
}
