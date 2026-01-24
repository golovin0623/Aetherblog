import api from './api';
import axios from 'axios';
import { R, PageResult } from '@/types';
import { useAuthStore } from '@/stores';

export type MediaType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';

export interface MediaItem {
  id: number;
  filename: string;
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
  folderId?: number; // @ref Phase 1: 文件夹ID过滤
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
 * 后端 context path 是 /api，所以 /uploads/* 需要变成 /api/uploads/*
 */
export const getMediaUrl = (fileUrl: string): string => {
  if (!fileUrl) return '';
  // 如果已经是完整URL，直接返回
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return fileUrl;
  }
  // /uploads/... -> /api/uploads/... (后端 context path 是 /api)
  if (fileUrl.startsWith('/uploads')) {
    return `/api${fileUrl}`;
  }
  return fileUrl;
};

export const mediaService = {
  /**
   * 获取媒体列表（支持筛选）
   */
  getList: (params: MediaListParams = {}): Promise<R<PageResult<MediaItem>>> => {
    const { fileType, keyword, folderId, pageNum = 1, pageSize = 24 } = params;
    return api.get<R<PageResult<MediaItem>>>('/v1/admin/media', {
      params: { fileType, keyword, folderId, pageNum, pageSize },
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
   * @param file 文件
   * @param onProgress 进度回调
   * @param folderId 文件夹ID (可选)
   */
  upload: async (
    file: File,
    onProgress?: (percent: number) => void,
    folderId?: number
  ): Promise<MediaItem> => {
    const formData = new FormData();
    formData.append('file', file);
    if (folderId !== undefined) {
      formData.append('folderId', folderId.toString());
    }

    const token = useAuthStore.getState().token;
    const response = await axios.post<R<MediaItem>>(
      `${API_BASE_URL}/v1/admin/media/upload`,
      formData,
      {
        headers: {
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

  /**
   * 移动文件到指定文件夹
   * @ref 媒体库深度优化方案 - Phase 1: 文件夹管理
   */
  moveToFolder: (fileId: number, folderId?: number): Promise<R<MediaItem>> => {
    return api.post<R<MediaItem>>(`/v1/admin/media/${fileId}/move`, null, {
      params: { folderId },
    });
  },

  /**
   * 批量移动文件到指定文件夹
   * @ref 媒体库深度优化方案 - Phase 1: 文件夹管理
   */
  batchMoveToFolder: (fileIds: number[], folderId?: number): Promise<R<void>> => {
    return api.post<R<void>>('/v1/admin/media/batch-move', { fileIds, folderId });
  },

  /**
   * 上传编辑后的图片内容
   */
  uploadEdited: async (id: number, formData: FormData): Promise<MediaItem> => {
    const token = useAuthStore.getState().token;
    const response = await axios.post<R<MediaItem>>(
      `${API_BASE_URL}/v1/admin/media/${id}/content`,
      formData,
      {
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      }
    );
    return response.data.data;
  },

  // ========== 回收站相关接口 ==========

  /**
   * 获取回收站文件列表
   */
  getTrashList: (params: { pageNum?: number; pageSize?: number } = {}): Promise<R<PageResult<MediaItem>>> => {
    const { pageNum = 1, pageSize = 24 } = params;
    return api.get<R<PageResult<MediaItem>>>('/v1/admin/media/trash', {
      params: { pageNum, pageSize },
    });
  },

  /**
   * 获取回收站文件数量
   */
  getTrashCount: (): Promise<R<number>> => {
    return api.get<R<number>>('/v1/admin/media/trash/count');
  },

  /**
   * 从回收站恢复文件
   */
  restore: (id: number): Promise<R<MediaItem>> => {
    return api.post<R<MediaItem>>(`/v1/admin/media/${id}/restore`);
  },

  /**
   * 批量从回收站恢复文件
   */
  batchRestore: (ids: number[]): Promise<R<void>> => {
    return api.post<R<void>>('/v1/admin/media/trash/batch-restore', ids);
  },

  /**
   * 彻底删除文件（从回收站永久删除）
   */
  permanentDelete: (id: number): Promise<R<void>> => {
    return api.delete<R<void>>(`/v1/admin/media/${id}/permanent`);
  },

  /**
   * 批量彻底删除文件
   */
  batchPermanentDelete: (ids: number[]): Promise<R<void>> => {
    return api.delete<R<void>>('/v1/admin/media/trash/batch-permanent', { data: ids });
  },

  /**
   * 清空回收站
   */
  emptyTrash: (): Promise<R<void>> => {
    return api.delete<R<void>>('/v1/admin/media/trash/empty');
  },
};

