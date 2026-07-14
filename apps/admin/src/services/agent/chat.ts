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
  /**
   * Knowledge execution contract for this turn. This field is required so an
   * empty selection cannot be confused with automatic discovery in transit.
   */
  knowledgeContextMode: 'auto' | 'selected' | 'none';
  messages: { role: 'user' | 'assistant'; content: string }[];
  modelId?: string | null;
  providerCode?: string | null;
  modelParams?: Record<string, string | number | boolean | null | undefined> | null;
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
    semanticRecall?: boolean;
    semanticLimit?: number;
  } | null;
}

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

export interface ChatStreamHandlers {
  onDelta?: (chunk: string) => void;
  onThink?: (chunk: string) => void;
  onSources?: (sources: { title: string; slug: string }[]) => void;
  onRetrieval?: (receipt: AgentRetrievalReceipt) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

interface HttpErrorPayload {
  code?: number;
  message?: string;
  errorCategory?: string;
}

async function readHttpErrorPayload(response: Response): Promise<HttpErrorPayload> {
  try {
    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
    const candidate = payload as Record<string, unknown>;
    return {
      code: typeof candidate.code === 'number' ? candidate.code : undefined,
      message: typeof candidate.message === 'string' ? candidate.message.trim() : undefined,
      errorCategory:
        typeof candidate.errorCategory === 'string' ? candidate.errorCategory : undefined,
    };
  } catch {
    return {};
  }
}

function isAuthenticationFailure(status: number, payload: HttpErrorPayload): boolean {
  return (
    status === 401 ||
    payload.errorCategory === 'unauthorized' ||
    payload.code === 401 ||
    payload.code === 2001 ||
    payload.code === 2002 ||
    payload.code === 2003
  );
}

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
    (item): item is number => Number.isInteger(item) && typeof item === 'number' && item > 0,
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

  if (!res.ok) {
    const payload = await readHttpErrorPayload(res);
    if (isAuthenticationFailure(res.status, payload)) {
      handlers.onError?.('登录状态已过期，请重新登录');
      return;
    }
    handlers.onError?.(payload.message || (res.status === 403 ? '权限不足' : `HTTP ${res.status}`));
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
            case 'retrieval': {
              const receipt = parseAgentRetrievalReceipt(parsed);
              if (receipt) handlers.onRetrieval?.(receipt);
              break;
            }
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
    if (!signal?.aborted) {
      handlers.onError?.('回答流意外中断，请重试');
    }
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
