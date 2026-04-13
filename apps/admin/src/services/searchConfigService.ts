import api from './api';
import type { R } from '@/types';

export interface SearchConfig {
  keywordEnabled: boolean;
  semanticEnabled: boolean;
  aiQaEnabled: boolean;
  anonSearchRatePerMin: number;
  anonQaRatePerMin: number;
  autoIndexOnPublish: boolean;
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
};
