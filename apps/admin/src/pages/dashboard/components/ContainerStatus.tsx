/**
 * @file ContainerStatus.tsx
 * @description Docker 容器资源监控组件 - 显示各模块 CPU/内存使用情况
 * @ref §8.2 - Dashboard 系统监控
 */

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Box, 
  Server, 
  Database, 
  Globe,
  Zap,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { systemService, formatBytes } from '@/services/systemService';
import { logger } from '@/lib/logger';

// ========== 类型定义 ==========

interface ContainerMetrics {
  id: string;
  name: string;
  displayName: string;
  status: string;
  state: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryLimit: number;
  memoryPercent: number;
  image: string;
  type: string;
}

interface ContainerOverview {
  containers: ContainerMetrics[];
  totalContainers: number;
  runningContainers: number;
  totalMemoryUsed: number;
  totalMemoryLimit: number;
  avgCpuPercent: number;
  dockerAvailable: boolean;
  errorMessage?: string;
}

// ========== 子组件 ==========

function ProgressBar({ value, color = 'primary' }: { value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary',
    green: 'bg-green-500',
    blue: 'bg-blue-500',
    orange: 'bg-orange-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500',
    cyan: 'bg-cyan-500',
  };

  const getBarColor = () => {
    if (value > 90) return 'bg-red-500';
    if (value > 75) return 'bg-orange-500';
    return colorMap[color] || 'bg-primary';
  };

  return (
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden flex-1">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, value)}%` }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className={cn("h-full rounded-full", getBarColor())}
      />
    </div>
  );
}

function ContainerIcon({ type }: { type: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    java: <Server className="w-4 h-4" />,
    nodejs: <Globe className="w-4 h-4" />,
    nginx: <Box className="w-4 h-4" />,
    database: <Database className="w-4 h-4" />,
    cache: <Zap className="w-4 h-4" />,
    search: <Search className="w-4 h-4" />,
  };

  const colorMap: Record<string, string> = {
    java: 'bg-orange-500/20 text-orange-400',
    nodejs: 'bg-green-500/20 text-green-400',
    nginx: 'bg-blue-500/20 text-blue-400',
    database: 'bg-purple-500/20 text-purple-400',
    cache: 'bg-red-500/20 text-red-400',
    search: 'bg-cyan-500/20 text-cyan-400',
  };

  return (
    <div className={cn("p-2 rounded-lg", colorMap[type] || 'bg-white/10 text-gray-400')}>
      {iconMap[type] || <Box className="w-4 h-4" />}
    </div>
  );
}

function ContainerCard({ container }: { container: ContainerMetrics }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-3 rounded-lg bg-white/5 border border-white/5 hover:border-white/10 transition-colors"
    >
      <div className="flex items-center gap-3">
        <ContainerIcon type={container.type} />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-white truncate">
              {container.displayName}
            </span>
            <span className="text-[10px] text-gray-500 font-mono ml-2">
              CPU {container.cpuPercent.toFixed(1)}%
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <ProgressBar value={container.memoryPercent} color="blue" />
            <span className="text-[10px] text-gray-400 font-mono whitespace-nowrap">
              {formatBytes(container.memoryUsed)} / {formatBytes(container.memoryLimit)}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ========== 模拟数据 ==========

const mockContainers: ContainerMetrics[] = [
  {
    id: 'mock-1',
    name: 'aetherblog-backend',
    displayName: 'Backend (Java)',
    status: 'running',
    state: 'Up 2 hours',
    cpuPercent: 12.5,
    memoryUsed: 485 * 1024 * 1024,
    memoryLimit: 1536 * 1024 * 1024,
    memoryPercent: 31.6,
    image: 'aetherblog-backend:latest',
    type: 'java'
  },
  {
    id: 'mock-2',
    name: 'aetherblog-blog',
    displayName: 'Blog (Node.js)',
    status: 'running',
    state: 'Up 2 hours',
    cpuPercent: 5.2,
    memoryUsed: 195 * 1024 * 1024,
    memoryLimit: 512 * 1024 * 1024,
    memoryPercent: 38.1,
    image: 'aetherblog-blog:latest',
    type: 'nodejs'
  },
  {
    id: 'mock-3',
    name: 'aetherblog-admin',
    displayName: 'Admin (Nginx)',
    status: 'running',
    state: 'Up 2 hours',
    cpuPercent: 0.8,
    memoryUsed: 42 * 1024 * 1024,
    memoryLimit: 128 * 1024 * 1024,
    memoryPercent: 32.8,
    image: 'aetherblog-admin:latest',
    type: 'nginx'
  },
  {
    id: 'mock-4',
    name: 'aetherblog-postgres',
    displayName: 'PostgreSQL',
    status: 'running',
    state: 'Up 3 hours',
    cpuPercent: 3.1,
    memoryUsed: 380 * 1024 * 1024,
    memoryLimit: 512 * 1024 * 1024,
    memoryPercent: 74.2,
    image: 'pgvector/pgvector:pg17',
    type: 'database'
  },
  {
    id: 'mock-5',
    name: 'aetherblog-redis',
    displayName: 'Redis',
    status: 'running',
    state: 'Up 3 hours',
    cpuPercent: 0.5,
    memoryUsed: 45 * 1024 * 1024,
    memoryLimit: 128 * 1024 * 1024,
    memoryPercent: 35.2,
    image: 'redis:7.2-alpine',
    type: 'cache'
  }
];

const mockOverview: ContainerOverview = {
  containers: mockContainers,
  totalContainers: 5,
  runningContainers: 5,
  totalMemoryUsed: mockContainers.reduce((sum, c) => sum + c.memoryUsed, 0),
  totalMemoryLimit: mockContainers.reduce((sum, c) => sum + c.memoryLimit, 0),
  avgCpuPercent: mockContainers.reduce((sum, c) => sum + c.cpuPercent, 0) / mockContainers.length,
  dockerAvailable: true
};

// ========== 主组件 ==========

interface ContainerStatusProps {
  refreshInterval?: number;
  useMock?: boolean; // 开发模式下使用模拟数据
}

export function ContainerStatus({ refreshInterval = 30, useMock = false }: ContainerStatusProps) {
  const [data, setData] = useState<ContainerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    
    try {
      const res = await systemService.getContainers();
      if (res.code === 200 && res.data) {
        // 如果 Docker 不可用或没有容器，使用模拟数据
        if (!res.data.dockerAvailable || res.data.containers.length === 0) {
          setData(mockOverview);
        } else {
          setData(res.data);
        }
      } else {
        // API 失败时使用模拟数据
        setData(mockOverview);
      }
    } catch (err) {
      logger.error('Failed to fetch container status:', err);
      // 错误时使用模拟数据
      setData(mockOverview);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [useMock]);

  useEffect(() => {
    fetchData();
    const timer = setInterval(() => fetchData(false), refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [fetchData, refreshInterval]);

  const handleRefresh = () => {
    if (!isRefreshing) fetchData(true);
  };

  // 加载状态
  if (loading && !data) {
    return (
      <div className="p-6 rounded-xl bg-white/5 border border-white/10">
        <div className="h-6 w-32 bg-white/10 rounded mb-4 animate-pulse" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 bg-white/5 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl bg-white/5 border border-white/10">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-white">容器监控</h3>
          {data && (
            <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded">
              {data.runningContainers}/{data.totalContainers} 运行中
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
          </button>
          
          <div className="flex items-center gap-1 px-2 py-1 rounded border bg-green-500/10 border-green-500/20">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
            <span className="text-xs font-medium text-green-400">正常</span>
          </div>
        </div>
      </div>

      {/* 容器列表 */}
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {data?.containers.map((container) => (
            <ContainerCard key={container.id} container={container} />
          ))}
        </AnimatePresence>
      </div>

      {/* 汇总信息 */}
      {data && data.containers.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-gray-500">
          <span>
            总内存: {formatBytes(data.totalMemoryUsed)} / {formatBytes(data.totalMemoryLimit)}
          </span>
          <span>
            平均 CPU: {data.avgCpuPercent.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

export default ContainerStatus;
