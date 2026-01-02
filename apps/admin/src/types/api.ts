// API 响应类型定义
export interface R<T> {
  code: number;
  message: string;
  data: T;
  timestamp: number;
  traceId?: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  pageNum: number;
  pageSize: number;
  pages: number;
}

export interface PageQuery {
  pageNum?: number;
  pageSize?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}
