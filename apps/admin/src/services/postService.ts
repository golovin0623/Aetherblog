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
  category?: { id: number; name: string; slug: string };
  tags: Array<{ id: number; name: string }>;
  viewCount: number;
  commentCount: number;
  isPinned?: boolean;
  pinPriority?: number;
  isHidden?: boolean;
  passwordRequired?: boolean;
  password?: string;
  legacyAuthorName?: string | null;
  legacyVisitedCount?: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  draft?: CreatePostRequest;
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
  isPinned?: boolean;
  pinPriority?: number;
  isHidden?: boolean;
  passwordRequired?: boolean;
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

export interface UpdatePostPropertiesRequest {
  title?: string;
  summary?: string;
  coverImage?: string;
  categoryId?: number;
  tagIds?: number[];
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  isPinned?: boolean;
  pinPriority?: number;
  allowComment?: boolean;
  password?: string;
  isHidden?: boolean;
  slug?: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
  viewCount?: number;
}

export interface ImportVanBlogSummary {
  importableArticles: number;
  importableDrafts: number;
  createdCategories: number;
  reusedCategories: number;
  createdTags: number;
  reusedTags: number;
  createdPosts: number;
  updatedPosts: number;
  skippedRecords: number;
  slugConflicts: number;
  invalidRecords: number;
}

export interface ImportVanBlogItem {
  sourceKey: string;
  type: string;
  postId?: number;
  action: string;
  warnings: string[];
}

export interface ImportVanBlogResult {
  summary: ImportVanBlogSummary;
  warnings: string[];
  errors: string[];
  items: ImportVanBlogItem[];
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
    hidden?: boolean;
  }): Promise<R<PageResult<PostListItem>>> =>
    apiClient.get<R<PageResult<PostListItem>>>('/v1/admin/posts', { params }),

  getById: (id: number): Promise<R<Post>> =>
    apiClient.get<R<Post>>(`/v1/admin/posts/${id}`),

  create: (data: CreatePostRequest): Promise<R<Post>> =>
    apiClient.post<R<Post>>('/v1/admin/posts', data),

  update: (id: number, data: Partial<CreatePostRequest>): Promise<R<Post>> =>
    apiClient.put<R<Post>>(`/v1/admin/posts/${id}`, data),

  updateProperties: (id: number, data: UpdatePostPropertiesRequest): Promise<R<Post>> =>
    apiClient.patch<R<Post>>(`/v1/admin/posts/${id}/properties`, data),

  autoSave: (id: number, data: Partial<CreatePostRequest>): Promise<R<void>> =>
    apiClient.post<R<void>>(`/v1/admin/posts/${id}/auto-save`, data),

  delete: (id: number): Promise<R<void>> =>
    apiClient.delete<R<void>>(`/v1/admin/posts/${id}`),

  publish: (id: number): Promise<R<void>> =>
    apiClient.patch<R<void>>(`/v1/admin/posts/${id}/publish`),

  // 获取服务器时间，用于定时发布
  getServerTime: (): Promise<R<{ timestamp: string; timezone: string }>> =>
    apiClient.get<R<{ timestamp: string; timezone: string }>>('/v1/admin/system/time'),

  importVanBlog: async (file: File, mode: 'dry-run' | 'execute'): Promise<R<ImportVanBlogResult>> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post<R<ImportVanBlogResult>>(`/v1/admin/migrations/vanblog/import?mode=${mode}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }
};
