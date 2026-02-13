/**
 * @file systemService.ts
 * @description 系统监控服务 - 获取系统指标、存储明细、服务健康状态、历史趋势、告警
 * @ref §8.2 - Dashboard 系统监控
 */

import api from './api';
import { R } from '@/types';

// ========== 类型定义 ==========

export interface SystemMetrics {
  cpuUsage: number;       // 0-100
  cpuCores: number;       // CPU 核心数
  cpuModel: string;       // CPU 型号
  cpuFrequency: number;   // CPU 频率 (Hz)
  memoryUsed: number;     // bytes
  memoryTotal: number;    // bytes
  memoryPercent: number;  // 0-100
  diskUsed: number;       // bytes
  diskTotal: number;      // bytes
  diskPercent: number;    // 0-100
  networkIn: number;      // bytes 累计接收
  networkOut: number;     // bytes 累计发送
  networkInSpeed: number; // bytes/s 实时接收速率
  networkOutSpeed: number;// bytes/s 实时发送速率
  networkInRate: string;  // 格式化的接收信息
  networkOutRate: string; // 格式化的发送信息
  networkPercent: number; // 带宽使用率 0-100
  networkMaxSpeed: number;// 配置的最大带宽 bytes/s
  uptime: number;         // seconds
  osName: string;         // 操作系统名称
  osArch: string;         // 系统架构
}

export interface StorageItem {
  name: string;
  size: number;           // bytes
  fileCount: number;
  formatted: string;      // "2.5 GB"
}

export interface StorageDetails {
  uploads: StorageItem;
  database: StorageItem;
  logs: StorageItem;
  redis: StorageItem;    // Redis 内存占用
  totalSize: number;
  usedSize: number;
  usedPercent: number;
}

export interface ServiceHealth {
  name: string;
  status: 'up' | 'down' | 'warning';
  latency: number;        // ms
  message: string;
  details?: Record<string, unknown>;
}

export interface MonitorOverview {
  metrics: SystemMetrics;
  storage: StorageDetails;
  services: ServiceHealth[];
}

// ========== 容器监控类型 ==========

export interface ContainerMetrics {
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

export interface ContainerOverview {
  containers: ContainerMetrics[];
  totalContainers: number;
  runningContainers: number;
  totalMemoryUsed: number;
  totalMemoryLimit: number;
  avgCpuPercent: number;
  dockerAvailable: boolean;
  errorMessage?: string;
}

// ========== 历史数据类型 ==========

export interface MetricPoint {
  time: string;   // ISO 日期时间格式
  value: number;
}

export interface NetworkPoint {
  time: string;
  in: number;   // 接收 bytes
  out: number;  // 发送 bytes
}

export interface MetricHistory {
  cpu: MetricPoint[];
  memory: MetricPoint[];
  disk: MetricPoint[];
  network: NetworkPoint[];  // 网络流量历史
  totalPoints: number;
  startTime?: string;
  endTime?: string;
}

export interface HistoryStats {
  totalPoints: number;
  estimatedSizeBytes: number;
  retentionMinutes: number;
  sampleIntervalSeconds: number;
  oldestTimestamp?: string;
  newestTimestamp?: string;
}

// ========== 日志文件类型 ==========

export interface LogFileInfo {
  level: string;
  filename: string;
  size: number;
  sizeFormatted: string;
  exists: boolean;
}

export type AppLogFetchStatus = 'ok' | 'no_data' | 'error';

export interface AppLogQueryPayload {
  lines: string[];
  cursor?: string | null;
  nextCursor?: string | null;
}

export interface AppLogQueryParams {
  keyword?: string;
  limit?: number;
  cursor?: string;
}

export interface AppLogFetchResult {
  lines: string[];
  status: AppLogFetchStatus;
  message?: string;
  errorCategory?: string;
  cursor?: string | null;
  nextCursor?: string | null;
}

// ========== 告警类型 ==========

export interface Alert {
  metric: string;         // cpu, memory, disk
  level: 'warning' | 'critical';
  currentValue: number;
  threshold: number;
  triggeredAt: string;
  message: string;
}

export interface AlertConfig {
  cpuThreshold: number;
  memoryThreshold: number;
  diskThreshold: number;
  sustainedCount: number;
  retentionMinutes: number;
  sampleIntervalSeconds: number;
}

export interface MonitoringConfig {
  alertConfig: AlertConfig;
  refreshOptions: number[];  // [5, 10, 30, 60, 300]
  historyDataSize: number;   // bytes
}

// ========== API 调用 ==========

export const systemService = {
  // ========== 实时指标 ==========
  
  /**
   * 获取系统指标 (CPU/内存/磁盘/网络)
   */
  getMetrics: () => api.get<R<SystemMetrics>>('/v1/admin/system/metrics'),

  /**
   * 获取存储明细 (上传文件/数据库/日志)
   */
  getStorage: () => api.get<R<StorageDetails>>('/v1/admin/system/storage'),

  /**
   * 获取服务健康状态 (PostgreSQL/Redis/ES)
   */
  getHealth: () => api.get<R<ServiceHealth[]>>('/v1/admin/system/health'),

  /**
   * 获取完整监控数据 (一次性获取所有)
   */
  getOverview: () => api.get<R<MonitorOverview>>('/v1/admin/system/overview'),

  /**
   * 获取 Docker 容器资源监控
   */
  getContainers: () => api.get<R<ContainerOverview>>('/v1/admin/system/containers'),

  // ========== 历史数据 ==========

  /**
   * 获取历史趋势数据 (用于图表)
   * @param minutes 最近 N 分钟
   * @param maxPoints 最大数据点数
   */
  getHistory: (minutes: number = 60, maxPoints: number = 60) => 
    api.get<R<MetricHistory>>(`/v1/admin/system/history?minutes=${minutes}&maxPoints=${maxPoints}`),

  /**
   * 获取历史数据统计
   */
  getHistoryStats: () => api.get<R<HistoryStats>>('/v1/admin/system/history/stats'),

  /**
   * 清理历史数据
   */
  cleanupHistory: () => api.delete<R<number>>('/v1/admin/system/history'),

  // ========== 告警 ==========

  /**
   * 获取当前活跃告警
   */
  getAlerts: () => api.get<R<Alert[]>>('/v1/admin/system/alerts'),

  // ========== 配置 ==========

  /**
   * 获取监控配置
   */
  getConfig: () => api.get<R<MonitoringConfig>>('/v1/admin/system/config'),
  /**
   * 获取容器实时日志
   */
  getContainerLogs: (id: string) => 
    api.get<R<string[]>>(`/v1/admin/system/containers/${id}/logs`).then(res => res.data),

  // ========== 应用日志 ==========

  /**
   * 按级别获取应用日志
   * @param level 日志级别 (ALL/INFO/WARN/ERROR/DEBUG)
   * @param lines 行数限制，默认 2000
   */
  getLogs: async (level: string = 'ALL', lines: number = 2000, params: AppLogQueryParams = {}): Promise<AppLogFetchResult> => {
    try {
      const query = new URLSearchParams();
      query.set('level', level);
      query.set('lines', String(lines));
      if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
        query.set('limit', String(params.limit));
      }
      if (params.keyword && params.keyword.trim()) {
        query.set('keyword', params.keyword.trim());
      }
      if (params.cursor && params.cursor.trim()) {
        query.set('cursor', params.cursor.trim());
      }

      const response = await api.get<R<string[] | AppLogQueryPayload>>(`/v1/admin/system/logs?${query.toString()}`);
      const payload = Array.isArray(response.data)
        ? { lines: response.data }
        : (response.data || { lines: [] });

      return {
        lines: Array.isArray(payload.lines) ? payload.lines : [],
        status: response.code === 200
          ? (response.errorCategory ? 'no_data' : 'ok')
          : 'error',
        message: response.message,
        errorCategory: response.errorCategory,
        cursor: typeof payload.cursor === 'string' || payload.cursor === null ? payload.cursor : undefined,
        nextCursor: typeof payload.nextCursor === 'string' || payload.nextCursor === null ? payload.nextCursor : undefined,
      };
    } catch (error: unknown) {
      const message = typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message || '日志请求失败')
        : '日志请求失败';
      const errorCategory = typeof error === 'object' && error && 'errorCategory' in error
        ? String((error as { errorCategory?: unknown }).errorCategory || '')
        : '';

      return {
        lines: [],
        status: 'error',
        message,
        errorCategory: errorCategory || undefined,
        cursor: undefined,
        nextCursor: undefined,
      };
    }
  },

  /**
   * 获取可用日志文件列表
   */
  getLogFiles: () => api.get<R<LogFileInfo[]>>('/v1/admin/system/logs/files'),

  /**
   * 获取日志文件下载 URL
   */
  getLogDownloadUrl: (level: string = 'ALL') => 
    `/api/v1/admin/system/logs/download?level=${level}`,
};

// ========== 工具函数 ==========

/**
 * 格式化字节数为可读字符串
 */
export function formatBytes(bytes: number): string {
  // 处理异常值：NaN、负数、非有限数
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  // 防止 i 超出 sizes 数组范围
  const safeIndex = Math.min(i, sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, safeIndex)).toFixed(2)) + ' ' + sizes[safeIndex];
}

/**
 * 格式化运行时间
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  return `${minutes}分钟`;
}

/**
 * 格式化带宽 (bps -> Mbps/Gbps)
 */
export function formatBandwidth(bps: number): string {
  const bits = bps * 8;
  if (!Number.isFinite(bits) || bits < 0) return '动态';
  if (bits === 0) return '0 bps';
  
  if (bits >= 1000 * 1000 * 1000) {
    return Math.round(bits / (1000 * 1000 * 1000)) + ' Gbps';
  }
  if (bits >= 1000 * 1000) {
    return Math.round(bits / (1000 * 1000)) + ' Mbps';
  }
  if (bits >= 1000) {
    return Math.round(bits / 1000) + ' Kbps';
  }
  return Math.round(bits) + ' bps';
}

/**
 * 格式化频率
 */
export function formatFrequency(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return '动态';
  if (hz >= 1_000_000_000) {
    return (hz / 1_000_000_000).toFixed(2) + ' GHz';
  } else if (hz >= 1_000_000) {
    return (hz / 1_000_000).toFixed(0) + ' MHz';
  }
  return hz + ' Hz';
}

/**
 * 格式化字节速率为可读字符串
 */
export function formatBytesPerSecond(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return '0 B/s';
  if (bytesPerSecond === 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
  const safeIndex = Math.min(i, sizes.length - 1);
  return parseFloat((bytesPerSecond / Math.pow(k, safeIndex)).toFixed(2)) + ' ' + sizes[safeIndex];
}

/**
 * 刷新频率选项
 */
export const REFRESH_OPTIONS = [
  { value: 5, label: '5 秒' },
  { value: 10, label: '10 秒' },
  { value: 30, label: '30 秒' },
  { value: 60, label: '1 分钟' },
  { value: 300, label: '5 分钟' },
];

export default systemService;
