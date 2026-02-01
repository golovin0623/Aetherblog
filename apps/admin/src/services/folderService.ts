/**
 * 文件夹服务
 * @ref 媒体库深度优化方案 - Phase 1: 文件夹层级管理
 */

import type {
  MediaFolder,
  FolderTreeNode,
  CreateFolderRequest,
  UpdateFolderRequest,
  MoveFolderRequest,
} from '@aetherblog/types';
import api from './api';
import type { R } from '@/types';

export const folderService = {
  /**
   * 获取文件夹树
   */
  getTree: async (userId?: number): Promise<R<FolderTreeNode[]>> => {
    const params = userId ? { userId } : {};
    return api.get('/v1/admin/media/folders/tree', { params });
  },

  /**
   * 根据ID获取文件夹详情
   */
  getById: async (id: number): Promise<R<MediaFolder>> => {
    return api.get(`/v1/admin/media/folders/${id}`);
  },

  /**
   * 获取子文件夹
   */
  getChildren: async (parentId: number): Promise<R<MediaFolder[]>> => {
    return api.get(`/v1/admin/media/folders/${parentId}/children`);
  },

  /**
   * 创建文件夹
   */
  create: async (data: CreateFolderRequest): Promise<R<MediaFolder>> => {
    return api.post('/v1/admin/media/folders', data);
  },

  /**
   * 更新文件夹
   */
  update: async (id: number, data: UpdateFolderRequest): Promise<R<MediaFolder>> => {
    return api.put(`/v1/admin/media/folders/${id}`, data);
  },

  /**
   * 删除文件夹
   */
  delete: async (id: number): Promise<R<void>> => {
    return api.delete(`/v1/admin/media/folders/${id}`);
  },

  /**
   * 移动文件夹
   */
  move: async (id: number, data: MoveFolderRequest): Promise<R<MediaFolder>> => {
    return api.post(`/v1/admin/media/folders/${id}/move`, data);
  },

  /**
   * 刷新文件夹统计
   */
  refreshStatistics: async (id: number): Promise<R<void>> => {
    return api.post(`/v1/admin/media/folders/${id}/refresh-stats`);
  },
};
