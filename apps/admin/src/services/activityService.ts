import api from './api';
import { R, PageResult } from '@/types';

/**
 * 活动事件类型
 * @ref §8.2 - 仪表盘最近动态
 */
export interface ActivityEvent {
  id: number;
  eventType: string;
  eventCategory: 'post' | 'comment' | 'user' | 'system' | 'friend' | 'media' | 'ai';
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  user?: {
    id: number;
    username: string;
    nickname?: string;
    avatar?: string;
  };
  ip?: string;
  status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  createdAt: string;
}

/**
 * 活动事件查询参数
 */
export interface ActivityQueryParams {
  category?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  pageNum?: number;
  pageSize?: number;
}

/**
 * 活动事件服务
 */
class ActivityService {
  /**
   * 获取最近活动事件
   * @param limit 数量限制，默认10条
   */
  async getRecentActivities(limit: number = 10): Promise<R<ActivityEvent[]>> {
    return api.get<R<ActivityEvent[]>>(`/v1/admin/activities/recent?limit=${limit}`);
  }

  /**
   * 分页获取活动事件列表
   */
  async getActivities(params: ActivityQueryParams = {}): Promise<R<PageResult<ActivityEvent>>> {
    const searchParams = new URLSearchParams();
    if (params.category) searchParams.append('category', params.category);
    if (params.status) searchParams.append('status', params.status);
    if (params.startTime) searchParams.append('startTime', params.startTime);
    if (params.endTime) searchParams.append('endTime', params.endTime);
    if (params.pageNum) searchParams.append('pageNum', String(params.pageNum));
    if (params.pageSize) searchParams.append('pageSize', String(params.pageSize));
    
    const query = searchParams.toString();
    return api.get<R<PageResult<ActivityEvent>>>(`/v1/admin/activities${query ? `?${query}` : ''}`);
  }

  /**
   * 获取指定用户的活动事件
   */
  async getActivitiesByUser(
    userId: number,
    pageNum: number = 1,
    pageSize: number = 20
  ): Promise<R<PageResult<ActivityEvent>>> {
    return api.get<R<PageResult<ActivityEvent>>>(
      `/v1/admin/activities/user/${userId}?pageNum=${pageNum}&pageSize=${pageSize}`
    );
  }
}

export const activityService = new ActivityService();
export default activityService;
