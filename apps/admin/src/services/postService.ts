import { apiClient } from './api';

export interface Post {
  id: string;
  title: string;
  slug: string;
  content: string;
  summary: string;
  coverImage: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  categoryId: string;
  tagIds: string[];
  viewCount: number;
  commentCount: number;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePostRequest {
  title: string;
  content: string;
  summary?: string;
  coverImage?: string;
  categoryId?: string;
  tagIds?: string[];
  status?: 'DRAFT' | 'PUBLISHED';
}

export const postService = {
  getList: (params: { page?: number; size?: number; status?: string }) =>
    apiClient.get<{ list: Post[]; pagination: unknown }>('/v1/admin/posts', { params }),

  getById: (id: string) =>
    apiClient.get<Post>(`/v1/admin/posts/${id}`),

  create: (data: CreatePostRequest) =>
    apiClient.post<Post>('/v1/admin/posts', data),

  update: (id: string, data: Partial<CreatePostRequest>) =>
    apiClient.put<Post>(`/v1/admin/posts/${id}`, data),

  delete: (id: string) =>
    apiClient.delete(`/v1/admin/posts/${id}`),

  publish: (id: string) =>
    apiClient.patch(`/v1/admin/posts/${id}/publish`),
};
