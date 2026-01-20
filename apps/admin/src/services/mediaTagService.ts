import api from './api';
import type { R } from '@/types';
import type { MediaTag, CreateMediaTagRequest } from '@aetherblog/types';

/**
 * 媒体标签服务
 *
 * @ref 媒体库深度优化方案 - Phase 2: 智能标签系统
 */
export const mediaTagService = {
  /**
   * 获取所有标签
   */
  getAll: async (): Promise<R<MediaTag[]>> => {
    return api.get('/v1/admin/media/tags');
  },

  /**
   * 获取热门标签
   */
  getPopular: async (limit: number = 20): Promise<R<MediaTag[]>> => {
    return api.get(`/v1/admin/media/tags/popular?limit=${limit}`);
  },

  /**
   * 创建标签
   */
  create: async (data: CreateMediaTagRequest): Promise<R<MediaTag>> => {
    return api.post('/v1/admin/media/tags', data);
  },

  /**
   * 删除标签
   */
  delete: async (id: number): Promise<R<void>> => {
    return api.delete(`/v1/admin/media/tags/${id}`);
  },

  /**
   * 获取文件的标签
   */
  getFileTags: async (fileId: number): Promise<R<MediaTag[]>> => {
    return api.get(`/v1/admin/media/files/${fileId}/tags`);
  },

  /**
   * 给文件打标签
   */
  tagFile: async (fileId: number, tagIds: number[]): Promise<R<void>> => {
    return api.post(`/v1/admin/media/files/${fileId}/tags`, { tagIds });
  },

  /**
   * 取消文件标签
   */
  untagFile: async (fileId: number, tagId: number): Promise<R<void>> => {
    return api.delete(`/v1/admin/media/files/${fileId}/tags/${tagId}`);
  },

  /**
   * 批量打标签
   */
  batchTag: async (fileIds: number[], tagId: number): Promise<R<void>> => {
    return api.post('/v1/admin/media/tags/batch', { fileIds, tagId });
  },

  /**
   * 搜索标签
   */
  search: async (keyword: string): Promise<R<MediaTag[]>> => {
    return api.get(`/v1/admin/media/tags/search?keyword=${encodeURIComponent(keyword)}`);
  },
};
