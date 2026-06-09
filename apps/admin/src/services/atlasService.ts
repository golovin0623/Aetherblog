// Atlas (Aether Knowledge) admin REST 客户端
//
// 落地手册：docs/plan/task-aether-knowledge-system.md §3
// 后端实现见 apps/server-go/internal/knowledge/handler。

import api from './api';
import type { R } from '@/types';
import type {
  AtlasAnnotation,
  AtlasAnchorState,
  AtlasCarrier,
  AtlasCarrierTextLayer,
  AtlasGraphImportResponse,
  AtlasGraphResponse,
  AtlasGraphHealth,
  AtlasHealthResponse,
  AtlasKnowledgePoint,
  AtlasKnowledgePointStatus,
  AtlasKnowledgePointType,
  AtlasProvenance,
  AtlasRelationType,
  AtlasSearchResponse,
  AtlasSelector,
  AtlasAnnotationBodyType,
  AtlasTypedRelation,
} from '@aetherblog/types';

const base = '/v1/admin/atlas';

export type AtlasScopeParam = 'all' | 'mine';

export interface AtlasScopedParams {
  scope?: AtlasScopeParam;
  authorId?: number;
}

export const ATLAS_CARRIER_SUGGESTION_MAX_COST_USD = 0.05;

export interface GenerateCarrierSuggestionsPayload {
  maxCandidates?: number;
  maxChars?: number;
  modelId?: string | null;
  maxCostUsd?: number;
}

export interface AtlasCarrierSuggestionCostPreview {
  carrierId: number;
  modelId: string;
  maxCandidates: number;
  maxChars: number;
  sourceChars: number;
  truncatedChars: number;
  estimatedTokensIn: number;
  estimatedTokensOut: number;
  estimatedCostUsd?: number | null;
  maxCostUsd?: number | null;
  budgetExceeded: boolean;
  pricingMissing: boolean;
}

export interface CreateAnnotationPayload {
  carrierId: number;
  carrierVersionId?: number | null;
  selectors: AtlasSelector[];
  relPosition?: string | null;
  bodyType: AtlasAnnotationBodyType;
  bodyText?: string | null;
  bodyMeta?: Record<string, unknown>;
  anchorState?: AtlasAnchorState;
  anchorScore?: number;
}

export interface UpdateAnnotationPayload {
  bodyText?: string | null;
  bodyMeta?: Record<string, unknown>;
  anchorState?: AtlasAnchorState;
  anchorScore?: number;
}

export interface AtlasMarkdownSource {
  id: number;
  title: string;
  contentMarkdown: string;
}

export interface AtlasFetchedWebClip {
  sourceUrl: string;
  title: string;
  contentMarkdown: string;
  author?: string | null;
  language?: string | null;
}

export type AtlasGraphExportFormat = 'json' | 'graphml' | 'markdown';
export type AtlasGraphImportFormat = 'obsidian-markdown' | 'readwise-csv' | 'zotero-ris';

export const atlasService = {
  health: (): Promise<R<AtlasHealthResponse>> => api.get(`${base}/health`),

  recordEvent: (payload: {
    eventType: 'atlas.search' | 'atlas.graph_search' | 'atlas.aetherhub_atlas_answer' | 'atlas.aetherhub_answer_citation';
    title?: string;
    description?: string;
    status?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  }): Promise<R<void>> => api.post(`${base}/events`, payload),

  ensureMarkdownCarrier: (noteId: number): Promise<R<AtlasCarrier>> =>
    api.post(`${base}/carriers/markdown`, { noteId }),

  getMarkdownCarrier: (noteId: number): Promise<R<AtlasCarrier>> =>
    api.get(`${base}/carriers/markdown/${noteId}`),

  createMarkdownSource: (payload: { title?: string; contentMarkdown: string }): Promise<R<AtlasMarkdownSource>> =>
    api.post(`${base}/carriers/markdown/source`, payload),

  getMarkdownSource: (noteId: number): Promise<R<AtlasMarkdownSource>> =>
    api.get(`${base}/carriers/markdown/${noteId}/source`),

  ensurePDFCarrier: (mediaFileId: number): Promise<R<AtlasCarrier>> =>
    api.post(`${base}/carriers/pdf`, { mediaFileId }),

  ensurePostCarrier: (postId: number): Promise<R<AtlasCarrier>> =>
    api.post(`${base}/carriers/post`, { postId }),

  getPostCarrier: (postId: number): Promise<R<AtlasCarrier>> =>
    api.get(`${base}/carriers/post/${postId}`),

  getMediaCarrier: (mediaFileId: number): Promise<R<AtlasCarrier>> =>
    api.get(`${base}/carriers/media/${mediaFileId}`),

  ensureWebCarrier: (payload: {
    sourceUrl: string;
    title?: string;
    contentMarkdown: string;
    author?: string | null;
    language?: string | null;
  }): Promise<R<AtlasCarrier>> =>
    api.post(`${base}/carriers/web`, payload),

  fetchWebClip: (payload: { sourceUrl: string }): Promise<R<AtlasFetchedWebClip>> =>
    api.post(`${base}/carriers/web/fetch`, payload),

  ensureMediaTranscriptCarrier: (payload: {
    mediaFileId: number;
    transcriptMarkdown: string;
    language?: string | null;
  }): Promise<R<AtlasCarrier>> =>
    api.post(`${base}/carriers/media-transcript`, payload),

  ensureImageCarrier: (payload: {
    mediaFileId: number;
    descriptionMarkdown: string;
    language?: string | null;
  }): Promise<R<AtlasCarrier>> =>
    api.post(`${base}/carriers/image`, payload),

  getCarrier: (id: number): Promise<R<AtlasCarrier>> => api.get(`${base}/carriers/${id}`),

  // 列出当前可见范围内最近的载体（读物列表）。支撑 Atlas「读物」入口，
  // 在此之前前端没有任何列出已有 Carrier 的方式。
  listCarriers: (
    params?: {
      type?: AtlasCarrier['type'];
      limit?: number;
    } & AtlasScopedParams
  ): Promise<R<AtlasCarrier[]>> => api.get(`${base}/carriers`, { params }),

  getCarrierTextLayer: (carrierId: number): Promise<R<AtlasCarrierTextLayer>> =>
    api.get(`${base}/carriers/${carrierId}/text-layer`),

  listAnnotations: (carrierId: number): Promise<R<AtlasAnnotation[]>> =>
    api.get(`${base}/carriers/${carrierId}/annotations`),

  createAnnotation: (payload: CreateAnnotationPayload): Promise<R<AtlasAnnotation>> =>
    api.post(`${base}/annotations`, payload),

  getAnnotation: (id: number): Promise<R<AtlasAnnotation>> =>
    api.get(`${base}/annotations/${id}`),

  updateAnnotation: (id: number, payload: UpdateAnnotationPayload): Promise<R<AtlasAnnotation>> =>
    api.patch(`${base}/annotations/${id}`, payload),

  deleteAnnotation: (id: number): Promise<R<void>> => api.delete(`${base}/annotations/${id}`),

  // ---------- Knowledge Points (Phase 2) ----------
  listKnowledgePoints: (params?: {
    type?: AtlasKnowledgePointType;
    status?: AtlasKnowledgePointStatus;
    provenance?: AtlasProvenance;
    evidence?: 'with' | 'without';
    keyword?: string;
    limit?: number;
  } & AtlasScopedParams): Promise<R<AtlasKnowledgePoint[]>> => api.get(`${base}/knowledge-points`, { params }),

  getKnowledgePoint: (id: number): Promise<R<AtlasKnowledgePoint>> =>
    api.get(`${base}/knowledge-points/${id}`),

  createKnowledgePoint: (payload: {
    title: string;
    bodyMarkdown?: string;
    type?: AtlasKnowledgePointType;
    confidence?: number;
    status?: AtlasKnowledgePointStatus;
    provenance?: AtlasProvenance;
    evidenceAnnotationIds?: number[];
  }): Promise<R<AtlasKnowledgePoint>> => api.post(`${base}/knowledge-points`, payload),

  updateKnowledgePoint: (
    id: number,
    payload: {
      title?: string;
      bodyMarkdown?: string;
      type?: AtlasKnowledgePointType;
      status?: AtlasKnowledgePointStatus;
      confidence?: number;
      archived?: boolean;
    }
  ): Promise<R<AtlasKnowledgePoint>> => api.patch(`${base}/knowledge-points/${id}`, payload),

  deleteKnowledgePoint: (id: number): Promise<R<void>> =>
    api.delete(`${base}/knowledge-points/${id}`),

  linkAnnotationToKP: (
    kpId: number,
    annotationId: number,
    role?: string
  ): Promise<R<void>> =>
    api.post(`${base}/knowledge-points/${kpId}/annotations`, { annotationId, role }),

  listEvidence: (kpId: number): Promise<R<Array<{ annotationId: number; kpId: number; role: string }>>> =>
    api.get(`${base}/knowledge-points/${kpId}/evidence`),

  listKPsForAnnotation: (annotationId: number): Promise<R<number[]>> =>
    api.get(`${base}/annotations/${annotationId}/knowledge-points`),

  listKPRelations: (
    kpId: number,
    dir: 'in' | 'out' | 'all' = 'all'
  ): Promise<R<AtlasTypedRelation[]>> =>
    api.get(`${base}/knowledge-points/${kpId}/relations`, { params: { dir } }),

  // ---------- Typed Relations ----------
  createRelation: (payload: {
    fromKpId: number;
    toKpId: number;
    type: AtlasRelationType;
    strength?: number;
    bodyMarkdown?: string;
    provenance?: AtlasProvenance;
    evidenceAnnotationIds?: number[];
  }): Promise<R<AtlasTypedRelation>> => api.post(`${base}/relations`, payload),

  linkRelationEvidence: (relationId: number, annotationId: number): Promise<R<void>> =>
    api.post(`${base}/relations/${relationId}/evidence`, { annotationId }),

  listRelationEvidence: (relationId: number): Promise<R<Array<{ relationId: number; annotationId: number; createdAt: string }>>> =>
    api.get(`${base}/relations/${relationId}/evidence`),

  deleteRelationEvidence: (relationId: number, annotationId: number): Promise<R<void>> =>
    api.delete(`${base}/relations/${relationId}/evidence/${annotationId}`),

  deleteRelation: (id: number): Promise<R<void>> => api.delete(`${base}/relations/${id}`),

  // ---------- Graph ----------
  getGraph: (
    limit?: number,
    params?: AtlasScopedParams
  ): Promise<R<AtlasGraphResponse>> =>
    api.get(`${base}/graph`, { params: { ...(params ?? {}), ...(limit ? { limit } : {}) } }),

  exportGraph: (
    format: AtlasGraphExportFormat,
    params?: AtlasScopedParams & { limit?: number }
  ): Promise<Blob> =>
    api.get(`${base}/export`, {
      params: { ...(params ?? {}), format },
      responseType: 'blob',
    }),

  importGraph: (payload: {
    format?: AtlasGraphImportFormat;
    content: string;
    sourceTitle?: string;
    defaultType?: AtlasKnowledgePointType;
    dryRun?: boolean;
  }): Promise<R<AtlasGraphImportResponse>> =>
    api.post(`${base}/import`, payload),

  getGraphHealth: (params?: AtlasScopedParams & { hubLimit?: number }): Promise<R<AtlasGraphHealth>> =>
    api.get(`${base}/graph/health`, { params }),

  search: (params: {
    q: string;
    limit?: number;
    semantic?: boolean;
  } & AtlasScopedParams): Promise<R<AtlasSearchResponse>> =>
    api.get(`${base}/search`, { params }),

  // ---------- AI Suggestions (Phase 3) ----------
  listSuggestions: (params?: {
    kind?: 'kp' | 'relation';
    status?: 'pending' | 'accepted' | 'rejected' | 'ignored' | 'expired';
    carrierId?: number;
    limit?: number;
  } & AtlasScopedParams): Promise<R<AtlasSuggestion[]>> => api.get(`${base}/suggestions`, { params }),

  getSuggestion: (id: number): Promise<R<AtlasSuggestion>> =>
    api.get(`${base}/suggestions/${id}`),

  createSuggestion: (payload: {
    kind: 'kp' | 'relation';
    carrierId?: number;
    annotationId?: number;
    fromKpId?: number;
    toKpId?: number;
    proposedTitle?: string;
    proposedBody?: string;
    proposedKpType?: AtlasKnowledgePointType;
    proposedRelationType?: AtlasRelationType;
    proposedStrength?: number;
    proposedConfidence?: number;
    rationale?: string;
    modelId?: string;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
  }): Promise<R<AtlasSuggestion>> => api.post(`${base}/suggestions`, payload),

  generateAnnotationSuggestions: (
    annotationId: number,
    payload?: { maxCandidates?: number; modelId?: string | null }
  ): Promise<R<AtlasSuggestion[]>> =>
    api.post(`${base}/annotations/${annotationId}/suggestions`, payload ?? {}),

  previewCarrierSuggestions: (
    carrierId: number,
    payload?: GenerateCarrierSuggestionsPayload
  ): Promise<R<AtlasCarrierSuggestionCostPreview>> =>
    api.post(`${base}/carriers/${carrierId}/suggestions/preview`, payload ?? {}),

  generateCarrierSuggestions: (
    carrierId: number,
    payload?: GenerateCarrierSuggestionsPayload
  ): Promise<R<AtlasSuggestion[]>> =>
    api.post(`${base}/carriers/${carrierId}/suggestions`, payload ?? {}),

  generateRelationSuggestion: (
    kpId: number,
    payload: { toKpId: number; modelId?: string | null }
  ): Promise<R<AtlasSuggestion>> =>
    api.post(`${base}/knowledge-points/${kpId}/relation-suggestions`, payload),

  acceptSuggestion: (id: number): Promise<R<AtlasSuggestion>> =>
    api.post(`${base}/suggestions/${id}/accept`),

  rejectSuggestion: (id: number): Promise<R<AtlasSuggestion>> =>
    api.post(`${base}/suggestions/${id}/reject`),
};

// 共享类型（不在 @aetherblog/types 中，仅 atlas 内部使用）
export interface AtlasSuggestion {
  id: number;
  kind: 'kp' | 'relation';
  carrierId?: number | null;
  annotationId?: number | null;
  fromKpId?: number | null;
  toKpId?: number | null;
  proposedTitle?: string | null;
  proposedBody?: string | null;
  proposedKpType?: AtlasKnowledgePointType | null;
  proposedRelationType?: AtlasRelationType | null;
  proposedStrength?: number | null;
  proposedConfidence?: number | null;
  rationale?: string | null;
  modelId?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
  fingerprint?: string | null;
  authorId?: number | null;
  status: 'pending' | 'accepted' | 'rejected' | 'ignored' | 'expired';
  resolvedKpId?: number | null;
  resolvedRelationId?: number | null;
  createdAt: string;
  updatedAt: string;
}

// 不让 lucide / unused 警告影响（重新导出，仅供 admin/atlas/* 复用）。
export type {
  AtlasAnchorState,
  AtlasAnnotationBodyType,
  AtlasSelector,
};
