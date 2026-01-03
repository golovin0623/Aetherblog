import api from './api';
import { R, PageResult } from '@/types';

export interface MediaItem {
  id: number;
  name: string;
  url: string;
  type: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export const mediaService = {
  getList: async (pageNum = 1, pageSize = 20): Promise<R<PageResult<MediaItem>>> => {
    return api.get<R<PageResult<MediaItem>>>('/v1/admin/media', {
      params: { pageNum, pageSize },
    });
  },

  upload: async (file: File): Promise<R<MediaItem>> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<R<MediaItem>>('/v1/admin/media/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  delete: async (id: number): Promise<R<void>> => {
    return api.delete<R<void>>(`/v1/admin/media/${id}`);
  },
};

