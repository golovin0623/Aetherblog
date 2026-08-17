'use client';

/**
 * Agent 聊天 SSE 客户端
 *
 * 向 `/api/v1/agent/chat` 发起 POST，接收 SSE 流。SSE 事件格式与 ai-service
 * 的 agent stream 对齐（与 admin 端 apps/admin/src/services/agent/chat.ts 同一协议）：
 *
 *   data: {"type":"retrieval","version":1,"status":"matched","hits":[…],"warnings":[…]}\n\n
 *   data: {"type":"think","content":"…"}\n\n     // 可选思考段
 *   data: {"type":"delta","content":"…"}\n\n     // 正文增量
 *   data: {"type":"done"}\n\n
 *   data: {"type":"error","code":"…","message":"…","retryable":true}\n\n
 *
 * `retrieval` 是知识检索回执：仅当本轮携带知识上下文（kbIds / auto 注入）时，
 * 在正文开始前一次性发出 —— 它是"回答编排"的可视化数据源（检索了什么、命中
 * 了哪些片段、哪些来源不可用），前端必须落到消息上展示，不能静默丢弃。
 *
 * 旧版 `sources` 事件仍在网关白名单里但服务端已不再发送 —— handler 保留以
 * 兼容历史（若后端复活该事件也不至于丢数据）。
 *
 * 我们用 fetch + ReadableStream 解析（而非 EventSource），原因：
 *  1. EventSource 只支持 GET，不能 POST 多轮对话历史
 *  2. EventSource 无法带自定义 header（虽然这里只靠 cookie，但 POST 的明确语义更好）
 *  3. AbortController 中断更干净，避免 EventSource onerror 在 devtools 刷红
 */

/** 知识上下文三态契约 —— 与后端 knowledgeContextMode 归一化逻辑对齐：
 *  auto = 服务端自动发现（省略 kbIds）；selected = 只用显式选中的 kbIds；
 *  none = 本轮完全不启用知识检索（kbIds 显式置 null）。 */
export type KnowledgeContextMode = 'auto' | 'selected' | 'none';

export interface ChatStreamRequest {
  sessionId: string;
  mode: 'chat' | 'cowork' | 'code';
  /** 三态必填 —— 空选择与"自动发现"在传输层不可混淆。 */
  knowledgeContextMode: KnowledgeContextMode;
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** 可选：用户在 ModelPicker 选定的模型。后端没传时按 task-routing 自动决定。 */
  modelId?: string | null;
  providerCode?: string | null;
  /** @ picker 选中的文章 ID 列表 —— 后端注入文章原文到 system context。 */
  articleIds?: number[] | null;
  /** # picker 选中的标签 slug —— 后端注入该标签下的最近文章列表。 */
  tagSlugs?: string[] | null;
  /** 知识库 picker 选中的 KB ID。omit = auto 交给后端注入；null/[] = 明确不用。 */
  kbIds?: number[] | null;
}

// ---------------------------------------------------------------------------
// retrieval 回执类型 —— 与 ai-service agent.py 的 receipt schema (version 1) 对齐
// ---------------------------------------------------------------------------

export type AgentRetrievalStatus = 'matched' | 'empty' | 'partial' | 'unavailable';

export type AgentRetrievalHitKind =
  | 'knowledge_base_chunk'
  | 'atlas_note'
  | 'atlas_knowledge_point'
  | 'atlas_evidence';

export interface AgentRetrievalHit {
  key: string;
  kind: AgentRetrievalHitKind;
  title: string;
  sourceTitle?: string;
  snippet?: string;
  score?: number;
  rank: number;
  href?: string;
}

export interface AgentRetrievalWarning {
  scope: string;
  code: string;
  message: string;
}

export interface AgentRetrievalReceipt {
  version: 1;
  status: AgentRetrievalStatus;
  requested: {
    knowledgeBaseIds: number[];
    atlasKnowledgePointIds: number[];
    atlasCarrierIds: number[];
  };
  hits: AgentRetrievalHit[];
  warnings: AgentRetrievalWarning[];
}

/** error 事件的结构化补充 —— code 供前端做定向编排（如 selected_context_not_grounded
 *  提示"改用自动检索重试"），retryable 决定是否直接亮出重试按钮。 */
export interface ChatStreamErrorMeta {
  code?: string;
  retryable?: boolean;
}

export interface ChatStreamHandlers {
  onDelta?: (chunk: string) => void;
  onThink?: (chunk: string) => void;
  onSources?: (sources: { title: string; slug: string }[]) => void;
  onRetrieval?: (receipt: AgentRetrievalReceipt) => void;
  onDone?: () => void;
  onError?: (message: string, meta?: ChatStreamErrorMeta) => void;
}

// ---- retrieval 防御性解析（不信任网关透传的原始 JSON 形状） ----

const RETRIEVAL_STATUSES = new Set<AgentRetrievalStatus>([
  'matched',
  'empty',
  'partial',
  'unavailable',
]);

const RETRIEVAL_HIT_KINDS = new Set<AgentRetrievalHitKind>([
  'knowledge_base_chunk',
  'atlas_note',
  'atlas_knowledge_point',
  'atlas_evidence',
]);

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function positiveIntegerArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.filter(
    (item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0,
  );
  return parsed.length === value.length ? parsed : null;
}

function parseRetrievalHit(value: unknown): AgentRetrievalHit | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const key = nonEmptyString(candidate.key);
  const title = nonEmptyString(candidate.title);
  const kind = candidate.kind;
  const rank = candidate.rank;
  if (
    !key ||
    !title ||
    typeof kind !== 'string' ||
    !RETRIEVAL_HIT_KINDS.has(kind as AgentRetrievalHitKind) ||
    typeof rank !== 'number' ||
    !Number.isInteger(rank) ||
    rank < 1
  ) {
    return null;
  }

  const sourceTitle = nonEmptyString(candidate.sourceTitle);
  const snippet = nonEmptyString(candidate.snippet);
  const href = nonEmptyString(candidate.href);
  const score = candidate.score;
  if (score !== undefined && (typeof score !== 'number' || !Number.isFinite(score))) return null;

  return {
    key,
    kind: kind as AgentRetrievalHitKind,
    title,
    rank,
    ...(sourceTitle ? { sourceTitle } : {}),
    ...(snippet ? { snippet } : {}),
    ...(typeof score === 'number' ? { score } : {}),
    ...(href ? { href } : {}),
  };
}

function parseRetrievalWarning(value: unknown): AgentRetrievalWarning | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const scope = nonEmptyString(candidate.scope);
  const code = nonEmptyString(candidate.code);
  const message = nonEmptyString(candidate.message);
  return scope && code && message ? { scope, code, message } : null;
}

export function parseAgentRetrievalReceipt(value: unknown): AgentRetrievalReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.status !== 'string') return null;
  if (!RETRIEVAL_STATUSES.has(candidate.status as AgentRetrievalStatus)) return null;
  if (!candidate.requested || typeof candidate.requested !== 'object') return null;
  if (!Array.isArray(candidate.hits) || !Array.isArray(candidate.warnings)) return null;

  const requested = candidate.requested as Record<string, unknown>;
  const knowledgeBaseIds = positiveIntegerArray(requested.knowledgeBaseIds);
  const atlasKnowledgePointIds = positiveIntegerArray(requested.atlasKnowledgePointIds);
  const atlasCarrierIds = positiveIntegerArray(requested.atlasCarrierIds);
  if (!knowledgeBaseIds || !atlasKnowledgePointIds || !atlasCarrierIds) return null;

  const hits = candidate.hits.map(parseRetrievalHit);
  const warnings = candidate.warnings.map(parseRetrievalWarning);
  if (hits.some((hit) => hit === null) || warnings.some((warning) => warning === null)) return null;

  return {
    version: 1,
    status: candidate.status as AgentRetrievalStatus,
    requested: { knowledgeBaseIds, atlasKnowledgePointIds, atlasCarrierIds },
    hits: hits as AgentRetrievalHit[],
    warnings: warnings as AgentRetrievalWarning[],
  };
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

  // 处理一段 SSE 事件文本；返回 true 表示收到终态事件（done/error），流应结束。
  const processEvent = (event: string): boolean => {
    const dataLines = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return false;
    const payload = dataLines.join('\n');
    if (!payload) return false;

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
        case 'retrieval': {
          const receipt = parseAgentRetrievalReceipt(parsed);
          if (receipt) handlers.onRetrieval?.(receipt);
          break;
        }
        case 'done':
          handlers.onDone?.();
          return true;
        case 'error':
          handlers.onError?.(
            typeof parsed.message === 'string' ? parsed.message : '未知错误',
            {
              code: typeof parsed.code === 'string' ? parsed.code : undefined,
              retryable: typeof parsed.retryable === 'boolean' ? parsed.retryable : undefined,
            },
          );
          return true;
        default:
          break;
      }
    } catch {
      /* 非 JSON 心跳行，忽略 */
    }
    return false;
  };

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
        if (processEvent(event)) return;
      }
    }
    // EOF：冲洗解码器并处理缓冲区里没有尾随空行的最后一个事件 —— 部分
    // 服务端/代理会在 `data:{"type":"done"}\n` 后直接断开，不发终止空行；
    // 若不在这里补处理，完整收到的回答会被误报成"意外中断"。
    buffer += decoder.decode();
    if (buffer.includes('data:') && processEvent(buffer)) return;
    // 流被服务端关闭但从未收到 done/error —— 这是异常中断（网关重启、上游
    // 断连），不能伪装成正常完成：已收到的内容保留，状态标记为可重试错误。
    if (!signal?.aborted) {
      handlers.onError?.('回答流意外中断，请重试', { retryable: true });
    }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return;
    handlers.onError?.(err instanceof Error ? err.message : '流读取失败', { retryable: true });
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* swallow */
    }
  }
}
