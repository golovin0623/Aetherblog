/**
 * API 响应类型
 */

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
  timestamp: number;
  traceId?: string;
}

export interface PageInfo {
  page: number;
  size: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface PagedResponse<T> extends ApiResponse<T[]> {
  page: PageInfo;
}
