/**
 * QA 文档工作流程服务 — 每个 §7 端点一个功能
 * 参考：docs/features/qa-document-workflow.md §7
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
 * 通过分段上传 QA 文档（PDF/图像）并附有进度报告。
 * 镜像 mediaService.upload 模式。
 * 参考：docs/features/qa-document-workflow.md §7 POST /v1/admin/qa-documents
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
  /** POST（多部分）——上传+入队管道*/
  upload,

  /** GET / — 带分页+过滤器的列表 */
  getList: (params?: QaDocumentListParams): Promise<R<PageResult<QaDocument>>> =>
    apiClient.get<R<PageResult<QaDocument>>>(BASE, { params }),

  /** GET /:id — 文档详细信息 + 作业 + 版本摘要 */
  getById: (id: string): Promise<R<QaDocument>> =>
    apiClient.get<R<QaDocument>>(`${BASE}/${id}`),

  /** DELETE /:id — 软删除 */
  delete: (id: string): Promise<R<void>> =>
    apiClient.delete<R<void>>(`${BASE}/${id}`),

  /** POST /:id/reprocess — 从给定阶段重新启动管道 */
  reprocess: (id: string, stage?: string): Promise<R<void>> =>
    apiClient.post<R<void>>(`${BASE}/${id}/reprocess`, stage ? { stage } : {}),

  /** GET /:id/jobs — 管道任务列表 */
  getJobs: (id: string): Promise<R<QaJob[]>> =>
    apiClient.get<R<QaJob[]>>(`${BASE}/${id}/jobs`),

  /** GET /:id/tree?version= — 规范树（当前或固定版本）*/
  getTree: (id: string, version?: number): Promise<R<CanonicalNode[]>> =>
    apiClient.get<R<CanonicalNode[]>>(`${BASE}/${id}/tree`, { params: version != null ? { version } : {} }),

  /** PATCH /:id/blocks/:blockId — 人工编辑块文本 → 创建手动版本 */
  patchBlock: (id: string, blockId: string, text: string): Promise<R<CanonicalNode>> =>
    apiClient.patch<R<CanonicalNode>>(`${BASE}/${id}/blocks/${blockId}`, { text }),

  /** GET /:id/注释 */
  getAnnotations: (id: string): Promise<R<QaAnnotation[]>> =>
    apiClient.get<R<QaAnnotation[]>>(`${BASE}/${id}/annotations`),

  /** POST /:id/注释 */
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

  /** 补丁/:id/annotations/:aid */
  updateAnnotation: (
    id: string,
    aid: string,
    data: Partial<Pick<QaAnnotation, 'status' | 'correctedText' | 'note'>>
  ): Promise<R<QaAnnotation>> =>
    apiClient.patch<R<QaAnnotation>>(`${BASE}/${id}/annotations/${aid}`, data),

  /** 删除/:id/annotations/:aid */
  deleteAnnotation: (id: string, aid: string): Promise<R<void>> =>
    apiClient.delete<R<void>>(`${BASE}/${id}/annotations/${aid}`),

  /** POST /:id/agent-fix — 触发代理修复 → AGENT_RUNNING → PATCH_PROPOSED */
  triggerAgentFix: (id: string): Promise<R<void>> =>
    apiClient.post<R<void>>(`${BASE}/${id}/agent-fix`),

  /** GET /:id/补丁 */
  getPatches: (id: string): Promise<R<QaPatch[]>> =>
    apiClient.get<R<QaPatch[]>>(`${BASE}/${id}/patches`),

  /** 获取/:id/补丁/:pid */
  getPatch: (id: string, pid: string): Promise<R<QaPatch>> =>
    apiClient.get<R<QaPatch>>(`${BASE}/${id}/patches/${pid}`),

  /** POST /:id/patches/:pid/merge — 合并补丁 → 候选版本 + Diff */
  mergePatch: (id: string, pid: string): Promise<R<QaDiff>> =>
    apiClient.post<R<QaDiff>>(`${BASE}/${id}/patches/${pid}/merge`),

  /** GET /:id/diffs — 列出所有合并差异（最新的在前），用于详细信息页面刷新 */
  getDiffs: (id: string): Promise<R<QaDiff[]>> =>
    apiClient.get<R<QaDiff[]>>(`${BASE}/${id}/diffs`),

  /** GET /:id/diffs/:did */
  getDiff: (id: string, did: string): Promise<R<QaDiff>> =>
    apiClient.get<R<QaDiff>>(`${BASE}/${id}/diffs/${did}`),

  /** POST /:id/approve — 批准候选版本 → 已批准。
   *  versionId 必须是一个数字：Go DTO 是 int64 且 Echo 的 JSON 绑定器拒绝
   *  字符串编码的 `{"versionId":"1"}` 为 400。 */
  approve: (id: string, versionId: number): Promise<R<void>> =>
    apiClient.post<R<void>>(`${BASE}/${id}/approve`, { versionId }),

  /** POST /:id/publish — 发布 → 编写 qa_questions → 发布 */
  publish: (id: string): Promise<R<void>> =>
    apiClient.post<R<void>>(`${BASE}/${id}/publish`),

  /** GET /:id/问题 */
  getQuestions: (id: string): Promise<R<QaQuestion[]>> =>
    apiClient.get<R<QaQuestion[]>>(`${BASE}/${id}/questions`),

  /** GET /:id/审核 */
  getAuditLog: (id: string): Promise<R<QaAuditLog[]>> =>
    apiClient.get<R<QaAuditLog[]>>(`${BASE}/${id}/audit`),
};
