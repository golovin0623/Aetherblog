/**
 * @file systemService.ts
 * @description 系统监控服务 - 获取系统指标、存储明细、服务健康状态
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
  jvmHeapUsed: number;    // bytes
  jvmHeapMax: number;     // bytes
  jvmPercent: number;     // 0-100
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

// ========== API 调用 ==========

export const systemService = {
  /**
   * 获取系统指标 (CPU/内存/磁盘/JVM)
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

export default systemService;
