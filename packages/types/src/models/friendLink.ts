/**
 * 友链类型
 */

export interface FriendLink {
  id: number;
  name: string;
  url: string;
  logo?: string;
  description?: string;
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
