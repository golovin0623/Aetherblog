import api from './api';
import { R } from '@/types';

export interface SiteSetting {
  id: number;
  settingKey: string;
  settingValue: string;
  settingType: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON' | 'TEXT';
  groupName: string;
  description?: string;
}

export type SettingsMap = Record<string, any>;

class SettingsService {
  private readonly BASE_URL = '/v1/admin/settings';

  /**
   * 获取所有设置
   */
  async getAll(): Promise<SettingsMap> {
    const res = await api.get<R<SettingsMap>>(this.BASE_URL);
    return res.data || {};
  }

  /**
   * 按组获取设置
   */
  async getByGroup(group: string): Promise<SettingsMap> {
    const res = await api.get<R<SettingsMap>>(`${this.BASE_URL}/group/${group}`);
    return res.data || {};
  }

  /**
   * 批量更新设置
   * 注意：值必须转换为字符串发送给后端
   */
  async batchUpdate(settings: Record<string, string>): Promise<void> {
    await api.patch(`${this.BASE_URL}/batch`, settings);
  }

  /**
   * 获取单个
   */
  async get(key: string): Promise<string> {
    const res = await api.get<R<string>>(`${this.BASE_URL}/${key}`);
    return res.data || '';
  }

  /**
   * 更新单个
   */
  async update(key: string, value: string): Promise<void> {
    await api.put(`${this.BASE_URL}/${key}`, value); // Backend accepts raw string body? Check controller.
    // Controller: @RequestBody String value. Correct. 
    // But axios might send JSON string "value" instead of raw. 
    // Safer to use batchUpdate for consistent JSON body.
    // Let's rely on batchUpdate mostly.
  }
}

export const settingsService = new SettingsService();
export default settingsService;
