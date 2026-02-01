/**
 * 权限服务
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 */

import api from './api';
import type { R } from '@/types';
import type { FolderPermission, PermissionLevel } from '@aetherblog/types';

export interface GrantPermissionRequest {
  userId: number;
  permissionLevel: PermissionLevel;
  expiresAt?: string;
}

export const permissionService = {
  /**
   * 获取文件夹权限列表
   */
  getPermissions: (folderId: number): Promise<R<FolderPermission[]>> => {
    return api.get<R<FolderPermission[]>>(`/v1/admin/media/folders/${folderId}/permissions`);
  },

  /**
   * 授予权限
   */
  grant: (folderId: number, data: GrantPermissionRequest): Promise<R<FolderPermission>> => {
    return api.post<R<FolderPermission>>(`/v1/admin/media/folders/${folderId}/permissions`, data);
  },

  /**
   * 撤销权限
   */
  revoke: (permissionId: number): Promise<R<void>> => {
    return api.delete<R<void>>(`/v1/admin/media/permissions/${permissionId}`);
  },

  /**
   * 更新权限
   */
  update: (permissionId: number, data: Partial<GrantPermissionRequest>): Promise<R<FolderPermission>> => {
    return api.put<R<FolderPermission>>(`/v1/admin/media/permissions/${permissionId}`, data);
  },
};
