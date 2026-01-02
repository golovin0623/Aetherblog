/**
 * AI 补全类型
 */

export interface CompletionRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stream?: boolean;
}

export interface CompletionResponse {
  id: string;
  content: string;
  finishReason: 'stop' | 'length' | 'error';
  usage: TokenUsage;
}

export interface StreamingChunk {
  id: string;
  delta: string;
  finishReason?: 'stop' | 'length' | 'error';
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
