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
  AtlasHealthResponse,
  AtlasKnowledgePoint,
  AtlasKnowledgePointStatus,
  AtlasKnowledgePointType,
  AtlasProvenance,
  AtlasRelationType,
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

export const atlasService = {
  health: (): Promise<R<AtlasHealthResponse>> => api.get(`${base}/health`),

  ensureMarkdownCarrier: (noteId: number): Promise<R<AtlasCarrier>> =>
    api.post(`${base}/carriers/markdown`, { noteId }),

  getCarrier: (id: number): Promise<R<AtlasCarrier>> => api.get(`${base}/carriers/${id}`),

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
  ): Promise<R<{ nodes: AtlasKnowledgePoint[]; edges: AtlasTypedRelation[] }>> =>
    api.get(`${base}/graph`, { params: { ...(params ?? {}), ...(limit ? { limit } : {}) } }),

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
