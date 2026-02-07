import api from './api';
import { R, PageResult } from '@/types';

export interface FriendLink {
  id: number;
  name: string;
  url: string;
  logo?: string;
  description?: string;
  email?: string;
  rssUrl?: string; // V2 feature
  themeColor?: string; // V2 feature
  isOnline?: boolean;
  lastCheckAt?: string;
  sortOrder: number;
  visible: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type CreateFriendLinkDto = Omit<FriendLink, 'id' | 'createdAt' | 'updatedAt' | 'isOnline' | 'lastCheckAt'>;
export type UpdateFriendLinkDto = Partial<CreateFriendLinkDto>;

class FriendService {
  private readonly BASE_URL = '/v1/admin/friend-links';

  /**
   * 获取所有友链
   */
  async getAll(): Promise<FriendLink[]> {
    const res = await api.get<R<FriendLink[]>>(this.BASE_URL);
    // Sort by sortOrder desc (larger number first) or asc depending on requirement
    // Usually asc for custom ordering
    return res.data?.sort((a, b) => a.sortOrder - b.sortOrder) || [];
  }

  /**
   * 分页获取
   */
  async getPage(pageNum = 1, pageSize = 10): Promise<PageResult<FriendLink>> {
    const res = await api.get<R<PageResult<FriendLink>>>(`${this.BASE_URL}/page`, {
      params: { pageNum, pageSize },
    });
    return res.data!;
  }

  /**
   * 创建友链
   */
  async create(data: CreateFriendLinkDto): Promise<FriendLink> {
    const res = await api.post<R<FriendLink>>(this.BASE_URL, data);
    return res.data!;
  }

  /**
   * 更新友链
   */
  async update(id: number, data: UpdateFriendLinkDto): Promise<FriendLink> {
    const res = await api.put<R<FriendLink>>(`${this.BASE_URL}/${id}`, data);
    return res.data!;
  }

  /**
   * 删除友链
   */
  async delete(id: number): Promise<void> {
    await api.delete(`${this.BASE_URL}/${id}`);
  }

  /**
   * 批量删除
   */
  async batchDelete(ids: number[]): Promise<void> {
    await api.delete(`${this.BASE_URL}/batch`, {
      data: ids,
    });
  }

  /**
   * 切换可见性
   */
  async toggleVisible(id: number): Promise<FriendLink> {
    const res = await api.patch<R<FriendLink>>(`${this.BASE_URL}/${id}/toggle-visible`);
    return res.data!;
  }

  /**
   * 重新排序
   * @param ids ID array in new order
   */
  async reorder(ids: number[]): Promise<void> {
    await api.patch(`${this.BASE_URL}/reorder`, ids);
  }
}

export const friendService = new FriendService();
export default friendService;
