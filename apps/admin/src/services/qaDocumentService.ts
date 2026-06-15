/**
 * QA Document Workflow service — one function per §7 endpoint
 * ref: docs/features/qa-document-workflow.md §7
 */

import axios, { type AxiosProgressEvent } from 'axios';
import { apiClient } from './api';
import { useAuthStore } from '@/stores';
import type { R, PageResult } from '@/types';
import type {
  QaDocument,
  QaDocumentListParams,
  QaJob,
  CanonicalNode,
  QaAnnotation,
  AnnotationCategory,
  QaPatch,
  QaDiff,
  QaQuestion,
  QaAuditLog,
  SplitGranularity,
} from '@/types/qaDocument';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
const BASE = '/v1/admin/qa-documents';

export type UploadProgressFn = (percent: number) => void;

/**
 * Upload a QA document (PDF / image) via multipart with progress reporting.
 * Mirrors mediaService.upload pattern.
 * ref: docs/features/qa-document-workflow.md §7 POST /v1/admin/qa-documents
 */
async function upload(
  file: File,
  options?: {
    title?: string;
    granularity?: SplitGranularity;
    onProgress?: UploadProgressFn;
    signal?: AbortSignal;
  }
): Promise<QaDocument> {
  const formData = new FormData();
  formData.append('file', file);
  if (options?.title) formData.append('title', options.title);
  if (options?.granularity) formData.append('granularity', options.granularity);

  const token = useAuthStore.getState().token;
  const response = await axios.post<R<QaDocument>>(
    `${API_BASE_URL}${BASE}`,
    formData,
    {
      withCredentials: true,
      signal: options?.signal,
      headers: {
        'Content-Type': 'multipart/form-data',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (!options?.onProgress) return;
        if (!event.total) {
          options.onProgress(99);
          return;
        }
        const pct = Math.min(99, Math.round((event.loaded / event.total) * 100));
        options.onProgress(pct);
      },
    }
  );
  options?.onProgress?.(100);
  return response.data.data;
}

export const qaDocumentService = {
  /** POST (multipart) — upload + enqueue pipeline */
  upload,

  /** GET / — list with pagination + filters */
  getList: (params?: QaDocumentListParams): Promise<R<PageResult<QaDocument>>> =>
    apiClient.get<R<PageResult<QaDocument>>>(BASE, { params }),

  /** GET /:id — document detail + jobs + version summary */
  getById: (id: string): Promise<R<QaDocument>> =>
    apiClient.get<R<QaDocument>>(`${BASE}/${id}`),

  /** DELETE /:id — soft delete */
  delete: (id: string): Promise<R<void>> =>
    apiClient.delete<R<void>>(`${BASE}/${id}`),

  /** POST /:id/reprocess — restart pipeline from given stage */
  reprocess: (id: string, stage?: string): Promise<R<void>> =>
    apiClient.post<R<void>>(`${BASE}/${id}/reprocess`, stage ? { stage } : {}),

  /** GET /:id/jobs — pipeline task list */
  getJobs: (id: string): Promise<R<QaJob[]>> =>
    apiClient.get<R<QaJob[]>>(`${BASE}/${id}/jobs`),

  /** GET /:id/tree?version= — canonical tree (current or pinned version) */
  getTree: (id: string, version?: number): Promise<R<CanonicalNode[]>> =>
    apiClient.get<R<CanonicalNode[]>>(`${BASE}/${id}/tree`, { params: version != null ? { version } : {} }),

  /** PATCH /:id/blocks/:blockId — human-edit block text → creates MANUAL version */
  patchBlock: (id: string, blockId: string, text: string): Promise<R<CanonicalNode>> =>
    apiClient.patch<R<CanonicalNode>>(`${BASE}/${id}/blocks/${blockId}`, { text }),

  /** GET /:id/annotations */
  getAnnotations: (id: string): Promise<R<QaAnnotation[]>> =>
    apiClient.get<R<QaAnnotation[]>>(`${BASE}/${id}/annotations`),

  /** POST /:id/annotations */
  createAnnotation: (
    id: string,
    data: {
      blockId: string;
      stableKey: string;
      category: AnnotationCategory;
      note?: string;
      correctedText?: string;
    }
  ): Promise<R<QaAnnotation>> =>
    apiClient.post<R<QaAnnotation>>(`${BASE}/${id}/annotations`, data),

  /** PATCH /:id/annotations/:aid */
  updateAnnotation: (
    id: string,
    aid: string,
    data: Partial<Pick<QaAnnotation, 'status' | 'correctedText' | 'note'>>
  ): Promise<R<QaAnnotation>> =>
    apiClient.patch<R<QaAnnotation>>(`${BASE}/${id}/annotations/${aid}`, data),

  /** DELETE /:id/annotations/:aid */
  deleteAnnotation: (id: string, aid: string): Promise<R<void>> =>
    apiClient.delete<R<void>>(`${BASE}/${id}/annotations/${aid}`),

  /** POST /:id/agent-fix — trigger agent repair → AGENT_RUNNING → PATCH_PROPOSED */
  triggerAgentFix: (id: string): Promise<R<void>> =>
    apiClient.post<R<void>>(`${BASE}/${id}/agent-fix`),

  /** GET /:id/patches */
  getPatches: (id: string): Promise<R<QaPatch[]>> =>
    apiClient.get<R<QaPatch[]>>(`${BASE}/${id}/patches`),

  /** GET /:id/patches/:pid */
  getPatch: (id: string, pid: string): Promise<R<QaPatch>> =>
    apiClient.get<R<QaPatch>>(`${BASE}/${id}/patches/${pid}`),

  /** POST /:id/patches/:pid/merge — merge patch → candidate version + Diff */
  mergePatch: (id: string, pid: string): Promise<R<QaDiff>> =>
    apiClient.post<R<QaDiff>>(`${BASE}/${id}/patches/${pid}/merge`),

  /** GET /:id/diffs — list all merge diffs (newest first), for detail-page refresh */
  getDiffs: (id: string): Promise<R<QaDiff[]>> =>
    apiClient.get<R<QaDiff[]>>(`${BASE}/${id}/diffs`),

  /** GET /:id/diffs/:did */
  getDiff: (id: string, did: string): Promise<R<QaDiff>> =>
    apiClient.get<R<QaDiff>>(`${BASE}/${id}/diffs/${did}`),

  /** POST /:id/approve — approve candidate version → APPROVED */
  approve: (id: string, versionId: string): Promise<R<void>> =>
    apiClient.post<R<void>>(`${BASE}/${id}/approve`, { versionId }),

  /** POST /:id/publish — publish → write qa_questions → PUBLISHED */
  publish: (id: string): Promise<R<void>> =>
    apiClient.post<R<void>>(`${BASE}/${id}/publish`),

  /** GET /:id/questions */
  getQuestions: (id: string): Promise<R<QaQuestion[]>> =>
    apiClient.get<R<QaQuestion[]>>(`${BASE}/${id}/questions`),

  /** GET /:id/audit */
  getAuditLog: (id: string): Promise<R<QaAuditLog[]>> =>
    apiClient.get<R<QaAuditLog[]>>(`${BASE}/${id}/audit`),
};
