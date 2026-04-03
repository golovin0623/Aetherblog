/**
 * @file ContainerStatus.tsx
 * @description Docker 容器资源监控组件 - 显示各模块 CPU/内存使用情况
 * @ref §8.2 - Dashboard 系统监控
 */

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Box,
  Terminal,
  Database,
  Newspaper,
  Zap,
  Search,
  Bot,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Shield,
  Settings
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { systemService, formatBytes } from '@/services/systemService';
import { logger } from '@/lib/logger';
import { useSmartPolling } from '@/hooks/useSmartPolling';

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

// ========== 工具函数 ==========

/** 格式化 CPU 百分比：< 0.1% 时显示两位小数以保留极小非零值，否则一位小数 */
function formatCpuPercent(value: number): string {
  if (value > 0 && value < 0.1) return value.toFixed(2);
  return value.toFixed(1);
}

// ========== 子组件 ==========

function ProgressBar({ value, color = 'primary' }: { value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary',
    green: 'bg-status-success',
    blue: 'bg-status-info',
    orange: 'bg-status-warning',
    red: 'bg-status-danger',
    purple: 'bg-accent',
    cyan: 'bg-cyan-500',
  };

  const getBarColor = () => {
    if (value > 90) return 'bg-status-danger';
    if (value > 75) return 'bg-status-warning';
    return colorMap[color] || 'bg-primary';
  };

  return (
    <div className="h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden flex-1">
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
    backend: <Terminal className="w-4 h-4" />,
    blog: <Newspaper className="w-4 h-4" />,
    gateway: <Shield className="w-4 h-4" />,
    admin: <Settings className="w-4 h-4" />,
    database: <Database className="w-4 h-4" />,
    cache: <Zap className="w-4 h-4" />,
    search: <Search className="w-4 h-4" />,
    ai: <Bot className="w-4 h-4" />,
  };

  const colorMap: Record<string, string> = {
    backend: 'bg-teal-500/20 text-teal-500',
    blog: 'bg-emerald-500/20 text-emerald-500',
    gateway: 'bg-blue-500/20 text-blue-500',
    admin: 'bg-amber-500/20 text-amber-500',
    database: 'bg-indigo-500/20 text-indigo-500',
    cache: 'bg-red-500/20 text-red-500',
    search: 'bg-cyan-500/20 text-cyan-500',
    ai: 'bg-violet-500/20 text-violet-500',
  };

  return (
    <div className={cn("p-2 rounded-lg", colorMap[type] || 'bg-[var(--bg-secondary)] text-[var(--text-muted)]')}>
      {iconMap[type] || <Box className="w-4 h-4" />}
    </div>
  );
}

function ContainerCard({ 
  container, 
  onClick, 
  isSelected 
}: { 
  container: ContainerMetrics; 
  onClick?: () => void;
  isSelected?: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={cn(
        "p-3 rounded-lg border transition-all cursor-pointer",
        isSelected 
          ? "bg-primary/10 border-primary/30" 
          : "bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]"
      )}
    >
      <div className="flex items-center gap-3">
        <ContainerIcon type={container.type} />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className={cn("text-sm font-medium truncate", isSelected ? "text-primary" : "text-[var(--text-primary)]")}>
              {container.displayName}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] font-mono ml-2">
              CPU {formatCpuPercent(container.cpuPercent)}%
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <ProgressBar value={container.memoryPercent} color="blue" />
            <span className="text-[10px] text-[var(--text-muted)] font-mono whitespace-nowrap">
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
    displayName: 'backend',
    status: 'running',
    state: 'Up 2 hours',
    cpuPercent: 12.5,
    memoryUsed: 485 * 1024 * 1024,
    memoryLimit: 1536 * 1024 * 1024,
    memoryPercent: 31.6,
    image: 'aetherblog-backend:latest',
    type: 'backend'
  },
  {
    id: 'mock-2',
    name: 'aetherblog-blog',
    displayName: 'blog',
    status: 'running',
    state: 'Up 2 hours',
    cpuPercent: 5.2,
    memoryUsed: 195 * 1024 * 1024,
    memoryLimit: 512 * 1024 * 1024,
    memoryPercent: 38.1,
    image: 'aetherblog-blog:latest',
    type: 'blog'
  },
  {
    id: 'mock-3',
    name: 'aetherblog-admin',
    displayName: 'admin',
    status: 'running',
    state: 'Up 2 hours',
    cpuPercent: 0.8,
    memoryUsed: 42 * 1024 * 1024,
    memoryLimit: 128 * 1024 * 1024,
    memoryPercent: 32.8,
    image: 'aetherblog-admin:latest',
    type: 'admin'
  },
  {
    id: 'mock-4',
    name: 'aetherblog-postgres',
    displayName: 'postgres',
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
    displayName: 'redis',
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



// ========== 主组件 ==========

interface ContainerStatusProps {
  refreshInterval?: number;
  onSelectContainer?: (id: string, name: string) => void;
  selectedId?: string | null;
  className?: string;
}

export function ContainerStatus({ 
  refreshInterval = 30, 
  onSelectContainer,
  selectedId,
  className 
}: ContainerStatusProps) {
  const [data, setData] = useState<ContainerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      const res = await systemService.getContainers();
      if (res.code === 200 && res.data) {
        setData(res.data);
      }
    } catch (err) {
      logger.error('Failed to fetch container metrics:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // 初始数据拉取
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 智能轮询
  useSmartPolling({
    callback: () => fetchData(false),
    interval: refreshInterval
  });

  // 数据加载完成且未选中容器时，自动选中第一个容器
  useEffect(() => {
    if (data?.containers?.length && !selectedId && onSelectContainer) {
       onSelectContainer(data.containers[0].id, data.containers[0].displayName);
    }
  }, [data, selectedId, onSelectContainer]);

  const handleRefresh = () => {
    if (!isRefreshing) fetchData(true);
  };

  // 始终渲染主结构，在内部处理加载状态
  return (
    <div className={cn("rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col min-h-0", className)}>
      {/* 头部 - 始终显示 */}
      <div className="p-4 sm:p-6 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)]">容器监控</h3>
          {data ? (
            <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded">
               {data.runningContainers}/{data.totalContainers}
            </span>
          ) : (
             <div className="h-5 w-10 bg-[var(--bg-secondary)] rounded animate-pulse" />
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || (loading && !data)}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", (isRefreshing || (loading && !data)) && "animate-spin")} />
          </button>
          
          <div className="flex items-center gap-1 px-2 py-1 rounded border bg-status-success-light border-status-success-border">
            <CheckCircle2 className="w-3.5 h-3.5 text-status-success" />
            <span className="text-[10px] font-medium text-status-success">正常</span>
          </div>
        </div>
      </div>

      {/* 容器列表 or Skeleton or Error */}
      <div className="p-4 space-y-2 overflow-y-auto custom-scrollbar flex-1 min-h-0">
        {loading && !data ? (
          // 骨架屏列表
          [1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--bg-secondary)] animate-pulse shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex justify-between">
                  <div className="h-4 w-32 bg-[var(--bg-secondary)] rounded animate-pulse" />
                  <div className="h-3 w-12 bg-[var(--bg-secondary)] rounded animate-pulse" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 bg-[var(--bg-secondary)] rounded-full animate-pulse" />
                  <div className="h-3 w-16 bg-[var(--bg-secondary)] rounded animate-pulse" />
                </div>
              </div>
            </div>
          ))
        ) : !data?.dockerAvailable ? (
          // 错误状态
          <div className="flex flex-col items-center justify-center text-[var(--text-muted)] h-full">
            <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
            <span className="text-sm">Docker API 不可用</span>
          </div>
        ) : (
          // 实际容器列表
          <AnimatePresence mode="popLayout">
            {data.containers.map((container) => (
              <ContainerCard 
                key={container.id} 
                container={container} 
                onClick={() => onSelectContainer?.(container.id, container.displayName)}
                isSelected={selectedId === container.id}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* 汇总信息 or Skeleton Footer */}
      <div className="shrink-0 p-3 border-t border-[var(--border-subtle)]">
        {loading && !data ? (
            <div className="flex justify-between">
               <div className="h-3 w-24 bg-[var(--bg-secondary)] rounded animate-pulse" />
               <div className="h-3 w-16 bg-[var(--bg-secondary)] rounded animate-pulse" />
            </div>
        ) : data && data.containers.length > 0 ? (
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
              <span>
                内存: {formatBytes(data.totalMemoryUsed)} / {formatBytes(data.totalMemoryLimit)}
              </span>
              <span>
                CPU: {data.avgCpuPercent.toFixed(1)}%
              </span>
            </div>
        ) : null}
      </div>
    </div>
  );
}

export default ContainerStatus;
