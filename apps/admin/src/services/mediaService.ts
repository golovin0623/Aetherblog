import api from './api';
import axios from 'axios';
import { R, PageResult } from '@/types';
import { useAuthStore } from '@/stores';

export type MediaType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';

export interface MediaItem {
  id: number;
  originalName: string;
  fileUrl: string;
  fileType: MediaType;
  fileSize: number;
  mimeType: string;
  altText?: string;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface MediaListParams {
  fileType?: MediaType;
  keyword?: string;
  sortBy?: 'newest' | 'oldest' | 'name' | 'size';
  pageNum?: number;
  pageSize?: number;
}

export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  imageCount: number;
  videoCount: number;
  audioCount: number;
  documentCount: number;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * 获取媒体文件的完整URL
 * 开发环境: Vite proxy 转发 /uploads/* 到 localhost:8080
 * 生产环境: Nginx 转发 /uploads/* 到 backend:8080
 */
export const getMediaUrl = (fileUrl: string): string => {
  if (!fileUrl) return '';
  // 如果已经是完整URL，直接返回
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return fileUrl;
  }
  // 相对路径直接返回，由 Vite/Nginx 代理
  return fileUrl;
};

export const mediaService = {
  /**
   * 获取媒体列表（支持筛选）
   */
  getList: (params: MediaListParams = {}): Promise<R<PageResult<MediaItem>>> => {
    const { fileType, keyword, pageNum = 1, pageSize = 24 } = params;
    return api.get<R<PageResult<MediaItem>>>('/v1/admin/media', {
      params: { fileType, keyword, pageNum, pageSize },
    });
  },

  /**
   * 获取媒体详情
   */
  getDetail: (id: number): Promise<R<MediaItem>> => {
    return api.get<R<MediaItem>>(`/v1/admin/media/${id}`);
  },

  /**
   * 上传文件（支持进度回调）
   */
  upload: async (
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<MediaItem> => {
    const formData = new FormData();
    formData.append('file', file);

    const token = useAuthStore.getState().token;
    const response = await axios.post<R<MediaItem>>(
      `${API_BASE_URL}/v1/admin/media/upload`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        onUploadProgress: (event) => {
          if (event.total && onProgress) {
            const percent = Math.round((event.loaded * 100) / event.total);
            onProgress(percent);
          }
        },
      }
    );
    return response.data.data;
  },

  /**
   * 批量上传
   */
  uploadBatch: async (
    files: File[],
    onProgress?: (fileIndex: number, percent: number) => void
  ): Promise<MediaItem[]> => {
    const results: MediaItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const result = await mediaService.upload(files[i], (percent) => {
        onProgress?.(i, percent);
      });
      results.push(result);
    }
    return results;
  },

  /**
   * 更新媒体信息
   */
  update: (
    id: number,
    data: { altText?: string; originalName?: string }
  ): Promise<R<MediaItem>> => {
    return api.put<R<MediaItem>>(`/v1/admin/media/${id}`, null, {
      params: data,
    });
  },

  /**
   * 删除媒体
   */
  delete: (id: number): Promise<R<void>> => {
    return api.delete<R<void>>(`/v1/admin/media/${id}`);
  },

  /**
   * 批量删除
   */
  batchDelete: (ids: number[]): Promise<R<void>> => {
    return api.delete<R<void>>('/v1/admin/media/batch', { data: ids });
  },

  /**
   * 获取存储统计
   */
  getStats: (): Promise<R<StorageStats>> => {
    return api.get<R<StorageStats>>('/v1/admin/media/stats');
  },
};

