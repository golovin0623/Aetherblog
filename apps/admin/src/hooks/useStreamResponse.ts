import { useState, useCallback, useRef } from 'react';
import { useAuthStore } from '@/stores';

interface StreamEvent {
  type: 'delta' | 'done' | 'error';
  content?: string;
  isThink?: boolean;
  code?: string;
  message?: string;
}

interface UseStreamResponseReturn {
  content: string;
  thinkContent: string;
  isThinking: boolean;
  isLoading: boolean;
  isDone: boolean;
  error: string | null;
  stream: (url: string, body: unknown) => Promise<void>;
  reset: () => void;
  abort: () => void;
}

/**
 * 用于处理带有思考块检测的 AI 流式响应的 Hook。
 * 
 * 解析 NDJSON 流格式：
 * - {"type": "delta", "content": "...", "isThink": false}
 * - {"type": "delta", "content": "...", "isThink": true}
 * - {"type": "done"}
 * - {"type": "error", "code": "...", "message": "..."}
 */
export function useStreamResponse(): UseStreamResponseReturn {
  const [content, setContent] = useState('');
  const [thinkContent, setThinkContent] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamIdRef = useRef(0);

  const reset = useCallback(() => {
    setContent('');
    setThinkContent('');
    setIsThinking(false);
    setIsLoading(false);
    setIsDone(false);
    setError(null);
  }, []);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const stream = useCallback(async (url: string, body: unknown) => {
    // 中止任何正在进行的流，防止内容交错
    abort();
    reset();
    const streamId = ++streamIdRef.current;
    setIsLoading(true);
    
    abortControllerRef.current = new AbortController();
    const token = useAuthStore.getState().token;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify(body),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      
      // 渲染缓冲区以批量处理 React 更新
      let contentBuffer = '';
      let thinkBuffer = '';
      let isThinkingLocal = false;
      let lastUpdateTime = 0;
      const UPDATE_INTERVAL = 50; // 最多每 50 毫秒更新一次 UI

      const flushUpdates = () => {
        if (streamId !== streamIdRef.current) return;
        if (contentBuffer) {
          const contentToFlush = contentBuffer;
          setContent(prev => prev + contentToFlush);
          contentBuffer = '';
        }
        if (thinkBuffer) {
          const thinkToFlush = thinkBuffer;
          setThinkContent(prev => prev + thinkToFlush);
          thinkBuffer = '';
        }
        setIsThinking(isThinkingLocal);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (streamId !== streamIdRef.current) {
          break;
        }
        
        // 完成时强制刷新
        if (done) {
          flushUpdates();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // 解析 SSE 行
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || ''; // 将不完整的块保留在缓冲区中

        let hasUpdates = false;

        for (const block of blocks) {
          if (!block.trim()) continue;
          
          // 从 data: 前缀中提取纯内容的辅助逻辑
          const lines = block.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            
            const jsonStr = line.slice('data: '.length); // 移除 "data: "
            if (!jsonStr.trim()) continue;

            try {
              const event: StreamEvent = JSON.parse(jsonStr);
              
              if (event.type === 'delta') {
                hasUpdates = true;
                if (event.isThink) {
                  isThinkingLocal = true;
                  thinkBuffer += (event.content || '');
                } else {
                  isThinkingLocal = false;
                  contentBuffer += (event.content || '');
                }
              } else if (event.type === 'done') {
                flushUpdates(); // 完成前刷新
                if (streamId === streamIdRef.current) {
                  setIsDone(true);
                }
              } else if (event.type === 'error') {
                flushUpdates();
                if (streamId === streamIdRef.current) {
                  setError(event.message || event.code || 'Unknown error');
                }
              }
            } catch {
              // 跳过无效的 JSON 行
              console.warn('Invalid SSE data:', jsonStr);
            }
          }
        }

        // 节流 UI 更新
        const now = Date.now();
        if (hasUpdates && (now - lastUpdateTime > UPDATE_INTERVAL)) {
          flushUpdates();
          lastUpdateTime = now;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // 已中止，不设置错误
        return;
      }
      if (streamId === streamIdRef.current) {
        setError(err instanceof Error ? err.message : 'Stream failed');
      }
    } finally {
      if (streamId === streamIdRef.current) {
        setIsLoading(false);
      }
      abortControllerRef.current = null;
    }
  }, [abort, reset]);

  return {
    content,
    thinkContent,
    isThinking,
    isLoading,
    isDone,
    error,
    stream,
    reset,
    abort,
  };
}
