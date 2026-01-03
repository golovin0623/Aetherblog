import api from './api';
import { R } from '@/types';

export interface Tag {
  id: number;
  name: string;
  slug: string;
  postCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTagRequest {
  name: string;
  slug?: string;
}

export const tagService = {
  getList: (): Promise<R<Tag[]>> =>
    api.get<R<Tag[]>>('/v1/admin/tags'),

  getById: (id: number): Promise<R<Tag>> =>
    api.get<R<Tag>>(`/v1/admin/tags/${id}`),

  create: (data: CreateTagRequest): Promise<R<Tag>> =>
    api.post<R<Tag>>('/v1/admin/tags', data),

  update: (id: number, data: Partial<CreateTagRequest>): Promise<R<Tag>> =>
    api.put<R<Tag>>(`/v1/admin/tags/${id}`, data),

  delete: (id: number): Promise<R<void>> =>
    api.delete<R<void>>(`/v1/admin/tags/${id}`),
};

export default tagService;
