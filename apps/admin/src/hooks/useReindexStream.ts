import { useState, useCallback, useRef } from 'react';
import { useAuthStore } from '@/stores';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
/**
 * 进度面板只展示最近 5 条事件，所以保留全量事件流是浪费 —— [...p, obj]
 * 累加是 O(N²)，3000 篇文章 reindex 时会让浏览器持续跑 GC。这里用一个
 * 固定大小的 ring buffer 替代完整数组，counters 单独累加。下游的
 * "最近 5 条"列表直接读 ``recent`` 即可。
 */
const RECENT_BUFFER_SIZE = 16;

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

/** 聚合后的进度统计，UI 直接渲染这一组数字而非遍历完整事件列表。 */
export interface ReindexCounters {
  /** 已处理总数（ok + failed）。 */
  done: number;
  /** 累计成功篇数。 */
  ok: number;
  /** 累计失败篇数。 */
  failed: number;
  /** 成功篇的总耗时（ms），用于推导平均耗时。 */
  totalElapsedMs: number;
}

const EMPTY_COUNTERS: ReindexCounters = {
  done: 0,
  ok: 0,
  failed: 0,
  totalElapsedMs: 0,
};

export interface ReindexResult {
  profile: string;
  indexed: number;
  failed: number;
  target_status: 'active' | 'shadow';
}

export interface ReindexHeartbeat {
  profile?: string;
  indexed: number;
  failed: number;
  total: number;
  inFlight?: number;
  receivedAt: number;
}

export interface ReindexChunkProgressEvent {
  postId: number;
  profile?: string;
  chunkIndex?: number;
  doneChunks: number;
  totalChunks: number;
  status: 'resumed' | 'ok';
  elapsedMs?: number;
  receivedAt: number;
}

interface UseReindexStreamReturn {
  total: number;
  /**
   * 聚合统计 —— 已处理 / 成功 / 失败 / 平均耗时来源，所有 progress 事件
   * 累加得到，无 list 拷贝。
   */
  counters: ReindexCounters;
  /** 最近 N 条事件（环形缓冲，按时间倒序提供）。 */
  recent: ReindexProgressEvent[];
  heartbeat: ReindexHeartbeat | null;
  chunkProgress: ReindexChunkProgressEvent | null;
  result: ReindexResult | null;
  isRunning: boolean;
  error: string | null;
  /** 启动 reindex stream；返回的 Promise 在 stream 关闭后 resolve（成功 / 失败 / 中止）。*/
  start: (profileCode: string) => Promise<void>;
  /** 中止当前 stream（``AbortController.abort``）；服务端的 reindex 已起跑的批不可逆。*/
  abort: () => void;
  /** 重置内部状态（清 counters / recent / result / error），用于关闭向导后下次再开。*/
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
 *                                          → 累加 counters + 推入 recent ring buffer
 *   {type: "result", data: {...}}         → 写 result
 *   {type: "done"}                        → 关闭 isRunning
 *   {type: "error", message}              → 写 error + 关闭 isRunning
 *
 * 性能：counters 是 4 个数字累加 O(1)；recent 是 16 槽环形缓冲 O(1)。
 * 即使 reindex 数万篇也不会让 React 重渲染节奏堆积。
 *
 * 健壮性：单条 malformed data 行只 console.error 不终止整条流；中途网络断
 * 也只 set error，不抛。
 */
export function useReindexStream(): UseReindexStreamReturn {
  const [total, setTotal] = useState(0);
  const [counters, setCounters] = useState<ReindexCounters>(EMPTY_COUNTERS);
  const [recent, setRecent] = useState<ReindexProgressEvent[]>([]);
  const [heartbeat, setHeartbeat] = useState<ReindexHeartbeat | null>(null);
  const [chunkProgress, setChunkProgress] = useState<ReindexChunkProgressEvent | null>(null);
  const [result, setResult] = useState<ReindexResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setTotal(0);
    setCounters(EMPTY_COUNTERS);
    setRecent([]);
    setHeartbeat(null);
    setChunkProgress(null);
    setResult(null);
    setError(null);
    setIsRunning(false);
  }, []);

  const start = useCallback(async (profileCode: string) => {
    // 取消可能的旧 stream，避免事件交错
    abortRef.current?.abort();
    setCounters(EMPTY_COUNTERS);
    setRecent([]);
    setHeartbeat(null);
    setChunkProgress(null);
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
            } else if (obj.type === 'heartbeat') {
              setHeartbeat({
                profile: obj.profile,
                indexed: obj.indexed ?? 0,
                failed: obj.failed ?? 0,
                total: obj.total ?? 0,
                inFlight: obj.inFlight,
                receivedAt: Date.now(),
              });
            } else if (obj.type === 'chunk_progress') {
              setChunkProgress({
                postId: obj.postId,
                profile: obj.profile,
                chunkIndex: obj.chunkIndex,
                doneChunks: obj.doneChunks ?? 0,
                totalChunks: obj.totalChunks ?? 0,
                status: obj.status ?? 'ok',
                elapsedMs: obj.elapsedMs,
                receivedAt: Date.now(),
              });
            } else if (obj.type === 'progress') {
              const evt = obj as ReindexProgressEvent;
              // counters: O(1) 累加
              setCounters((c) => ({
                done: c.done + 1,
                ok: c.ok + (evt.status === 'ok' ? 1 : 0),
                failed: c.failed + (evt.status === 'failed' ? 1 : 0),
                // 只把 ok 的耗时计入平均（failed 的耗时通常是超时/拒绝边界值，
                // 拉高均值会让 UI 误导用户预估剩余时间）
                totalElapsedMs:
                  c.totalElapsedMs + (evt.status === 'ok' ? evt.elapsedMs : 0),
              }));
              // recent: O(1) 推入环形缓冲；UI 取倒序时直接 .slice().reverse()
              setRecent((r) => {
                if (r.length < RECENT_BUFFER_SIZE) {
                  return [...r, evt];
                }
                // 满了：去掉最早一条，追加新条；len 始终 == RECENT_BUFFER_SIZE
                return [...r.slice(1), evt];
              });
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

  return {
    total,
    counters,
    recent,
    heartbeat,
    chunkProgress,
    result,
    isRunning,
    error,
    start,
    abort,
    reset,
  };
}
