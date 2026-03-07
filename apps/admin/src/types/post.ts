// 文章类型定义
export interface Post {
  id: number;
  title: string;
  slug: string;
  content?: string;
  summary?: string;
  coverImage?: string;
  status: PostStatus;
  category?: Category;
  tags: Tag[];
  viewCount: number;
  commentCount: number;
  likeCount?: number;
  isPinned?: boolean;
  pinPriority?: number;
  isHidden?: boolean;
  allowComment?: boolean;
  password?: string;
  passwordRequired?: boolean;
  legacyAuthorName?: string | null;
  legacyVisitedCount?: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type PostStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface PostListItem {
  id: number;
  title: string;
  slug: string;
  summary?: string;
  coverImage?: string;
  status: PostStatus;
  categoryName?: string;
  tagNames: string[];
  viewCount: number;
  commentCount: number;
  isPinned?: boolean;
  pinPriority?: number;
  isHidden?: boolean;
  publishedAt?: string;
  createdAt?: string;
}

export interface CreatePostRequest {
  title: string;
  content: string;
  summary?: string;
  coverImage?: string;
  categoryId?: number;
  tagIds?: number[];
  status?: PostStatus;
}

export interface UpdatePostPropertiesRequest {
  title?: string;
  summary?: string;
  coverImage?: string;
  categoryId?: number;
  tagIds?: number[];
  status?: PostStatus;
  isPinned?: boolean;
  pinPriority?: number;
  allowComment?: boolean;
  password?: string;
  isHidden?: boolean;
  slug?: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  viewCount?: number;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  parentId?: number;
  sortOrder: number;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  color?: string;
}
