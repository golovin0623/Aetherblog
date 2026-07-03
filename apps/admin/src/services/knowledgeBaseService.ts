// services/knowledgeBaseService.ts —— 知识库 REST 客户端
//
// 对接后端 apps/server-go/internal/handler/{kb_handler,kb_profile_handler,kb_member_handler,kb_agent_handler}.go。
import api from './api';
import type { R } from '@/types';

// ============================================================
// 类型定义
// ============================================================

export type KbKind = 'CUSTOM' | 'SYSTEM_POSTS';
export type KbVisibility = 'PRIVATE' | 'TEAM' | 'PUBLIC';
export type KbPermissionLevel = 'VIEW' | 'USE' | 'EDIT' | 'MANAGE';
export type KbVectorStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'STALE';
export type KbProfileStatus = 'active' | 'shadow' | 'deprecated';
export type KbChunkerKind = 'recursive' | 'fixed' | 'markdown' | 'qa' | 'parent_child';
export type KbPrincipalType = 'USER' | 'TEAM' | 'ROLE';

export interface KnowledgeBaseProfile {
  id: number;
  kbId: number;
  code: string;
  name: string;
  description?: string | null;
  modelId: string;
  chunkerKind: KbChunkerKind;
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  topK: number;
  scoreThreshold: number;
  status: KbProfileStatus;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBase {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  coverImage?: string | null;
  kind: KbKind;
  ownerId?: number | null;
  ownerName?: string | null;
  visibility: KbVisibility;
  folderId?: number | null;
  activeProfileId?: number | null;
  activeProfile?: KnowledgeBaseProfile | null;
  fileCount: number;
  chunkCount: number;
  vectorizedCount: number;
  failedCount: number;
  totalTokens: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  effectivePermission: KbPermissionLevel | '';
}

export interface KnowledgeBaseFile {
  id: number;
  kbId: number;
  mediaFileId?: number | null;
  postId?: number | null;
  category?: string | null;
  title?: string | null;
  sourceUrl?: string | null;
  filename?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  fileUrl?: string | null;
  docChars?: number | null;
  docTokens?: number | null;
  chunkCount: number;
  vectorStatus: KbVectorStatus;
  vectorError?: string | null;
  vectorProfileId?: number | null;
  vectorizedAt?: string | null;
  attemptCount: number;
  archivedYear?: number | null;
  archivedMonth?: number | null;
  archivedDay?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseStats {
  fileCount: number;
  chunkCount: number;
  vectorizedCount: number;
  failedCount: number;
  pendingCount: number;
  totalTokens: number;
  timelineBuckets?: Array<{ year: number; month: number; count: number }>;
}

export interface KnowledgeBaseMember {
  id: number;
  kbId: number;
  principalType: KbPrincipalType;
  principalId: number;
  principalName?: string | null;
  permissionLevel: KbPermissionLevel;
  grantedBy?: number | null;
  grantedByName?: string | null;
  grantedAt: string;
  expiresAt?: string | null;
}

export interface CreateKnowledgeBaseRequest {
  slug?: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  visibility?: KbVisibility;
}

export interface UpdateKnowledgeBaseRequest {
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  coverImage?: string | null;
  visibility?: KbVisibility;
  activeProfileId?: number;
}

export interface CreateKbProfileRequest {
  code: string;
  name: string;
  description?: string | null;
  modelId: string;
  chunkerKind: KbChunkerKind;
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  topK?: number;
  scoreThreshold?: number;
}

export interface UpdateKbProfileRequest {
  name?: string;
  description?: string | null;
  modelId?: string;
  chunkerKind?: KbChunkerKind;
  chunkSizeTokens?: number;
  chunkOverlapTokens?: number;
  topK?: number;
  scoreThreshold?: number;
}

export interface CreateKbMemberRequest {
  principalType: KbPrincipalType;
  principalId: number;
  permissionLevel: KbPermissionLevel;
  expiresAt?: string | null;
}

export interface KbFileListResponse {
  items: KnowledgeBaseFile[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================
// 休息API
// ============================================================

const base = '/v1/admin/kbs';

export const knowledgeBaseService = {
  // ----- 列表 / CRUD -----
  list: (params?: { kind?: KbKind; q?: string }): Promise<R<KnowledgeBase[]>> =>
    api.get(base, { params }),

  get: (id: number): Promise<R<KnowledgeBase>> => api.get(`${base}/${id}`),

  create: (req: CreateKnowledgeBaseRequest): Promise<R<KnowledgeBase>> =>
    api.post(base, req),

  update: (id: number, req: UpdateKnowledgeBaseRequest): Promise<R<KnowledgeBase>> =>
    api.put(`${base}/${id}`, req),

  delete: (id: number): Promise<R<unknown>> => api.delete(`${base}/${id}`),

  stats: (id: number): Promise<R<KnowledgeBaseStats>> => api.get(`${base}/${id}/stats`),

  // ----- 文件 -----
  listFiles: (
    id: number,
    params?: {
      status?: KbVectorStatus | '';
      category?: string;
      q?: string;
      year?: number;
      month?: number;
      day?: number;
      page?: number;
      pageSize?: number;
    }
  ): Promise<R<KbFileListResponse>> => api.get(`${base}/${id}/files`, { params }),

  getFile: (id: number, fid: number): Promise<R<KnowledgeBaseFile>> =>
    api.get(`${base}/${id}/files/${fid}`),

  uploadFile: (
    id: number,
    file: File,
    options?: { category?: string; onUploadProgress?: (e: ProgressEvent) => void }
  ): Promise<R<KnowledgeBaseFile>> => {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.category) formData.append('category', options.category);
    return api.post(`${base}/${id}/files`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: options?.onUploadProgress as never,
    });
  },

  deleteFile: (id: number, fid: number): Promise<R<unknown>> =>
    api.delete(`${base}/${id}/files/${fid}`),

  reindexFile: (id: number, fid: number): Promise<R<unknown>> =>
    api.post(`${base}/${id}/files/${fid}/reindex`),

  reindexAll: (id: number): Promise<R<unknown>> => api.post(`${base}/${id}/reindex`),

  //  -  - - 轮廓  -  - -
  listProfiles: (id: number): Promise<R<KnowledgeBaseProfile[]>> =>
    api.get(`${base}/${id}/profiles`),

  createProfile: (id: number, req: CreateKbProfileRequest): Promise<R<KnowledgeBaseProfile>> =>
    api.post(`${base}/${id}/profiles`, req),

  updateProfile: (
    id: number,
    pid: number,
    req: UpdateKbProfileRequest
  ): Promise<R<KnowledgeBaseProfile>> =>
    api.put(`${base}/${id}/profiles/${pid}`, req),

  activateProfile: (id: number, pid: number): Promise<R<unknown>> =>
    api.post(`${base}/${id}/profiles/${pid}/activate`),

  /** 蓝绿迁移：用目标 profile 全库 reindex → 原子激活。同步阻塞，可能数十秒。 */
  migrateProfile: (id: number, pid: number): Promise<R<unknown>> =>
    api.post(`${base}/${id}/profiles/${pid}/migrate`),

  deleteProfile: (id: number, pid: number): Promise<R<unknown>> =>
    api.delete(`${base}/${id}/profiles/${pid}`),

  //  -  - - 成员  -  - -
  listMembers: (id: number): Promise<R<KnowledgeBaseMember[]>> =>
    api.get(`${base}/${id}/members`),

  upsertMember: (id: number, req: CreateKbMemberRequest): Promise<R<KnowledgeBaseMember>> =>
    api.post(`${base}/${id}/members`, req),

  deleteMember: (id: number, mid: number): Promise<R<unknown>> =>
    api.delete(`${base}/${id}/members/${mid}`),
};

// ============================================================
// 灵境 picker
// ============================================================

export interface AgentKnowledgeBase {
  id: number;
  slug: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  kind: KbKind;
  activeProfile?: KnowledgeBaseProfile | null;
  fileCount: number;
  chunkCount: number;
}

export const fetchAgentKnowledgeBases = (q?: string): Promise<R<AgentKnowledgeBase[]>> =>
  api.get('/v1/agent/knowledge-bases', { params: q ? { q } : {} });
