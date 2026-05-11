import api from './api';
import type { R } from '@/types';

/**
 * 存储同步备份服务 — 对应后端 SyncHandler
 * @ref 对象存储 rollout - Phase 4
 */

export interface SyncStatus {
  running: boolean;
  counts: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  updatedAt: string;
}

export interface SyncFailedJob {
  id: number;
  mediaId: number;
  targetProviderId: number;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  attempt: number;
  lastError?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface SyncTargetProviderConfig {
  targetProviderId: number | null;
}

export const storageSyncService = {
  /**
   * 立即把所有未同步文件入队 + 启动 worker。
   * targetProviderId 缺省时使用已配置的备份目标;未配置时兼容使用非 LOCAL default provider。
   */
  start: (targetProviderId?: number): Promise<R<{ enqueued: number }>> => {
    return api.post('/v1/admin/storage/sync/start', targetProviderId ? { targetProviderId } : {});
  },

  /** 通知 worker 优雅停止 (当前批次跑完后退出) */
  cancel: (): Promise<R<void>> => {
    return api.post('/v1/admin/storage/sync/cancel');
  },

  /** 实时状态 */
  getStatus: (): Promise<R<SyncStatus>> => {
    return api.get('/v1/admin/storage/sync/status');
  },

  /** 最近失败的 job 列表 */
  listFailed: (limit = 50): Promise<R<SyncFailedJob[]>> => {
    return api.get('/v1/admin/storage/sync/failed', { params: { limit } });
  },

  /** 重试指定 FAILED job */
  retry: (jobIds: number[]): Promise<R<void>> => {
    return api.post('/v1/admin/storage/sync/retry', { jobIds });
  },

  /** 单文件入队 + 启动 worker (前端"立即同步"按钮) */
  syncOne: (mediaId: number, targetProviderId?: number): Promise<R<void>> => {
    return api.post(`/v1/admin/media/${mediaId}/sync`, targetProviderId ? { targetProviderId } : {});
  },

  /** 读取自动后台备份开关 */
  getAutoEnabled: (): Promise<R<{ autoEnabled: boolean }>> => {
    return api.get('/v1/admin/storage/sync/auto-enabled');
  },

  /** 切换自动后台备份开关(立即启停 worker) */
  setAutoEnabled: (autoEnabled: boolean): Promise<R<{ autoEnabled: boolean }>> => {
    return api.put('/v1/admin/storage/sync/auto-enabled', { autoEnabled });
  },

  /** 读取备份同步目标 provider 配置 */
  getTargetProvider: (): Promise<R<SyncTargetProviderConfig>> => {
    return api.get('/v1/admin/storage/sync/target-provider');
  },

  /** 设置备份同步目标 provider。null 表示清空显式配置并回退兼容逻辑。 */
  setTargetProvider: (targetProviderId: number | null): Promise<R<SyncTargetProviderConfig>> => {
    return api.put('/v1/admin/storage/sync/target-provider', { targetProviderId });
  },

  // ========== Phase 5: 删除备份 + 定期校验 ==========

  /** 删除备份对象,但保留主文件。sync_status 重置为 NONE。 */
  removeBackup: (mediaId: number): Promise<R<void>> => {
    return api.delete(`/v1/admin/media/${mediaId}/backup`);
  },

  /** 手动校验单条记录的备份对象是否存在(404 → 标记 MISSING) */
  verifyOne: (mediaId: number): Promise<R<void>> => {
    return api.post(`/v1/admin/media/${mediaId}/verify`);
  },

  /** 手动触发批量校验(后端按 staleBefore 拣 SYNCED 行,做 HEAD 检查) */
  verifyAll: (limit = 200): Promise<R<{ checked: number }>> => {
    return api.post('/v1/admin/storage/sync/verify', null, { params: { limit } });
  },

  /** 读取定期校验开关 + 当前间隔 + worker 是否运行 */
  getVerifyEnabled: (): Promise<R<{ autoEnabled: boolean; intervalSeconds: number; running: boolean }>> => {
    return api.get('/v1/admin/storage/sync/verify-enabled');
  },

  /** 切换定期校验开关(立即启停 verify worker) */
  setVerifyEnabled: (autoEnabled: boolean): Promise<R<{ autoEnabled: boolean }>> => {
    return api.put('/v1/admin/storage/sync/verify-enabled', { autoEnabled });
  },
};
