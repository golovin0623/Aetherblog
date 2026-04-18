import api from './api';
import type { R } from '@/types';

export interface SearchConfig {
  keywordEnabled: boolean;
  semanticEnabled: boolean;
  aiQaEnabled: boolean;
  anonSearchRatePerMin: number;
  anonQaRatePerMin: number;
  autoIndexOnPublish: boolean;
  /** 单篇索引超时（秒），默认 180。保存后下一次批次开始时实时生效。 */
  indexPostTimeoutSec: number;
}

export interface IndexStats {
  total_posts: number;
  indexed_posts: number;
  failed_posts: number;
  pending_posts: number;
  vector_count: number;
}

export interface EmbeddingStatus {
  configured: boolean;
  model_name?: string;
  provider?: string;
}

export interface SearchDiagnostics {
  config: SearchConfig;
  activeEmbedding: {
    modelId: string;
    source: 'site_settings' | 'unset';
  };
  aiClient: {
    configured: boolean;
  };
  fallback: {
    effectiveMode: 'hybrid' | 'keyword' | 'semantic' | 'disabled';
    keywordActive: boolean;
    semanticActive: boolean;
    note: string;
  };
}

export interface EmbeddingPostItem {
  id: number;
  title: string;
  slug: string;
  status: string;
  embeddingStatus: string;
  publishedAt?: string;
  updatedAt: string;
}

export interface EmbeddingPostListResponse {
  items: EmbeddingPostItem[];
  total: number;
}

export interface IndexBatchResult {
  // 异步启动后的响应字段
  status?: 'started';
  accepted?: number;
  message?: string;
  // 旧的同步响应字段（保留以兼容历史数据与潜在回退）
  indexed?: number;
  failed?: number;
  total?: number;
  reason?: string;
}

export const searchConfigService = {
  getConfig: (): Promise<R<SearchConfig>> =>
    api.get('/v1/admin/search/config'),

  updateConfig: (data: Record<string, string>): Promise<R<void>> =>
    api.patch('/v1/admin/search/config', data),

  getStats: (): Promise<R<IndexStats>> =>
    api.get('/v1/admin/search/stats'),

  reindex: (): Promise<R<void>> =>
    api.post('/v1/admin/search/reindex', { mode: 'full' }),

  retryFailed: (): Promise<R<void>> =>
    api.post('/v1/admin/search/retry-failed'),

  getEmbeddingStatus: (): Promise<R<EmbeddingStatus>> =>
    api.get('/v1/admin/search/embedding-status'),

  getDiagnostics: (): Promise<R<SearchDiagnostics>> =>
    api.get('/v1/admin/search/diagnostics'),

  listPosts: (params: {
    embeddingStatus?: string;
    limit?: number;
    offset?: number;
  }): Promise<R<EmbeddingPostListResponse>> => {
    const query = new URLSearchParams();
    if (params.embeddingStatus) query.set('embeddingStatus', params.embeddingStatus);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const qs = query.toString();
    return api.get(`/v1/admin/search/posts${qs ? `?${qs}` : ''}`);
  },

  indexBatch: (postIds: number[]): Promise<R<IndexBatchResult>> =>
    api.post('/v1/admin/search/index-batch', { postIds }),
};
