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
  memoryUsed: number;     // bytes
  memoryTotal: number;    // bytes
  memoryPercent: number;  // 0-100
  diskUsed: number;       // bytes
  diskTotal: number;      // bytes
  diskPercent: number;    // 0-100
  networkIn: number;      // bytes 累计接收
  networkOut: number;     // bytes 累计发送
  networkInRate: string;  // 格式化的接收信息
  networkOutRate: string; // 格式化的发送信息
  uptime: number;         // seconds
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
};

// ========== 工具函数 ==========

/**
 * 格式化字节数为可读字符串
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

