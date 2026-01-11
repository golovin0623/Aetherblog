import api from './api';
import { R, PageResult } from '@/types';

export enum CommentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SPAM = 'SPAM',
  DELETED = 'DELETED'
}

export interface Comment {
  id: number;
  nickname: string;
  email: string;
  website?: string;
  avatar?: string;
  content: string;
  status: CommentStatus;
  ip?: string;
  userAgent?: string;
  isAdmin: boolean;
  likeCount: number;
  createdAt: string;
  updatedAt: string;
  post?: {
    id: number;
    title: string;
    slug: string;
  };
  parent?: {
    id: number;
    nickname: string;
  };
}

class CommentService {
  async listAll(status?: CommentStatus, pageNum: number = 1, pageSize: number = 10): Promise<R<PageResult<Comment>>> {
    const params = { status, pageNum, pageSize };
    return api.get<R<PageResult<Comment>>>('/v1/admin/comments', { params });
  }

  async getById(id: number): Promise<R<Comment>> {
    return api.get<R<Comment>>(`/v1/admin/comments/${id}`);
  }

  async approve(id: number): Promise<R<Comment>> {
    return api.patch<R<Comment>>(`/v1/admin/comments/${id}/approve`);
  }

  async reject(id: number): Promise<R<Comment>> {
    return api.patch<R<Comment>>(`/v1/admin/comments/${id}/reject`);
  }

  async markAsSpam(id: number): Promise<R<Comment>> {
    return api.patch<R<Comment>>(`/v1/admin/comments/${id}/spam`);
  }

  async restore(id: number): Promise<R<Comment>> {
    return api.patch<R<Comment>>(`/v1/admin/comments/${id}/restore`);
  }

  async delete(id: number): Promise<R<void>> {
    return api.delete<R<void>>(`/v1/admin/comments/${id}`);
  }

  async permanentDelete(id: number): Promise<R<void>> {
    return api.delete<R<void>>(`/v1/admin/comments/${id}/permanent`);
  }

  async batchDelete(ids: number[]): Promise<R<void>> {
    return api.delete<R<void>>('/v1/admin/comments/batch', { data: ids });
  }

  async batchPermanentDelete(ids: number[]): Promise<R<void>> {
    return api.delete<R<void>>('/v1/admin/comments/batch/permanent', { data: ids });
  }

  async batchApprove(ids: number[]): Promise<R<void>> {
    return api.patch<R<void>>('/v1/admin/comments/batch/approve', { data: ids });
  }
}

export const commentService = new CommentService();
export default commentService;
