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
 * Hook for consuming streaming AI responses with think block detection.
 * 
 * Parses NDJSON stream format:
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
    // Abort any in-flight stream to prevent interleaving content
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
      
      // Rendering buffer to batch React updates
      let contentBuffer = '';
      let thinkBuffer = '';
      let isThinkingLocal = false;
      let lastUpdateTime = 0;
      const UPDATE_INTERVAL = 50; // Update UI every 50ms max

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
        
        // Force flush on complete
        if (done) {
          flushUpdates();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // Parse SSE lines
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || ''; // Keep incomplete block in buffer

        let hasUpdates = false;

        for (const block of blocks) {
          if (!block.trim()) continue;
          
          // Helper to extract clean content from data: prefix
          const lines = block.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            
            const jsonStr = line.slice(6); // Remove "data: "
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
                flushUpdates(); // Flush before finishing
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
              // Skip invalid JSON lines
              console.warn('Invalid SSE data:', jsonStr);
            }
          }
        }

        // Throttled UI update
        const now = Date.now();
        if (hasUpdates && (now - lastUpdateTime > UPDATE_INTERVAL)) {
          flushUpdates();
          lastUpdateTime = now;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Aborted, don't set error
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
