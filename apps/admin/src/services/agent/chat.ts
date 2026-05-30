/**
 * Agent 聊天 SSE 客户端 —— admin 端复用
 *
 * 与 blog 端 apps/blog/app/agent/lib/agentChatStream.ts 协议完全一致：
 * fetch + ReadableStream 解析 SSE，事件类型 delta / think / sources / done / error。
 * EventSource 不能 POST 多轮历史，所以这里手撕。
 */

export interface ChatStreamRequest {
  sessionId: string;
  mode: 'chat' | 'cowork' | 'code';
  messages: { role: 'user' | 'assistant'; content: string }[];
  modelId?: string | null;
  providerCode?: string | null;
  articleIds?: number[] | null;
  tagSlugs?: string[] | null;
  /**
   * KB picker 选中的知识库 ID 列表。后端会用最后一条 user 消息当 query，
   * 在选中的 KB 内做语义召回（每个 KB 的 active profile 决定 model / top_k / threshold），
   * 把命中的 chunk 拼成额外 system 段注入 LLM。
   */
  kbIds?: number[] | null;
  atlasScope?: {
    kpIds?: number[];
    carrierIds?: number[];
    neighborhoodDepth?: number;
    includeEvidence?: boolean;
  } | null;
}

export interface ChatStreamHandlers {
  onDelta?: (chunk: string) => void;
  onThink?: (chunk: string) => void;
  onSources?: (sources: { title: string; slug: string }[]) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export async function streamAgentChat(
  req: ChatStreamRequest,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/v1/agent/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(req),
    signal,
  });

  if (res.status === 401 || res.status === 403) {
    handlers.onError?.('登录状态已过期，请重新登录');
    return;
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && typeof j.message === 'string') msg = j.message;
    } catch {
      /* not JSON */
    }
    handlers.onError?.(msg);
    return;
  }
  if (!res.body) {
    handlers.onError?.('响应没有可读流');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length === 0) continue;
        const payload = dataLines.join('\n');
        if (!payload) continue;

        try {
          const parsed = JSON.parse(payload) as { type?: string; [k: string]: unknown };
          switch (parsed.type) {
            case 'delta':
              if (typeof parsed.content === 'string') handlers.onDelta?.(parsed.content);
              break;
            case 'think':
              if (typeof parsed.content === 'string') handlers.onThink?.(parsed.content);
              break;
            case 'sources':
              if (Array.isArray(parsed.sources))
                handlers.onSources?.(parsed.sources as { title: string; slug: string }[]);
              break;
            case 'done':
              handlers.onDone?.();
              return;
            case 'error':
              handlers.onError?.(typeof parsed.message === 'string' ? parsed.message : '未知错误');
              return;
            default:
              break;
          }
        } catch {
          /* 非 JSON 心跳行，忽略 */
        }
      }
    }
    handlers.onDone?.();
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return;
    handlers.onError?.(err instanceof Error ? err.message : '流读取失败');
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* swallow */
    }
  }
}
