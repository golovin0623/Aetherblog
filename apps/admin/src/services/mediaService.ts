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
    const response = await api.get<R<PageResult<MediaItem>>>('/v1/admin/media', {
      params: { pageNum, pageSize },
    });
    return response.data;
  },

  upload: async (file: File): Promise<R<MediaItem>> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<R<MediaItem>>('/v1/admin/media/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  delete: async (id: number): Promise<R<void>> => {
    const response = await api.delete<R<void>>(`/v1/admin/media/${id}`);
    return response.data;
  },
};
