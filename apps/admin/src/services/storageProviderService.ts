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

export interface UpdateStorageProviderRequest {
  name?: string;
  configJson?: string;
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
   */
  update: async (id: number, data: UpdateStorageProviderRequest): Promise<R<StorageProvider>> => {
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
};
