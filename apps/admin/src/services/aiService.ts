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
    const response = await api.post<R<AiTextResponse>>('/v1/admin/ai/clean', data);
    return response.data;
  },

  rewriteText: async (data: AiTextRequest): Promise<R<AiTextResponse>> => {
    const response = await api.post<R<AiTextResponse>>('/v1/admin/ai/rewrite', data);
    return response.data;
  },

  generateSummary: async (content: string): Promise<R<AiTextResponse>> => {
    const response = await api.post<R<AiTextResponse>>('/v1/admin/ai/summary', { content });
    return response.data;
  },

  generateTags: async (content: string): Promise<R<{ tags: string[] }>> => {
    const response = await api.post<R<{ tags: string[] }>>('/v1/admin/ai/tags', { content });
    return response.data;
  },
};
