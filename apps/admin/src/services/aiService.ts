import api from './api';
import { R } from '@/types';

/**
 * AI 服务接口
 * 对接后端 AI 功能
 */

type LegacySummaryStyle = 'professional' | 'casual' | 'technical';
type LegacyTitleStyle = 'professional' | 'creative' | 'seo';
type LegacyPolishType = 'grammar' | 'clarity' | 'style' | 'all';
type LegacyPolishStyle = 'professional' | 'casual' | 'technical';

const LEGACY_POLISH_TONE_MAP: Record<string, string> = {
  professional: '专业',
  casual: '轻松自然',
  technical: '技术严谨',
  grammar: '严谨准确',
  clarity: '清晰易懂',
  style: '自然流畅',
  all: '专业',
};

function normalizeToneCandidate(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return LEGACY_POLISH_TONE_MAP[trimmed.toLowerCase()] || trimmed;
}

function normalizeTitlesRequest(request: TitlesRequest) {
  const { count, style: _legacyStyle, ...rest } = request;
  const maxTitles = request.maxTitles ?? count;
  return {
    ...rest,
    ...(maxTitles !== undefined ? { maxTitles } : {}),
  };
}

function normalizePolishRequest(request: PolishRequest) {
  const { polishType, style, ...rest } = request;
  const tone =
    normalizeToneCandidate(request.tone) ??
    normalizeToneCandidate(style) ??
    normalizeToneCandidate(polishType);

  return {
    ...rest,
    ...(tone ? { tone } : {}),
  };
}

// ==================== 请求类型 ====================

export interface SummaryRequest {
  content: string;
  maxLength?: number;
  promptTemplate?: string;
  style?: LegacySummaryStyle;
  model?: string;
  promptVersion?: string;
  modelId?: string;
  providerCode?: string;
  bypassCache?: boolean;
}

/**
 * 提示给 AI 的"现有标签"。后端用它生成"优先复用,再补新建"的标签建议。
 */
export interface ExistingTagHint {
  name: string;
  postCount: number;
}

export interface TagsRequest {
  content: string;
  maxTags?: number;
  promptTemplate?: string;
  model?: string;
  promptVersion?: string;
  modelId?: string;
  providerCode?: string;
  bypassCache?: boolean;
  /**
   * 可选: 现有标签库提示。提供后, AI 会优先在 matches 中复用, 仅在确实需要时
   * 才在 suggestions 中新建。建议按 postCount 降序截断到前 200 个。
   */
  existingTags?: ExistingTagHint[];
}

export interface TitlesRequest {
  content: string;
  maxTitles?: number;
  promptTemplate?: string;
  count?: number;
  style?: LegacyTitleStyle;
  model?: string;
  promptVersion?: string;
  modelId?: string;
  providerCode?: string;
  bypassCache?: boolean;
}

export interface PolishRequest {
  content: string;
  tone?: string;
  promptTemplate?: string;
  polishType?: LegacyPolishType;
  style?: LegacyPolishStyle;
  model?: string;
  promptVersion?: string;
  modelId?: string;
  providerCode?: string;
  bypassCache?: boolean;
}

export interface OutlineRequest {
  topic?: string;
  content?: string;
  existingContent?: string;
  depth?: number;
  style?: 'professional' | 'casual' | 'technical';
  promptTemplate?: string;
  model?: string;
  promptVersion?: string;
  modelId?: string;
  providerCode?: string;
  bypassCache?: boolean;
}

export interface TranslateRequest {
  content: string;
  targetLanguage: string;
  sourceLanguage?: string;
  promptTemplate?: string;
  model?: string;
  promptVersion?: string;
  modelId?: string;
  providerCode?: string;
  bypassCache?: boolean;
}

// ==================== 响应类型 ====================

export interface SummaryResponse {
  summary: string;
  model?: string;
  tokensUsed?: number;
  latencyMs?: number;
}

/**
 * AI 命中的"现有标签"。`reason` 是模型可选给出的一句话理由。
 */
export interface TagMatchResponse {
  name: string;
  postCount: number;
  reason?: string | null;
}

export interface TagsResponse {
  /**
   * 扁平字符串数组 (= matches 名字 + suggestions, 旧客户端兼容用)。
   * 新客户端请优先消费 ``matches`` / ``suggestions``。
   */
  tags: string[];
  /** 命中现有标签 (含 postCount 与可选匹配理由)。 */
  matches?: TagMatchResponse[];
  /** 现有标签库未覆盖, 需要新建的标签名。 */
  suggestions?: string[];
  model?: string;
  tokensUsed?: number;
  latencyMs?: number;
}

export interface TitlesResponse {
  titles: string[];
  model?: string;
  tokensUsed?: number;
  latencyMs?: number;
}

export interface PolishResponse {
  polishedContent: string;
  model?: string;
  tokensUsed?: number;
  latencyMs?: number;
}

export interface OutlineResponse {
  outline: string;
  model?: string;
  tokensUsed?: number;
  latencyMs?: number;
}

export interface TranslateResponse {
  translatedContent: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  model?: string;
  tokensUsed?: number;
  latencyMs?: number;
}

// ==================== 流式事件类型 ====================

export interface StreamEvent {
  event: 'delta' | 'done' | 'error';
  requestId?: string;
}

export interface StreamDelta extends StreamEvent {
  event: 'delta';
  data: {
    text: string;
  };
}

export interface StreamError extends StreamEvent {
  event: 'error';
  data: {
    message: string;
  };
}

// ==================== AI 服务 ====================

export const aiService = {
  /**
   * 生成文章摘要（非流式）
   */
  generateSummary: async (request: SummaryRequest): Promise<R<SummaryResponse>> => {
    return api.post<R<SummaryResponse>>('/v1/admin/ai/summary', request);
  },

  /**
   * 生成文章摘要（流式）
   * @returns EventSource URL
   */
  generateSummaryStream: (request: SummaryRequest): string => {
    const baseUrl = import.meta.env.VITE_API_URL || '/api';
    const params = new URLSearchParams({
      content: request.content,
      ...(request.maxLength && { maxLength: request.maxLength.toString() }),
    });
    // 注意：流式接口需要使用 EventSource 或 fetch，这里返回 URL
    return `${baseUrl}/v1/admin/ai/summary/stream?${params}`;
  },

  /**
   * 提取文章标签
   */
  extractTags: async (request: TagsRequest): Promise<R<TagsResponse>> => {
    return api.post<R<TagsResponse>>('/v1/admin/ai/tags', request);
  },

  /**
   * 生成标题建议
   */
  suggestTitles: async (request: TitlesRequest): Promise<R<TitlesResponse>> => {
    return api.post<R<TitlesResponse>>('/v1/admin/ai/titles', normalizeTitlesRequest(request));
  },

  /**
   * 内容润色
   */
  polishContent: async (request: PolishRequest): Promise<R<PolishResponse>> => {
    return api.post<R<PolishResponse>>('/v1/admin/ai/polish', normalizePolishRequest(request));
  },

  /**
   * 生成文章大纲
   */
  generateOutline: async (request: OutlineRequest): Promise<R<OutlineResponse>> => {
    return api.post<R<OutlineResponse>>('/v1/admin/ai/outline', request);
  },

  /**
   * 翻译内容
   */
  translateContent: async (request: TranslateRequest): Promise<R<TranslateResponse>> => {
    return api.post<R<TranslateResponse>>('/v1/admin/ai/translate', request);
  },

  /**
   * 健康检查
   */
  healthCheck: async (): Promise<R<string>> => {
    return api.get<R<string>>('/v1/admin/ai/health');
  },
};
