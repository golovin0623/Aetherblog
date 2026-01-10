/**
 * @file SystemStatus.tsx
 * @description 系统状态监控组件 - 显示 CPU/内存/磁盘/JVM 指标和服务健康状态
 * @ref §8.2 - Dashboard 系统监控
 */

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Server, 
  Database, 
  Cpu, 
  HardDrive, 
  Activity,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  Upload,
  FileText,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  systemService, 
  MonitorOverview, 
  formatBytes, 
  formatUptime 
} from '@/services/systemService';
import { logger } from '@/lib/logger';

// ========== 子组件 ==========

function ProgressBar({ value, color = 'primary' }: { value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary',
    green: 'bg-green-500',
    blue: 'bg-blue-500',
    orange: 'bg-orange-500',
    red: 'bg-red-500',
  };

  const getBarColor = () => {
    if (value > 90) return 'bg-red-500';
    if (value > 75) return 'bg-orange-500';
    return colorMap[color] || 'bg-primary';
  };

  return (
    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, value)}%` }}
        transition={{ duration: 1, ease: "easeOut" }}
        className={cn("h-full rounded-full", getBarColor())}
      />
    </div>
  );
}

function MetricCard({ 
  icon: Icon, 
  label, 
  value, 
  percent, 
  color,
  detail 
}: { 
  icon: React.ElementType;
  label: string;
  value: string;
  percent: number;
  color: string;
  detail?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400 flex items-center gap-1">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </span>
        <span className="text-white font-mono">{value}</span>
      </div>
      <ProgressBar value={percent} color={color} />
      {detail && (
        <div className="text-[10px] text-gray-500 text-right">{detail}</div>
      )}
    </div>
  );
}

// ========== 主组件 ==========

interface SystemStatusProps {
  refreshInterval?: number; // 刷新间隔 (秒)
}

export function SystemStatus({ refreshInterval = 30 }: SystemStatusProps) {
  const [data, setData] = useState<MonitorOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    
    try {
      const res = await systemService.getOverview();
      if (res.code === 200 && res.data) {
        setData(res.data);
        setError(null);
        setLastUpdate(new Date());
      } else {
        setError('获取数据失败');
      }
    } catch (err) {
      logger.error('Failed to fetch system status:', err);
      setError('连接失败');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // 初始加载和定时刷新
  useEffect(() => {
    fetchData();
    const timer = setInterval(() => fetchData(false), refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [fetchData, refreshInterval]);

  // 手动刷新
  const handleRefresh = () => {
    if (!isRefreshing) fetchData(true);
  };

  // 加载状态
  if (loading && !data) {
    return (
      <div className="p-6 rounded-xl bg-white/5 border border-white/10 h-[400px] animate-pulse">
        <div className="h-6 w-24 bg-white/10 rounded mb-6" />
        <div className="grid grid-cols-2 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 bg-white/10 rounded" />
              <div className="h-2 bg-white/10 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 使用真实数据或回退到默认值
  const metrics = data?.metrics || {
    cpuUsage: 0,
    memoryPercent: 0,
    memoryUsed: 0,
    memoryTotal: 0,
    diskPercent: 0,
    diskUsed: 0,
    diskTotal: 0,
    jvmPercent: 0,
    jvmHeapUsed: 0,
    jvmHeapMax: 0,
    uptime: 0,
  };

  const storage = data?.storage;
  const services = data?.services || [];

  return (
    <div className="p-6 rounded-xl bg-white/5 border border-white/10">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-white">系统状态</h3>
        <div className="flex items-center gap-3">
          {/* 运行时间 */}
          {metrics.uptime > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-gray-500">
              <Clock className="w-3 h-3" />
              <span>已运行 {formatUptime(metrics.uptime)}</span>
            </div>
          )}
          
          {/* 刷新按钮 */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
          </button>
          
          {/* 状态徽章 */}
          <div className={cn(
            "flex items-center gap-2 px-2 py-1 rounded border",
            error 
              ? "bg-red-500/10 border-red-500/20" 
              : "bg-green-500/10 border-green-500/20"
          )}>
            {error ? (
              <>
                <XCircle className="w-3.5 h-3.5 text-red-400" />
                <span className="text-xs font-medium text-red-400">{error}</span>
              </>
            ) : (
              <>
                <Activity className="w-3.5 h-3.5 text-green-400" />
                <span className="text-xs font-medium text-green-400">运行正常</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 系统指标 */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <MetricCard
          icon={Cpu}
          label="CPU"
          value={`${metrics.cpuUsage.toFixed(1)}%`}
          percent={metrics.cpuUsage}
          color="primary"
        />
        <MetricCard
          icon={Activity}
          label="内存"
          value={`${metrics.memoryPercent.toFixed(1)}%`}
          percent={metrics.memoryPercent}
          color="blue"
          detail={`${formatBytes(metrics.memoryUsed)} / ${formatBytes(metrics.memoryTotal)}`}
        />
        <MetricCard
          icon={HardDrive}
          label="磁盘"
          value={`${metrics.diskPercent.toFixed(1)}%`}
          percent={metrics.diskPercent}
          color="green"
          detail={`${formatBytes(metrics.diskUsed)} / ${formatBytes(metrics.diskTotal)}`}
        />
        <MetricCard
          icon={Server}
          label="JVM"
          value={`${metrics.jvmPercent.toFixed(1)}%`}
          percent={metrics.jvmPercent}
          color="orange"
          detail={`${formatBytes(metrics.jvmHeapUsed)} / ${formatBytes(metrics.jvmHeapMax)}`}
        />
      </div>

      {/* 存储明细 */}
      {storage && (
        <div className="mb-6 pt-4 border-t border-white/5">
          <h4 className="text-xs font-medium text-gray-400 mb-3 flex items-center gap-1">
            <Database className="w-3.5 h-3.5" />
            存储明细
          </h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400 flex items-center gap-1.5">
                <Upload className="w-3 h-3" />
                上传文件
              </span>
              <span className="text-white font-mono">
                {storage.uploads.formatted}
                <span className="text-gray-500 ml-1">
                  ({storage.uploads.fileCount.toLocaleString()} 个)
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400 flex items-center gap-1.5">
                <Database className="w-3 h-3" />
                数据库
              </span>
              <span className="text-white font-mono">{storage.database.formatted}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400 flex items-center gap-1.5">
                <FileText className="w-3 h-3" />
                日志
              </span>
              <span className="text-white font-mono">{storage.logs.formatted}</span>
            </div>
          </div>
        </div>
      )}

      {/* 服务健康 */}
      <div className="space-y-3 pt-4 border-t border-white/5">
        <AnimatePresence mode="popLayout">
          {services.map((service) => (
            <motion.div
              key={service.name}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                {service.status === 'up' ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : service.status === 'warning' ? (
                  <AlertCircle className="w-4 h-4 text-yellow-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <span className="text-gray-300">{service.name}</span>
                {/* ES 黄色状态说明 */}
                {service.name === 'Elasticsearch' && service.status === 'warning' && (
                  <span className="text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">
                    单节点
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {service.latency > 0 && (
                  <span className={cn(
                    "text-xs font-mono",
                    service.latency < 100 ? "text-green-400" : 
                    service.latency < 500 ? "text-yellow-400" : "text-red-400"
                  )}>
                    {service.latency}ms
                  </span>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 上次更新时间 */}
      {lastUpdate && (
        <div className="mt-4 pt-3 border-t border-white/5 text-[10px] text-gray-600 text-center">
          上次更新: {lastUpdate.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

export default SystemStatus;
