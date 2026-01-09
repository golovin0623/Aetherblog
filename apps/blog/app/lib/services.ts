import { API_ENDPOINTS } from './api';

export interface SiteSettings {
  siteTitle: string;
  siteSubtitle: string;
  siteDescription: string;
  siteKeywords: string;
  siteUrl: string;
  authorName: string;
  icp?: string;
  startYear?: string;
  [key: string]: string | undefined;
}

export interface Post {
  id: number;
  title: string;
  slug: string;
  summary: string;
  coverImage?: string;
  publishedAt: string;
  viewCount?: number;
  categoryName?: string;
  tagNames?: string[];
}

export interface FriendLink {
  id: number;
  name: string;
  url: string;
  logo?: string;
  description?: string;
  themeColor?: string;
}

/**
 * 获取站点全量配置
 * Revalidation: 1 hour (3600s)
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  try {
    const res = await fetch(API_ENDPOINTS.settings, {
      next: { revalidate: 3600 }
    });
    
    if (!res.ok) throw new Error('Failed to fetch settings');
    
    const json = await res.json();
    return json.data || {};
  } catch (error) {
    console.warn('Failed to fetch site settings:', error);
    return {
      siteTitle: 'AetherBlog',
      siteSubtitle: 'Sharing Technology & Life',
      siteDescription: 'A next-generation blog system powered by AI.',
      siteKeywords: 'tech, blog, ai',
      siteUrl: 'http://localhost:3000',
      authorName: 'Admin'
    };
  }
}

/**
 * 获取最新发布文章
 * @param limit 数量限制
 * Revalidation: 5 minutes (300s)
 */
export async function getRecentPosts(limit: number = 6): Promise<Post[]> {
  try {
    const res = await fetch(`${API_ENDPOINTS.posts}?pageNum=1&pageSize=${limit}`, {
      next: { revalidate: 300 }
    });

    if (!res.ok) throw new Error('Failed to fetch posts');

    const json = await res.json();
    return json.data?.list || [];
  } catch (error) {
    console.warn('Failed to fetch recent posts:', error);
    return [];
  }
}

/**
 * 获取友链列表
 * Revalidation: 1 hour (3600s)
 */
export async function getFriendLinks(): Promise<FriendLink[]> {
  try {
    const res = await fetch(API_ENDPOINTS.friendLinks, {
      next: { revalidate: 3600 }
    });

    if (!res.ok) throw new Error('Failed to fetch friend links');

    const json = await res.json();
    return json.data || [];
  } catch (error) {
    console.warn('Failed to fetch friend links:', error);
    return [];
  }
}
