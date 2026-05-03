import { useState, useCallback, useRef } from 'react';
import { useAuthStore } from '@/stores';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * 一篇文章的 reindex 进度事件（来自后端 ``profiles.py:reindex_profile_stream``）。
 */
export interface ReindexProgressEvent {
  postId: number;
  index: number;
  chunks: number;
  status: 'ok' | 'failed';
  error?: string;
  elapsedMs: number;
}

export interface ReindexResult {
  profile: string;
  indexed: number;
  failed: number;
  target_status: 'active' | 'shadow';
}

interface UseReindexStreamReturn {
  total: number;
  progress: ReindexProgressEvent[];
  result: ReindexResult | null;
  isRunning: boolean;
  error: string | null;
  /** 启动 reindex stream；返回的 Promise 在 stream 关闭后 resolve（成功 / 失败 / 中止）。*/
  start: (profileCode: string) => Promise<void>;
  /** 中止当前 stream（``AbortController.abort``）；服务端的 reindex 已起跑的批不可逆。*/
  abort: () => void;
  /** 重置内部状态（清 progress / result / error），用于关闭向导后下次再开。*/
  reset: () => void;
}

/**
 * 专用 SSE 消费 hook，配套 ``POST /v1/admin/search/profiles/{code}/reindex/stream``。
 *
 * 不复用 useStreamResponse 因为事件类型不一致：
 *   通用流：delta / result / done / error
 *   reindex 流：start / progress / result / done / error
 *
 * 事件分桶（与 ai-service ``profiles.py:_sse_pack`` 协议一致）：
 *   {type: "start", total, profile}      → 写 total
 *   {type: "progress", postId, index, chunks, status, error?, elapsedMs}
 *                                          → 累加 progress[]
 *   {type: "result", data: {...}}         → 写 result
 *   {type: "done"}                        → 关闭 isRunning
 *   {type: "error", message}              → 写 error + 关闭 isRunning
 *
 * 健壮性：单条 malformed data 行只 console.error 不终止整条流；中途网络断
 * 也只 set error，不抛。
 */
export function useReindexStream(): UseReindexStreamReturn {
  const [total, setTotal] = useState(0);
  const [progress, setProgress] = useState<ReindexProgressEvent[]>([]);
  const [result, setResult] = useState<ReindexResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setTotal(0);
    setProgress([]);
    setResult(null);
    setError(null);
    setIsRunning(false);
  }, []);

  const start = useCallback(async (profileCode: string) => {
    // 取消可能的旧 stream，避免事件交错
    abortRef.current?.abort();
    setProgress([]);
    setResult(null);
    setError(null);
    setIsRunning(true);
    setTotal(0);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const token = useAuthStore.getState().token;

    try {
      const url = `${API_BASE_URL}/v1/admin/search/profiles/${encodeURIComponent(profileCode)}/reindex/stream`;
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        credentials: 'include',
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}: ${res.statusText}`;
        try {
          const text = await res.text();
          if (text) {
            const parsed = JSON.parse(text);
            msg = parsed.message || parsed.detail || msg;
          }
        } catch {
          // 保留默认 HTTP 消息
        }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE 帧用 \n\n 分隔，行内用 \n。直接按 \n 切，留最后一行半截到下一轮。
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          // 单条 malformed 不能让整个 stream 处理跪掉。SSE 协议允许
          // keep-alive 注释行、空 data、上游缓冲拼帧等边界情况，对所有
          // JSON.parse 失败都只 console.error 然后继续读下一行。
          try {
            const data = line.slice(6); // 去掉 "data: " 前缀
            if (!data) continue;
            const obj = JSON.parse(data);
            if (obj.type === 'start') {
              setTotal(obj.total ?? 0);
            } else if (obj.type === 'progress') {
              setProgress((p) => [...p, obj as ReindexProgressEvent]);
            } else if (obj.type === 'result') {
              setResult(obj.data as ReindexResult);
            } else if (obj.type === 'done') {
              setIsRunning(false);
            } else if (obj.type === 'error') {
              setError(obj.message || 'Unknown error');
              setIsRunning(false);
            }
          } catch (e) {
            console.error('Failed to parse SSE data:', e, line);
          }
        }
      }
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      // AbortError 是用户主动中止，不当作错误处理
      if (err.name !== 'AbortError') {
        setError(err.message || 'Stream failed');
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }, []);

  return { total, progress, result, isRunning, error, start, abort, reset };
}
