/**
 * 分享服务
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 */

import api from './api';
import type { R } from '@/types';

export interface ShareConfig {
  accessType: 'public' | 'password';
  password?: string;
  expiresAt?: string;
  maxAccessCount?: number;
}

export interface ShareLink {
  id: number;
  shareToken: string;
  shareUrl: string;
  accessType: 'public' | 'password';
  expiresAt?: string;
  maxAccessCount?: number;
  accessCount: number;
  createdAt: string;
}

export const shareService = {
  /**
   * 创建文件分享链接
   */
  createFileShare: (fileId: number, config: ShareConfig): Promise<R<ShareLink>> => {
    return api.post<R<ShareLink>>(`/v1/admin/media/shares/file/${fileId}`, config);
  },

  /**
   * 创建文件夹分享链接
   */
  createFolderShare: (folderId: number, config: ShareConfig): Promise<R<ShareLink>> => {
    return api.post<R<ShareLink>>(`/v1/admin/media/shares/folder/${folderId}`, config);
  },

  /**
   * 获取分享链接列表
   */
  getSharesByFile: (fileId: number): Promise<R<ShareLink[]>> => {
    return api.get<R<ShareLink[]>>(`/v1/admin/media/shares/file/${fileId}`);
  },

  /**
   * 删除分享链接
   */
  deleteShare: (shareId: number): Promise<R<void>> => {
    return api.delete<R<void>>(`/v1/admin/media/shares/${shareId}`);
  },

  /**
   * 更新分享配置
   */
  updateShare: (shareId: number, config: Partial<ShareConfig>): Promise<R<ShareLink>> => {
    return api.put<R<ShareLink>>(`/v1/admin/media/shares/${shareId}`, config);
  },
};
