import api from './api';
import { R } from '@/types';

/**
 * AI 服务接口
 * 对接后端 AI 功能
 */

// ==================== 请求类型 ====================

export interface SummaryRequest {
  content: string;
  maxLength?: number;
  style?: 'professional' | 'casual' | 'technical';
  model?: string;
  promptVersion?: string;
}

export interface TagsRequest {
  content: string;
  maxTags?: number;
  model?: string;
  promptVersion?: string;
}

export interface TitlesRequest {
  content: string;
  count?: number;
  style?: 'professional' | 'creative' | 'seo';
  model?: string;
  promptVersion?: string;
}

export interface PolishRequest {
  content: string;
  polishType?: 'grammar' | 'clarity' | 'style' | 'all';
  style?: 'professional' | 'casual' | 'technical';
  model?: string;
  promptVersion?: string;
}

export interface OutlineRequest {
  topic: string;
  existingContent?: string;
  depth?: number;
  style?: 'professional' | 'casual' | 'technical';
  model?: string;
  promptVersion?: string;
}

// ==================== 响应类型 ====================

export interface SummaryResponse {
  summary: string;
  model?: string;
  tokensUsed?: number;
  latencyMs?: number;
}

export interface TagsResponse {
  tags: string[];
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
  changes?: string;
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
      ...(request.style && { style: request.style }),
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
    return api.post<R<TitlesResponse>>('/v1/admin/ai/titles', request);
  },

  /**
   * 内容润色
   */
  polishContent: async (request: PolishRequest): Promise<R<PolishResponse>> => {
    return api.post<R<PolishResponse>>('/v1/admin/ai/polish', request);
  },

  /**
   * 生成文章大纲
   */
  generateOutline: async (request: OutlineRequest): Promise<R<OutlineResponse>> => {
    return api.post<R<OutlineResponse>>('/v1/admin/ai/outline', request);
  },

  /**
   * 健康检查
   */
  healthCheck: async (): Promise<R<string>> => {
    return api.get<R<string>>('/v1/admin/ai/health');
  },
};
