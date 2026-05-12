import api from './api';
import type { R } from '@/types';
import type { StorageProvider, StorageProviderType } from '@aetherblog/types';

/**
 * 存储提供商服务
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 */

export interface CreateStorageProviderRequest {
  name: string;
  providerType: StorageProviderType;
  configJson: string;
  isDefault?: boolean;
  isEnabled?: boolean;
  priority?: number;
}

// 后端 dto.StorageProviderRequest 要求 name/providerType/configJson 都是 required,
// 即便是 PUT(update) 也需要全部传(后端会做 secret-merge 逻辑保留旧 secret)。
export interface UpdateStorageProviderRequest {
  name: string;
  providerType: StorageProviderType;
  configJson: string;
  isEnabled?: boolean;
  priority?: number;
}

export const storageProviderService = {
  /**
   * 获取所有存储提供商
   */
  getAll: async (): Promise<R<StorageProvider[]>> => {
    return api.get('/v1/admin/storage/providers');
  },

  /**
   * 根据ID获取
   */
  getById: async (id: number): Promise<R<StorageProvider>> => {
    return api.get(`/v1/admin/storage/providers/${id}`);
  },

  /**
   * 获取默认存储提供商
   */
  getDefault: async (): Promise<R<StorageProvider>> => {
    return api.get('/v1/admin/storage/providers/default');
  },

  /**
   * 创建存储提供商
   */
  create: async (data: CreateStorageProviderRequest): Promise<R<StorageProvider>> => {
    return api.post('/v1/admin/storage/providers', data);
  },

  /**
   * 更新存储提供商
   *
   * 入参支持 CreateStorageProviderRequest 形状(前端 Phase 2 直接复用 create 表单字段),
   * 也接受 UpdateStorageProviderRequest 显式形状。
   */
  update: async (id: number, data: CreateStorageProviderRequest | UpdateStorageProviderRequest): Promise<R<StorageProvider>> => {
    return api.put(`/v1/admin/storage/providers/${id}`, data);
  },

  /**
   * 删除存储提供商
   */
  delete: async (id: number): Promise<R<void>> => {
    return api.delete(`/v1/admin/storage/providers/${id}`);
  },

  /**
   * 设置为默认
   */
  setAsDefault: async (id: number): Promise<R<void>> => {
    return api.post(`/v1/admin/storage/providers/${id}/set-default`);
  },

  /**
   * 测试连接
   */
  testConnection: async (id: number): Promise<R<{ success: boolean; message: string }>> => {
    return api.post(`/v1/admin/storage/providers/${id}/test`);
  },

  // ========== Phase 5: 云端浏览 + 反向导入 ==========

  /**
   * 列出指定 provider 上 prefix 下的对象,带 catalog 状态。
   */
  listObjects: async (
    providerId: number,
    options: { prefix?: string; token?: string; limit?: number } = {}
  ): Promise<R<ListObjectsResult>> => {
    return api.get(`/v1/admin/storage/providers/${providerId}/objects`, {
      params: {
        prefix: options.prefix,
        token: options.token,
        limit: options.limit,
      },
    });
  },

  /**
   * 把云端 ORPHAN 对象批量导入 catalog。
   */
  importObjects: async (providerId: number, keys: string[]): Promise<R<{ imported: number; skippedKeys?: string[] }>> => {
    return api.post(`/v1/admin/storage/providers/${providerId}/import`, { keys });
  },

  /**
   * 删除云端 ORPHAN 对象。catalog 中存在的 key 会被拒绝(refusedKeys 返回)。
   */
  deleteObjects: async (providerId: number, keys: string[]): Promise<R<{ deleted: number; refusedKeys?: string[] }>> => {
    return api.delete(`/v1/admin/storage/providers/${providerId}/objects`, { data: { keys } });
  },

  // ========== 配置导入 / 导出 ==========

  /**
   * 导出所有 storage provider 配置(含明文密钥)。
   *
   * SECURITY:返回 payload 包含 accessKey/secretKey 明文,UI 触发前必须给用户警告。
   */
  exportConfig: async (): Promise<R<StorageProviderExportPayload>> => {
    return api.get('/v1/admin/storage/providers/export');
  },

  /**
   * 导入 storage provider 配置。同名 provider 会被跳过,不覆盖已有配置。
   * 若 payload 中有 isDefault=true 项且实际新建,则自动切换为默认 provider。
   */
  importConfig: async (payload: StorageProviderExportPayload): Promise<R<StorageProviderImportResult>> => {
    return api.post('/v1/admin/storage/providers/import', payload);
  },
};

// 配置导入/导出类型
export interface StorageProviderExportItem {
  name: string;
  providerType: StorageProviderType;
  configJson: string;
  isDefault: boolean;
  isEnabled: boolean;
  priority: number;
}

export interface StorageProviderExportPayload {
  version: number;
  exportedAt: string;
  providers: StorageProviderExportItem[];
}

export interface StorageProviderImportResult {
  imported: number;
  skippedNames?: string[];
  failedNames?: string[];
  defaultSet?: string;
}

// Phase 5 类型
export interface ListObjectsResult {
  objects?: Array<{
    key: string;
    url?: string;
    size: number;
    lastModified?: string;
    etag?: string;
    mediaFileId?: number;
    status: 'IN_CATALOG' | 'ORPHAN';
  }>;
  nextToken?: string;
}
