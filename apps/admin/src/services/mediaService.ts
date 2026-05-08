import api from './api';
import axios, { type AxiosError, type AxiosProgressEvent } from 'axios';
import { R, PageResult } from '@/types';

export type MediaType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';
export type StorageType = 'LOCAL' | 'S3' | 'MINIO' | 'OSS' | 'COS' | 'R2';
export type SyncStatus = 'NONE' | 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface MediaItem {
  id: number;
  filename: string;
  originalName: string;
  fileUrl: string;
  fileType: MediaType;
  fileSize: number;
  mimeType: string;
  altText?: string;
  width?: number;
  height?: number;
  createdAt: string;
  // 对象存储 rollout - Phase 1
  storageType?: StorageType;
  storageProviderId?: number;
  cdnUrl?: string;
  // 对象存储 rollout - Phase 4 (占位字段,Phase 4 才填充)
  syncStatus?: SyncStatus;
  backupProviderId?: number;
  backupUrl?: string;
  backupAt?: string;
}

export interface MediaListParams {
  fileType?: MediaType;
  keyword?: string;
  folderId?: number; // @ref Phase 1: 文件夹ID过滤
  sortBy?: 'newest' | 'oldest' | 'name' | 'size';
  pageNum?: number;
  pageSize?: number;
}

export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  imageCount: number;
  videoCount: number;
  audioCount: number;
  documentCount: number;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * 上传阶段:
 * - uploading: 字节正在上行(0-99%)
 * - processing: 已发送完最后一字节,正在等待后端入库 / 缩略图 / 同步队列响应(显示 99-100%)
 *
 * @ref 云储存优化批次 1 — 客户端阶段化进度
 */
export type UploadPhase = 'uploading' | 'processing';
export type UploadProgressFn = (percent: number, phase: UploadPhase) => void;

export interface UploadOptions {
  /** Phase 1: 文件夹 ID */
  folderId?: number;
  /** AbortController.signal —— 单文件取消 */
  signal?: AbortSignal;
  /**
   * 额外重试次数(**不含**首次,默认 2,即"首次 + 2 次重试 = 3 次总尝试")。
   * 仅对网络瞬时错误生效(无响应 / 5xx / 408 / 425 / 429)。
   *
   * @ref PR #646 fix: chatgpt-codex-connector — 与"重试次数"语义对齐
   */
  maxRetries?: number;
  /**
   * 每次重试前回调。
   * @param attempt 即将开始的尝试次数,从 2 起(2 = 第一次重试)
   * @param lastError 上一次失败的错误对象
   */
  onAttempt?: (attempt: number, lastError: unknown) => void;
}

const DEFAULT_MAX_RETRIES = 2;

/**
 * 上传被显式取消(AbortController.abort)时抛出。
 * 调用方应区别对待:不要自动重试,UI 标记为 aborted 而非 error。
 */
export class UploadAbortedError extends Error {
  constructor(public readonly cause?: unknown) {
    super('上传已取消');
    this.name = 'UploadAbortedError';
  }
}

/** 判断错误是否由 AbortController 触发 */
export function isUploadAborted(err: unknown): boolean {
  if (err instanceof UploadAbortedError) return true;
  if (axios.isCancel(err)) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code;
    if (code === 'ERR_CANCELED') return true;
  }
  return false;
}

function isRetriableError(err: unknown): boolean {
  if (isUploadAborted(err)) return false;
  // 非 axios 错误意味着 TypeError / ReferenceError / 调用方在 onProgress 回调里抛错等
  // 编程错误 —— 重试不会让它们消失,只会浪费时间和带宽。仅对 axios 错误判定。
  // @ref PR #646 fix: gemini-code-assist high — isRetriableError 不应对编程错误重试
  if (!axios.isAxiosError(err)) return false;
  const ax = err as AxiosError;
  if (!ax.response) return true; // 无响应 = 网络/DNS/超时
  const status = ax.response.status;
  if (status === 408 || status === 425 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

function backoffMs(attempt: number): number {
  const base = 250 * Math.pow(2, attempt - 1);
  const jitter = base * (Math.random() * 0.4 - 0.2);
  return Math.max(120, Math.round(base + jitter));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError(signal.reason));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UploadAbortedError(signal?.reason));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface UploadOnceConfig {
  url: string;
  formData: FormData;
  onProgress?: UploadProgressFn;
  signal?: AbortSignal;
}

async function uploadOnce<T>({ url, formData, onProgress, signal }: UploadOnceConfig): Promise<T> {
  let lastEmittedPercent = -1;
  const response = await axios.post<R<T>>(url, formData, {
    withCredentials: true,
    signal,
    onUploadProgress: (event: AxiosProgressEvent) => {
      if (!onProgress) return;
      if (!event.total || event.total === 0) {
        if (event.loaded > 0) onProgress(99, 'processing');
        return;
      }
      const ratio = Math.min(1, event.loaded / event.total);
      const percent = Math.min(99, Math.round(ratio * 100));
      const phase: UploadPhase = ratio >= 1 ? 'processing' : 'uploading';
      // 上传阶段去抖:percent 没变就不回调
      if (phase === 'uploading' && percent === lastEmittedPercent) return;
      lastEmittedPercent = percent;
      onProgress(percent, phase);
    },
  });
  // 响应到达 = 处理完成,推一次 100% processing
  onProgress?.(100, 'processing');
  return response.data.data;
}

async function uploadWithRetry<T>(config: UploadOnceConfig, options?: UploadOptions): Promise<T> {
  const maxRetries = Math.max(0, options?.maxRetries ?? DEFAULT_MAX_RETRIES);
  const maxAttempts = maxRetries + 1; // 首次 + 重试 = 总尝试次数
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await uploadOnce<T>(config);
    } catch (err) {
      lastErr = err;
      if (isUploadAborted(err)) {
        throw err instanceof UploadAbortedError ? err : new UploadAbortedError(err);
      }
      if (attempt >= maxAttempts || !isRetriableError(err)) throw err;
      const wait = backoffMs(attempt);
      options?.onAttempt?.(attempt + 1, err);
      await sleep(wait, options?.signal);
    }
  }
  throw lastErr;
}

function normalizeUploadOptions(input?: UploadOptions | number): UploadOptions {
  if (typeof input === 'number') return { folderId: input };
  return input ?? {};
}

/**
 * 获取媒体文件的完整 URL。
 *
 * Phase 1 改造:接受 string 或 MediaItem。优先返回 cdnUrl(包含完整可访问 URL)。
 * 字符串入参表示历史 fileUrl(LOCAL=/uploads/...),后端 context path 是 /api,
 * 所以 /uploads/* 需要变成 /api/uploads/*。
 */
export const getMediaUrl = (input: string | Pick<MediaItem, 'cdnUrl' | 'fileUrl' | 'storageType'>): string => {
  if (!input) return '';
  // MediaItem 对象:优先 cdnUrl,空时 fileUrl
  if (typeof input === 'object') {
    if (input.cdnUrl) return input.cdnUrl;
    return resolveLocalPath(input.fileUrl);
  }
  // 字符串路径:历史调用方
  return resolveLocalPath(input);
};

// resolveLocalPath 处理纯字符串入参的 /uploads → /api/uploads 拼接。
function resolveLocalPath(fileUrl: string): string {
  if (!fileUrl) return '';
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return fileUrl;
  }
  if (fileUrl.startsWith('/uploads')) {
    return `/api${fileUrl}`;
  }
  // 既不是绝对 URL 也不是 /uploads,可能是 storage key,直接返回让上层兜底
  return fileUrl;
}

export const mediaService = {
  /**
   * 获取媒体列表（支持筛选）
   */
  getList: (params: MediaListParams = {}): Promise<R<PageResult<MediaItem>>> => {
    const { fileType, keyword, folderId, pageNum = 1, pageSize = 24 } = params;
    return api.get<R<PageResult<MediaItem>>>('/v1/admin/media', {
      params: { fileType, keyword, folderId, pageNum, pageSize },
    });
  },

  /**
   * 获取媒体详情
   */
  getDetail: (id: number): Promise<R<MediaItem>> => {
    return api.get<R<MediaItem>>(`/v1/admin/media/${id}`);
  },

  /**
   * 上传文件。
   *
   * 兼容老签名 upload(file, percent => {}, folderIdNumber);
   * 新签名 upload(file, (percent, phase) => {}, { folderId, signal, maxRetries, onAttempt }).
   *
   * 行为:
   * - 网络瞬时错误(无响应 / 5xx / 408/425/429)自动重试 maxRetries 次,指数退避 + 抖动
   * - 4xx(非 408/425/429)与 abort 不重试
   * - signal abort 抛 UploadAbortedError(isUploadAborted 判别)
   * - onProgress 在网络上行阶段持续 0-99%,字节发完后切 'processing' 99%,响应到达 100%
   *
   * @ref 云储存优化批次 1 — 客户端 abort/retry/phase
   */
  upload: async (
    file: File,
    onProgress?: UploadProgressFn,
    optionsOrFolderId?: UploadOptions | number
  ): Promise<MediaItem> => {
    const options = normalizeUploadOptions(optionsOrFolderId);
    const formData = new FormData();
    formData.append('file', file);
    if (options.folderId !== undefined) {
      formData.append('folderId', options.folderId.toString());
    }
    return uploadWithRetry<MediaItem>(
      {
        url: `${API_BASE_URL}/v1/admin/media/upload`,
        formData,
        onProgress,
        signal: options.signal,
      },
      options
    );
  },

  /**
   * 批量上传(串行,逐个走 `upload` 自带的自动重试)。
   *
   * 行为:
   * - 单文件失败会立即 **抛出并中止整批** —— 调用方需要"逐个容错"应自己循环 `upload` 并 try-catch
   * - abort signal 会贯穿所有后续(共享同一个 `options.signal`)
   *
   * @ref PR #646 fix: gemini-code-assist medium — 注释与实现需要对齐
   */
  uploadBatch: async (
    files: File[],
    onProgress?: (fileIndex: number, percent: number, phase: UploadPhase) => void,
    options?: UploadOptions
  ): Promise<MediaItem[]> => {
    const results: MediaItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const result = await mediaService.upload(
        files[i],
        (percent, phase) => onProgress?.(i, percent, phase),
        options
      );
      results.push(result);
    }
    return results;
  },

  /**
   * 更新媒体信息
   */
  update: (
    id: number,
    data: { altText?: string; originalName?: string }
  ): Promise<R<MediaItem>> => {
    return api.put<R<MediaItem>>(`/v1/admin/media/${id}`, null, {
      params: data,
    });
  },

  /**
   * 删除媒体
   */
  delete: (id: number): Promise<R<void>> => {
    return api.delete<R<void>>(`/v1/admin/media/${id}`);
  },

  /**
   * 批量删除
   */
  batchDelete: (ids: number[]): Promise<R<void>> => {
    return api.delete<R<void>>('/v1/admin/media/batch', { data: ids });
  },

  /**
   * 获取存储统计
   */
  getStats: (): Promise<R<StorageStats>> => {
    return api.get<R<StorageStats>>('/v1/admin/media/stats');
  },

  /**
   * 移动文件到指定文件夹
   * @ref 媒体库深度优化方案 - Phase 1: 文件夹管理
   */
  moveToFolder: (fileId: number, folderId?: number): Promise<R<MediaItem>> => {
    return api.post<R<MediaItem>>(`/v1/admin/media/${fileId}/move`, null, {
      params: { folderId },
    });
  },

  /**
   * 批量移动文件到指定文件夹
   * @ref 媒体库深度优化方案 - Phase 1: 文件夹管理
   */
  batchMoveToFolder: (fileIds: number[], folderId?: number): Promise<R<void>> => {
    return api.post<R<void>>('/v1/admin/media/batch-move', { fileIds, folderId });
  },

  /**
   * 上传编辑后的图片内容(替换源文件,自动写入新版本)。
   * 与 upload 共用 retry/abort 机制。
   */
  uploadEdited: async (
    id: number,
    formData: FormData,
    onProgress?: UploadProgressFn,
    options?: UploadOptions
  ): Promise<MediaItem> => {
    return uploadWithRetry<MediaItem>(
      {
        url: `${API_BASE_URL}/v1/admin/media/${id}/content`,
        formData,
        onProgress,
        signal: options?.signal,
      },
      options
    );
  },

  // ========== 回收站相关接口 ==========

  /**
   * 获取回收站文件列表
   */
  getTrashList: (params: { pageNum?: number; pageSize?: number } = {}): Promise<R<PageResult<MediaItem>>> => {
    const { pageNum = 1, pageSize = 24 } = params;
    return api.get<R<PageResult<MediaItem>>>('/v1/admin/media/trash', {
      params: { pageNum, pageSize },
    });
  },

  /**
   * 获取回收站文件数量
   */
  getTrashCount: (): Promise<R<number>> => {
    return api.get<R<number>>('/v1/admin/media/trash/count');
  },

  /**
   * 从回收站恢复文件
   */
  restore: (id: number): Promise<R<MediaItem>> => {
    return api.post<R<MediaItem>>(`/v1/admin/media/${id}/restore`);
  },

  /**
   * 批量从回收站恢复文件
   */
  batchRestore: (ids: number[]): Promise<R<void>> => {
    return api.post<R<void>>('/v1/admin/media/trash/batch-restore', ids);
  },

  /**
   * 彻底删除文件（从回收站永久删除）。
   * Phase 3: 增加 deleteCloud 选项 — false 时只清 catalog,后端文件保留(适合"先抢救云端原件"场景)。
   */
  permanentDelete: (id: number, options?: { deleteCloud?: boolean }): Promise<R<void>> => {
    const params = options?.deleteCloud === false ? { deleteCloud: 'false' } : undefined;
    return api.delete<R<void>>(`/v1/admin/media/${id}/permanent`, { params });
  },

  /**
   * 批量彻底删除文件。
   * Phase 3: deleteCloud 同上;返回值若为 { failedIds: [...] } 表示部分文件后端删除失败但 DB 已清。
   */
  batchPermanentDelete: (ids: number[], options?: { deleteCloud?: boolean }): Promise<R<{ failedIds?: number[] } | void>> => {
    const params = options?.deleteCloud === false ? { deleteCloud: 'false' } : undefined;
    return api.delete<R<{ failedIds?: number[] } | void>>('/v1/admin/media/trash/batch-permanent', { data: ids, params });
  },

  /**
   * 清空回收站
   */
  emptyTrash: (): Promise<R<void>> => {
    return api.delete<R<void>>('/v1/admin/media/trash/empty');
  },
};

