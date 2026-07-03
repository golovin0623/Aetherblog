import { useState, useCallback, useRef } from 'react';
import { useAuthStore } from '@/stores';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

interface StreamEvent {
  type: 'delta' | 'done' | 'error' | 'result';
  content?: string;
  isThink?: boolean;
  code?: string;
  message?: string;
  data?: unknown;
}

/**
 * 结构化的流式终稿数据。各工具具体形状：
 * - 摘要：{ 摘要：字符串；字符数：数量；型号？：字符串 }
 * - 标签：{ 标签：字符串[]；型号？：字符串 }
 * - 标题：{ 标题：字符串[]；型号？：字符串 }
 * - 抛光：{抛光内容：字符串；型号？：字符串 }
 * - 大纲：{ 大纲：字符串；字符数：数量；型号？：字符串 }
 * - 翻译：{ 翻译内容：字符串；目标语言：字符串；源语言？：字符串 |无效的;型号？：字符串 }
 */
export type StreamResult = Record<string, unknown> | null;

interface UseStreamResponseReturn {
  content: string;
  thinkContent: string;
  isThinking: boolean;
  isLoading: boolean;
  isDone: boolean;
  error: string | null;
  /**
   * 结构化终稿。仅在 stream 尾部收到 `{type:"result"}` 事件时被填充。
   * 前端应优先消费此字段而非 `content`。
   */
  result: StreamResult;
  stream: (url: string, body: unknown) => Promise<void>;
  reset: () => void;
  abort: () => void;
}

/**
 * 用于处理带有思考块检测的 AI 流式响应的 Hook。
 *
 * 解析 SSE (Server-Sent Events) 流格式：按 `\n\n` 分隔事件块，每块包含
 * 一行 `data: <json>` 形式的 JSON 载荷。支持的事件类型：
 * - 数据：{“类型”：“增量”，“内容”：“...”，“isThink”：false}
 * - 数据：{“类型”：“增量”，“内容”：“...”，“isThink”：true}
 * - data: {"type": "result", "data": {...}}  ← 结构化终稿（由后端 ai.py 末尾发送）
 * - 数据：{“类型”：“完成”}
 * - 数据：{“类型”：“错误”，“代码”：“...”，“消息”：“...”}
 */
export function useStreamResponse(): UseStreamResponseReturn {
  const [content, setContent] = useState('');
  const [thinkContent, setThinkContent] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StreamResult>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamIdRef = useRef(0);

  const reset = useCallback(() => {
    setContent('');
    setThinkContent('');
    setIsThinking(false);
    setIsLoading(false);
    setIsDone(false);
    setError(null);
    setResult(null);
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

    try {
      // 安全 (VULN-085)：``url`` 可能是绝对地址（第三方）——一个由管理员
      // 配置的流式端点。将 admin Bearer / session cookie 附带到跨域主机会
      // 把凭证泄露给该主机的控制者。检测是否同源；非同源调用不带凭证。
      // 若非同源也需要鉴权，应在自己后端设置专用代理端点。
      const sameOrigin = (() => {
        try {
          return new URL(url, window.location.origin).origin === window.location.origin;
        } catch {
          // 纯相对路径在 URL() 中会抛错——仍视为同源。
          return !/^https?:\/\//i.test(url);
        }
      })();

      // 把 requestInit 构建挪到闭包里：每次发起 fetch 都重读 useAuthStore.token，
      // 保证 401 → refresh → 重试时不会复用已经失效的 Bearer 头。原先实现
      // 在 401 之前就把 headers.Authorization 钉死成旧 token，刷新后重发
      // 用同一份 headers，FastAPI 优先读 Authorization，旧 token 再次被拒，
      // 表现就是"第一次报错、第二次直接成功"——其实是同一段 stale 头被
      // 复用了两次，第二次点击因为店里 token 已被其他 axios 调用刷新才偶然
      // 走了 cookie 路径。
      const buildRequestInit = (signal: AbortSignal): RequestInit => {
        const token = useAuthStore.getState().token;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token && sameOrigin) {
          headers.Authorization = `Bearer ${token}`;
        }
        return {
          method: 'POST',
          headers,
          credentials: sameOrigin ? 'include' : 'omit',
          body: JSON.stringify(body),
          signal,
        };
      };

      const executeStreamRequest = () =>
        fetch(url, buildRequestInit(abortControllerRef.current!.signal));

      let response = await executeStreamRequest();

      if (response.status === 401 || response.status === 403) {
        const refreshResponse = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });

        if (refreshResponse.ok) {
          // 重建 requestInit：buildRequestInit 会重读 store，新签发的
          // ab_access_token cookie 也由 fetch 自动携带。
          response = await executeStreamRequest();
        }
      }

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        try {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const payload = await response.json() as {
              message?: string;
              detail?: string | { message?: string };
              errorMessage?: string;
            };
            const detail =
              typeof payload.detail === 'string'
                ? payload.detail
                : payload.detail?.message;
            errorMessage = payload.message || detail || payload.errorMessage || errorMessage;
          } else {
            const text = (await response.text()).trim();
            if (text) {
              errorMessage = text;
            }
          }
        } catch {
          // 保持默认 HTTP 错误信息
        }

        throw new Error(errorMessage);
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
              } else if (event.type === 'result') {
                // 结构化终稿：提前 flush 流式内容，并写入 result state。
                flushUpdates();
                if (streamId === streamIdRef.current) {
                  const payload = (event.data ?? null) as StreamResult;
                  setResult(payload);
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
    result,
    stream,
    reset,
    abort,
  };
}
