import { CheckCircle, AlertCircle, Server, Database, Cpu } from 'lucide-react';

interface SystemStatusProps {
  status: 'healthy' | 'warning' | 'error';
  services: { name: string; status: 'up' | 'down' | 'warning'; latency?: number }[];
}

export function SystemStatus({ status, services }: SystemStatusProps) {
  const statusConfig = {
    healthy: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20', label: '系统正常' },
    warning: { icon: AlertCircle, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: '部分异常' },
    error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/20', label: '系统异常' },
  };

  const config = statusConfig[status];
  const StatusIcon = config.icon;

  const serviceIcons: Record<string, typeof Server> = {
    api: Server,
    database: Database,
    cache: Cpu,
  };

  return (
    <div className="p-6 rounded-xl bg-white/5 border border-white/10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">系统状态</h3>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${config.bg}`}>
          <StatusIcon className={`w-4 h-4 ${config.color}`} />
          <span className={`text-sm ${config.color}`}>{config.label}</span>
        </div>
      </div>
      <div className="space-y-3">
        {services.map((service) => {
          const Icon = serviceIcons[service.name.toLowerCase()] || Server;
          return (
            <div
              key={service.name}
              className="flex items-center justify-between p-3 rounded-lg bg-white/5"
            >
              <div className="flex items-center gap-3">
                <Icon className="w-5 h-5 text-gray-400" />
                <span className="text-white">{service.name}</span>
              </div>
              <div className="flex items-center gap-3">
                {service.latency !== undefined && (
                  <span className="text-sm text-gray-400">{service.latency}ms</span>
                )}
                <div
                  className={`w-2 h-2 rounded-full ${
                    service.status === 'up'
                      ? 'bg-green-400'
                      : service.status === 'warning'
                      ? 'bg-yellow-400'
                      : 'bg-red-400'
                  }`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SystemStatus;
