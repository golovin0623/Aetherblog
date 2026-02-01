import { API_ENDPOINTS } from './api';
import { logger } from './logger';

export interface SiteSettings {
  siteTitle: string;
  siteSubtitle: string;
  siteDescription: string;
  siteKeywords: string;
  siteUrl: string;
  authorName: string;
  author_name?: string;
  authorAvatar?: string;
  author_avatar?: string;
  authorBio?: string;
  author_bio?: string;
  icp?: string;
  startYear?: string;
  comment_enabled?: boolean;
  // Welcome Screen
  welcome_title?: string;
  welcome_subtitle?: string;
  welcome_description?: string;
  welcome_primary_btn_text?: string;
  welcome_primary_btn_link?: string;
  welcome_secondary_btn_text?: string;
  welcome_secondary_btn_link?: string;
  [key: string]: string | number | boolean | undefined;
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

export interface Comment {
  id: number;
  parentId?: number;
  nickname: string;
  avatar?: string;
  content: string;
  website?: string;
  createdAt: string;
  children?: Comment[];
}

export interface CreateCommentRequest {
  nickname: string;
  email?: string;
  website?: string;
  content: string;
  parentId?: number;
}

/**
 * 获取站点全量配置
 * Revalidation: 1 hour (3600s)
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  try {
    const res = await fetch(API_ENDPOINTS.settings, {
      next: { revalidate: 10 }
    });

    if (!res.ok) throw new Error('Failed to fetch settings');

    const json = await res.json();
    return json.data || {};
  } catch (error) {
    logger.warn('Failed to fetch site settings:', error);
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
    logger.warn('Failed to fetch recent posts:', error);
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
    logger.warn('Failed to fetch friend links:', error);
    return [];
  }
}

/**
 * 获取文章评论列表
 */
export async function getComments(postId: number): Promise<Comment[]> {
  try {
    const res = await fetch(API_ENDPOINTS.comments(postId), {
      cache: 'no-store'
    });

    if (!res.ok) throw new Error('Failed to fetch comments');

    const json = await res.json();
    return json.data?.list || [];
  } catch (error) {
    logger.warn('Failed to fetch comments:', error);
    return [];
  }
}

/**
 * 提交评论
 */
export async function createComment(postId: number, data: CreateCommentRequest): Promise<Comment> {
  const res = await fetch(API_ENDPOINTS.comments(postId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to submit comment');
  }

  const json = await res.json();
  return json.data;
}
/**
 * 获取站点统计
 * Revalidation: 10 minutes (600s)
 */
export async function getSiteStats(): Promise<any> {
  try {
    const res = await fetch(API_ENDPOINTS.stats, {
      next: { revalidate: 600 }
    });

    if (!res.ok) throw new Error('Failed to fetch stats');

    const json = await res.json();
    return json.data || {};
  } catch (error) {
    logger.warn('Failed to fetch site stats:', error);
    return {
      posts: 0,
      categories: 0,
      tags: 0
    };
  }
}
