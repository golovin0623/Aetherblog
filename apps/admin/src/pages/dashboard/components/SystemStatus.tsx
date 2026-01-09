import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Server, 
  Database, 
  Cpu, 
  HardDrive, 
  Activity,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SystemMetric {
  label: string;
  value: number; // 0-100
  total?: string;
  used?: string;
  unit?: string;
  color?: 'primary' | 'green' | 'blue' | 'orange' | 'red';
}

interface ServiceStatus {
  name: string;
  status: 'up' | 'down' | 'warning';
  latency?: number;
  uptime?: string;
}

interface SystemStatusProps {
  metrics?: {
    cpu: number;
    memory: number;
    disk: number;
    jvm: number;
  };
  services?: ServiceStatus[];
  loading?: boolean;
}

function ProgressBar({ value, color = 'primary' }: { value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary',
    green: 'bg-green-500',
    blue: 'bg-blue-500',
    orange: 'bg-orange-500',
    red: 'bg-red-500',
  };

  return (
    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 1, ease: "easeOut" }}
        className={cn("h-full rounded-full", colorMap[color] || 'bg-primary')}
      />
    </div>
  );
}

export function SystemStatus({ 
  metrics = { cpu: 45, memory: 60, disk: 30, jvm: 55 },
  services = [
    { name: 'API Gateway', status: 'up', latency: 45 },
    { name: 'PostgreSQL', status: 'up', latency: 12 },
    { name: 'Redis', status: 'up', latency: 5 },
    { name: 'Elasticsearch', status: 'warning', latency: 150 },
  ],
  loading
}: SystemStatusProps) {
  
  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-white/5 border border-white/10 h-[300px] animate-pulse">
        {/* Skeleton content */}
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl bg-white/5 border border-white/10">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-white">系统状态</h3>
        <div className="flex items-center gap-2 px-2 py-1 rounded bg-green-500/10 border border-green-500/20">
          <Activity className="w-3.5 h-3.5 text-green-400" />
          <span className="text-xs font-medium text-green-400">运行正常</span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400 flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5" /> CPU
            </span>
            <span className="text-white font-mono">{metrics.cpu}%</span>
          </div>
          <ProgressBar value={metrics.cpu} color={metrics.cpu > 80 ? 'red' : 'primary'} />
        </div>
        
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400 flex items-center gap-1">
              <Activity className="w-3.5 h-3.5" /> 内存
            </span>
            <span className="text-white font-mono">{metrics.memory}%</span>
          </div>
          <ProgressBar value={metrics.memory} color={metrics.memory > 80 ? 'orange' : 'blue'} />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400 flex items-center gap-1">
              <HardDrive className="w-3.5 h-3.5" /> 磁盘
            </span>
            <span className="text-white font-mono">{metrics.disk}%</span>
          </div>
          <ProgressBar value={metrics.disk} color="green" />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400 flex items-center gap-1">
              <Server className="w-3.5 h-3.5" /> JVM
            </span>
            <span className="text-white font-mono">{metrics.jvm}%</span>
          </div>
          <ProgressBar value={metrics.jvm} color="orange" />
        </div>
      </div>

      {/* Services List */}
      <div className="space-y-3 pt-4 border-t border-white/5">
        {services.map((service) => (
          <div key={service.name} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              {service.status === 'up' ? (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              ) : service.status === 'warning' ? (
                <AlertCircle className="w-4 h-4 text-yellow-400" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400" />
              )}
              <span className="text-gray-300">{service.name}</span>
            </div>
            <div className="flex items-center gap-3">
              {service.latency && (
                <span className={cn(
                  "text-xs font-mono",
                  service.latency < 100 ? "text-green-400" : 
                  service.latency < 500 ? "text-yellow-400" : "text-red-400"
                )}>
                  {service.latency}ms
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SystemStatus;
