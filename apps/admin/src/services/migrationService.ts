import apiClient from './api';
import { useAuthStore } from '@/stores';

// --- 与 internal/service/migration_types.go 对齐的类型 ---

export type ConflictStrategy = 'skip' | 'overwrite' | 'rename';

export interface ImportOptions {
  conflictStrategy?: ConflictStrategy;
  preserveTimestamps?: boolean;
  importHidden?: boolean;
  importDrafts?: boolean;
  importDeleted?: boolean;
  preservePasswords?: boolean;
  onlyArticleIds?: number[];
}

export interface AnalysisSummary {
  totalArticles: number;
  totalDrafts: number;
  importableArticles: number;
  skippedHidden: number;
  skippedDeleted: number;
  createdCategories: number;
  reusedCategories: number;
  createdTags: number;
  reusedTags: number;
  willCreatePosts: number;
  willOverwritePosts: number;
  willSkipDuplicates: number;
  willRenameDuplicates: number;
  slugCollisions: number;
  invalidRecords: number;
}

export interface EntityPlan {
  name: string;
  action: 'create' | 'reuse';
}

export type ArticleAction =
  | 'create'
  | 'overwrite'
  | 'rename'
  | 'skip_duplicate'
  | 'skip_hidden'
  | 'skip_deleted'
  | 'skip_filtered'
  | 'invalid';

export interface ArticlePlan {
  sourceId: string;
  sourceKey: string;
  title: string;
  status: 'PUBLISHED' | 'DRAFT';
  category?: string;
  tags?: string[];
  slug: string;
  action: ArticleAction;
  reason?: string;
  existingPostId?: number;
  isPinned: boolean;
  isHidden: boolean;
  hasPassword: boolean;
  wordCount: number;
}

export interface AnalysisReport {
  summary: AnalysisSummary;
  categoryPlans: EntityPlan[];
  tagPlans: EntityPlan[];
  articlePlans: ArticlePlan[];
  warnings: string[];
  unsupported: string[];
}

// --- SSE 事件形状 ---

export type PhaseName =
  | 'start'
  | 'categories'
  | 'tags'
  | 'articles'
  | 'post_tags'
  | 'done';

export interface ProgressEvent {
  type: 'phase' | 'item' | 'summary' | 'fatal';
  phase?: PhaseName;
  total?: number;
  kind?: 'article' | 'category' | 'tag' | 'post_tag';
  sourceId?: string;
  title?: string;
  action?: string;
  postId?: number;
  error?: string;
  summary?: ExecutionSummary;
}

export interface ExecutionSummary {
  createdCategories: number;
  reusedCategories: number;
  createdTags: number;
  reusedTags: number;
  createdPosts: number;
  overwrittenPosts: number;
  skippedPosts: number;
  failedPosts: number;
  createdPostTags: number;
  durationMs: number;
  warnings: string[];
  errors: string[];
}

// --- 统一 axios 响应包裹 ---

interface ApiResponse<T> {
  code: number;
  message: string;
  data?: T;
}

export const migrationService = {
  /**
   * Dry-run / Analyze：不写 DB，返回完整计划报告。
   */
  analyze: async (file: File, options: ImportOptions = {}): Promise<AnalysisReport> => {
    const form = new FormData();
    form.append('file', file);
    form.append('options', JSON.stringify(options));
    const res = await apiClient.post<ApiResponse<AnalysisReport>>(
      '/v1/admin/migrations/vanblog/analyze',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    if (res.code !== 200 || !res.data) {
      throw new Error(res.message || '分析失败');
    }
    return res.data;
  },
};

/**
 * streamImport 打开 SSE 连接并逐事件回调。使用 fetch + ReadableStream
 * 因为 EventSource 不支持 multipart POST。
 *
 * 返回一个 Promise<void>：resolve 表示流正常结束（已 emit 过 summary/fatal）；
 * reject 表示网络或协议级错误。
 */
export async function streamImport(
  file: File,
  options: ImportOptions,
  onEvent: (ev: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  form.append('options', JSON.stringify(options));

  // 与 apiClient 的请求拦截器对齐：带上 JWT；withCredentials 覆盖 cookie 场景。
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const base = (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL || '/api';
  const res = await fetch(`${base}/v1/admin/migrations/vanblog/import/stream`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: form,
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`流式导入请求失败: HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  // 按 `\n\n` 分隔事件；单条事件可能由多行 `data: ...` 组成（SSE 协议），
  // VanBlog 导入侧每事件只有一行，但为稳健支持多行。
  const flushBuffer = () => {
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const dataLines = trimmed
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
      if (dataLines.length === 0) continue;
      const jsonStr = dataLines.join('\n');
      try {
        const ev = JSON.parse(jsonStr) as ProgressEvent;
        onEvent(ev);
      } catch {
        // JSON 解析失败多半是上游截断，忽略该事件但保留流继续消费。
        // 这里不上报也不 log —— 心跳等非 JSON 事件在上层已被 data: 前缀过滤，
        // 真正的截断场景在生产罕见，不值得为它牺牲 no-console 纯度。
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    flushBuffer();
  }
  // 收尾：最后一段无尾随空行时仍可能有数据。
  buffer += decoder.decode();
  if (buffer.length > 0) {
    buffer += '\n\n';
    flushBuffer();
  }
}
