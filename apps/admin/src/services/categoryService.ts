import api from './api';
import { R } from '@/types';

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  postCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryRequest {
  name: string;
  slug?: string;
  description?: string;
}

export const categoryService = {
  getList: (): Promise<R<Category[]>> =>
    api.get<R<Category[]>>('/v1/admin/categories'),

  getById: (id: number): Promise<R<Category>> =>
    api.get<R<Category>>(`/v1/admin/categories/${id}`),

  create: (data: CreateCategoryRequest): Promise<R<Category>> =>
    api.post<R<Category>>('/v1/admin/categories', data),

  update: (id: number, data: Partial<CreateCategoryRequest>): Promise<R<Category>> =>
    api.put<R<Category>>(`/v1/admin/categories/${id}`, data),

  delete: (id: number): Promise<R<void>> =>
    api.delete<R<void>>(`/v1/admin/categories/${id}`),
};

export default categoryService;
