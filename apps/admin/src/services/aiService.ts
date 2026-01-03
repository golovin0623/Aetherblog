import api from './api';
import { R } from '@/types';

export interface AiTextRequest {
  text: string;
  style?: string;
}

export interface AiTextResponse {
  result: string;
}

export const aiService = {
  cleanText: async (data: AiTextRequest): Promise<R<AiTextResponse>> => {
    return api.post<R<AiTextResponse>>('/v1/admin/ai/clean', data);
  },

  rewriteText: async (data: AiTextRequest): Promise<R<AiTextResponse>> => {
    return api.post<R<AiTextResponse>>('/v1/admin/ai/rewrite', data);
  },

  generateSummary: async (content: string): Promise<R<AiTextResponse>> => {
    return api.post<R<AiTextResponse>>('/v1/admin/ai/summary', { content });
  },

  generateTags: async (content: string): Promise<R<{ tags: string[] }>> => {
    return api.post<R<{ tags: string[] }>>('/v1/admin/ai/tags', { content });
  },
};

