import api from './api';
import type { R } from '@/types';

/**
 * Search profile = (model + chunker_kind + chunk_size + overlap) 完整索引配置单元。
 *
 * 后端 API 在 ai-service ``app/api/routes/profiles.py`` 实现，
 * Go backend 通过 ``apps/server-go/internal/handler/search_handler.go::ProxyProfiles``
 * 通配代理转发（含 SSE 流式 reindex/stream 端点的逐行透传）。
 */

export type ChunkerKind = 'recursive' | 'fixed' | 'markdown' | 'qa' | 'parent_child';
export type ProfileStatus = 'active' | 'shadow' | 'deprecated';

export interface SearchProfile {
  id: number;
  code: string;
  name: string;
  description: string | null;
  modelId: string;
  chunkerKind: ChunkerKind;
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  status: ProfileStatus;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CreateProfileRequest {
  code: string;
  name: string;
  description?: string | null;
  modelId: string;
  chunkerKind: ChunkerKind;
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
}

export interface ActivateProfileResult {
  status: 'activated' | 'noop';
  code: string;
  previousActive?: string | null;
  message?: string;
}

export const searchProfileService = {
  list: (): Promise<R<SearchProfile[]>> =>
    api.get('/v1/admin/search/profiles'),

  create: (req: CreateProfileRequest): Promise<R<SearchProfile>> =>
    api.post('/v1/admin/search/profiles', req),

  activate: (code: string): Promise<R<ActivateProfileResult>> =>
    api.post(`/v1/admin/search/profiles/${encodeURIComponent(code)}/activate`),

  deprecate: (code: string): Promise<R<{ status: 'deprecated'; code: string }>> =>
    api.post(`/v1/admin/search/profiles/${encodeURIComponent(code)}/deprecate`),

  delete: (code: string): Promise<R<{ status: 'deleted'; code: string }>> =>
    api.delete(`/v1/admin/search/profiles/${encodeURIComponent(code)}`),
};
