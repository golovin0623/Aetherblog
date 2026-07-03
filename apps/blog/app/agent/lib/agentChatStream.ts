'use client';

/**
 * Agent 聊天 SSE 客户端
 *
 * 向 `/api/v1/agent/chat` 发起 POST，接收 SSE 流。SSE 事件格式与 ai-service
 * 的 QA / summary stream 对齐：
 *
 *   数据: {"type":"delta","content":"…"}\n\n
 *   data: {"type":"think","content":"…"}\n\n  // 可选思考段
 *   数据: {"type":"sources","sources":[…]}\n\n
 *   数据: {"type":"done"}\n\n
 *   数据: {"type":"error","code":"…","message":"…"}\n\n
 *
 * 我们用 fetch + ReadableStream 解析（而非 EventSource），原因：
 *  1. EventSource 只支持 GET，不能 POST 多轮对话历史
 *  2. EventSource 无法带自定义 header（虽然这里只靠 cookie，但 POST 的明确语义更好）
 *  3. AbortController 中断更干净，避免 EventSource onerror 在 devtools 刷红
 */

export interface ChatStreamRequest {
  sessionId: string;
  mode: 'chat' | 'cowork' | 'code';
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** 可选：用户在 ModelPicker 选定的模型。后端没传时按 task-routing 自动决定。 */
  modelId?: string | null;
  providerCode?: string | null;
  /** @ picker 选中的文章 ID 列表 —— 后端注入文章原文到 system context。 */
  articleIds?: number[] | null;
  /** # picker 选中的标签 slug —— 后端注入该标签下的最近文章列表。 */
  tagSlugs?: string[] | null;
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
    } catch { /* not JSON */ }
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

      // 按 SSE 规范，事件以空行（\n\n）分隔
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
              if (Array.isArray(parsed.sources)) handlers.onSources?.(parsed.sources as never);
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
      /* 吞下*/
    }
  }
}
