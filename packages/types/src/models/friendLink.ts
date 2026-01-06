/**
 * 友链类型
 */

export interface FriendLink {
  id: number;
  name: string;
  url: string;
  logo?: string;
  description?: string;
  /** 联系邮箱 */
  email?: string;
  /** RSS 订阅地址 */
  rssUrl?: string;
  /** 主题颜色 (默认: #6366f1) */
  themeColor?: string;
  /** 是否在线 (定期检测) */
  isOnline?: boolean;
  sortOrder: number;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFriendLinkInput {
  name: string;
  url: string;
  logo?: string;
  description?: string;
  sortOrder?: number;
}
