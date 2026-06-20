import { apiClient } from './api';
import { R, PageResult } from '@/types';

/** 拟真阅读来源类型 */
export type ReadingSourceType = 'POST' | 'NOTE' | 'KB_FILE';
/** 拟真阅读处理状态 */
export type ReadingBookStatus = 'PENDING' | 'READY' | 'FAILED';

export interface ReadingBookListItem {
  id: number;
  slug: string;
  title: string;
  author?: string | null;
  coverImage?: string | null;
  sourceType: ReadingSourceType;
  sourceId: number;
  sourceRef?: string | null;
  wordCount: number;
  readingTime: number;
  status: ReadingBookStatus;
  error?: string | null;
  theme: string;
  generatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReadingBookTocItem {
  id: string;
  text: string;
  level: number;
}

export interface ReadingBookDetail extends ReadingBookListItem {
  contentHtml: string;
  toc: ReadingBookTocItem[];
}

export interface GenerateReadingBookRequest {
  sourceType: ReadingSourceType;
  sourceId: number;
  theme?: 'paper' | 'sepia' | 'night';
}

export interface ReadingBookListParams {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  sourceType?: ReadingSourceType | '';
  status?: ReadingBookStatus | '';
}

const base = '/v1/admin/reading-books';

export const readingBookService = {
  /** 后台书架分页 */
  getList: (params?: ReadingBookListParams): Promise<R<PageResult<ReadingBookListItem>>> =>
    apiClient.get<R<PageResult<ReadingBookListItem>>>(base, { params }),

  /** 导入来源并生成（或重新生成）成书缓存 */
  generate: (data: GenerateReadingBookRequest): Promise<R<ReadingBookDetail>> =>
    apiClient.post<R<ReadingBookDetail>>(`${base}/generate`, data),

  /** 详情（含正文） */
  getById: (id: number): Promise<R<ReadingBookDetail>> =>
    apiClient.get<R<ReadingBookDetail>>(`${base}/${id}`),

  /** 删除 */
  delete: (id: number): Promise<R<void>> =>
    apiClient.delete<R<void>>(`${base}/${id}`),
};
