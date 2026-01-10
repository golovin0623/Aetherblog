import { apiClient } from './api';
import { R } from '@/types';

export interface Post {
  id: number;
  title: string;
  slug: string;
  content: string;
  summary: string;
  coverImage: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  categoryId: number | null;
  categoryName: string | null;
  category?: { id: number; name: string; slug: string }; // Full category object when populated
  tags: Array<{ id: number; name: string }>;
  viewCount: number;
  commentCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  draft?: CreatePostRequest; // Cached draft content
}

export interface PostListItem {
  id: number;
  title: string;
  slug: string;
  summary: string;
  coverImage: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  categoryName: string | null;
  tagNames: string[];
  viewCount: number;
  commentCount: number;
  publishedAt: string | null;
  createdAt: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  pageNum: number;
  pageSize: number;
  pages: number;
}

export interface CreatePostRequest {
  title: string;
  content: string;
  summary?: string;
  coverImage?: string;
  categoryId?: number;
  tagIds?: number[];
  status?: 'DRAFT' | 'PUBLISHED';
}

export const postService = {
  getList: (params: { 
    pageNum?: number; 
    pageSize?: number; 
    status?: string; 
    keyword?: string;
    categoryId?: number;
    tagId?: number;
    minViewCount?: number;
    maxViewCount?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<R<PageResult<PostListItem>>> =>
    apiClient.get<R<PageResult<PostListItem>>>('/v1/admin/posts', { params }),

  getById: (id: number): Promise<R<Post>> =>
    apiClient.get<R<Post>>(`/v1/admin/posts/${id}`),

  create: (data: CreatePostRequest): Promise<R<Post>> =>
    apiClient.post<R<Post>>('/v1/admin/posts', data),

  update: (id: number, data: Partial<CreatePostRequest>): Promise<R<Post>> =>
    apiClient.put<R<Post>>(`/v1/admin/posts/${id}`, data),

  autoSave: (id: number, data: Partial<CreatePostRequest>): Promise<R<void>> =>
    apiClient.post<R<void>>(`/v1/admin/posts/${id}/auto-save`, data),

  delete: (id: number): Promise<R<void>> =>
    apiClient.delete<R<void>>(`/v1/admin/posts/${id}`),

  publish: (id: number): Promise<R<void>> =>
    apiClient.patch<R<void>>(`/v1/admin/posts/${id}/publish`),

  // Get server time for publish scheduling
  getServerTime: (): Promise<R<{ timestamp: string; timezone: string }>> =>
    apiClient.get<R<{ timestamp: string; timezone: string }>>('/v1/admin/system/time'),
};
