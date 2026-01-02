import { Activity, Database, Server, HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';

const services = [
  { name: 'Java Backend', icon: Server, status: 'healthy' },
  { name: 'PostgreSQL', icon: Database, status: 'healthy' },
  { name: 'Redis', icon: HardDrive, status: 'healthy' },
  { name: 'Elasticsearch', icon: Activity, status: 'warning' },
];

export default function MonitorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">系统监控</h1>
        <p className="text-gray-400 mt-1">实时监控系统运行状态</p>
      </div>

      {/* 服务状态 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {services.map((service) => (
          <div
            key={service.name}
            className={cn(
              'p-4 rounded-xl',
              'bg-white/5 border border-white/10'
            )}
          >
            <div className="flex items-center gap-3">
              <service.icon className="w-5 h-5 text-gray-400" />
              <span className="text-white font-medium">{service.name}</span>
              <div
                className={cn(
                  'ml-auto w-2 h-2 rounded-full',
                  service.status === 'healthy' && 'bg-green-400',
                  service.status === 'warning' && 'bg-yellow-400',
                  service.status === 'error' && 'bg-red-400'
                )}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 性能图表占位 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-xl bg-white/5 border border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4">CPU 使用率</h3>
          <div className="h-48 flex items-center justify-center text-gray-500">
            图表区域（待实现）
          </div>
        </div>
        <div className="p-6 rounded-xl bg-white/5 border border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4">内存使用率</h3>
          <div className="h-48 flex items-center justify-center text-gray-500">
            图表区域（待实现）
          </div>
        </div>
      </div>
    </div>
  );
}
