/**
 * 版本服务
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 */

import api from './api';
import type { R } from '@/types';
import type { MediaVersion } from '@aetherblog/types';

export const versionService = {
  /**
   * 获取文件版本历史
   */
  getHistory: (fileId: number): Promise<R<MediaVersion[]>> => {
    return api.get<R<MediaVersion[]>>(`/v1/admin/media/files/${fileId}/versions`);
  },

  /**
   * 恢复到指定版本
   */
  restore: (fileId: number, versionNumber: number): Promise<R<void>> => {
    return api.post<R<void>>(`/v1/admin/media/files/${fileId}/versions/${versionNumber}/restore`);
  },

  /**
   * 删除版本
   */
  delete: (versionId: number): Promise<R<void>> => {
    return api.delete<R<void>>(`/v1/admin/media/versions/${versionId}`);
  },
};
