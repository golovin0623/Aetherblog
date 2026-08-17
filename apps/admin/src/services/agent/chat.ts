/**
 * Agent 聊天 SSE 客户端 —— admin 端复用
 *
 * 与 blog 端 apps/blog/app/agent/lib/agentChatStream.ts 协议同源：
 * fetch + ReadableStream 解析 SSE，事件类型 retrieval / think / delta / usage / done / error
 * （旧版 sources 保留兼容）。EventSource 不能 POST 多轮历史，所以这里手撕。
 *
 * admin 版在 blog 版之上保留的差异点：
 *   · modelParams / atlasScope 上行字段（blog 端没有）；
 *   · HTTP 错误回执的严格 parser（code / errorCategory 双通道识别登录态失效）。
 */

/**
 * OpenAI 风格的多模态消息片段 —— 图片以 image_url 形式上行（后端并行开发中，
 * 事件形态已定）。纯文本轮次继续传 string，不强迫存量调用方改造。
 */
export type ChatMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatStreamRequest {
  sessionId: string;
  mode: 'chat' | 'cowork' | 'code';
  /**
   * Knowledge execution contract for this turn. This field is required so an
   * empty selection cannot be confused with automatic discovery in transit.
   */
  knowledgeContextMode: 'auto' | 'selected' | 'none';
  messages: { role: 'user' | 'assistant'; content: string | ChatMessageContentPart[] }[];
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

/**
 * error 事件的结构化补充 —— code 供前端做定向编排（如 selected_context_not_grounded
 * 提示「改用自动检索重试」），retryable 决定是否直接亮出重试按钮。
 * meta 是可选第二参：只关心 message 的旧调用方无需任何改动（向后兼容）。
 */
export interface ChatStreamErrorMeta {
  code?: string;
  retryable?: boolean;
}

/**
 * usage 事件 —— 本轮回答的 token 消耗（后端并行开发中，事件形态已定）。
 * estimated=true 表示上游未返回精确值、由服务端估算得出，前端展示时应做区分。
 */
export interface ChatStreamUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
}

export interface ChatStreamHandlers {
  onDelta?: (chunk: string) => void;
  onThink?: (chunk: string) => void;
  onSources?: (sources: { title: string; slug: string }[]) => void;
  onRetrieval?: (receipt: AgentRetrievalReceipt) => void;
  onUsage?: (usage: ChatStreamUsage) => void;
  onDone?: () => void;
  onError?: (message: string, meta?: ChatStreamErrorMeta) => void;
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

/** usage 字段校验：必须是有限的非负数字 —— NaN / Infinity / 负值都视为脏数据。 */
function usageNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * usage 事件防御性解析：任一 token 字段缺失 / 非数字、estimated 非布尔时
 * 整包丢弃不回调 —— 宁可这一轮没有用量数据，也不把脏数据写进会话统计。
 */
export function parseChatStreamUsage(value: unknown): ChatStreamUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const promptTokens = usageNumber(candidate.promptTokens);
  const completionTokens = usageNumber(candidate.completionTokens);
  const totalTokens = usageNumber(candidate.totalTokens);
  if (promptTokens === null || completionTokens === null || totalTokens === null) return null;
  if (typeof candidate.estimated !== 'boolean') return null;
  return { promptTokens, completionTokens, totalTokens, estimated: candidate.estimated };
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
      // 登录态失效重试也不会成功（必须重新登录），显式标记不可重试。
      handlers.onError?.('登录状态已过期，请重新登录', { retryable: false });
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

  // 处理一段 SSE 事件文本；返回 true 表示收到终态事件（done/error），流应结束。
  // 抽成函数是为了让主循环和 EOF 兜底共用同一份解析逻辑。
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
          if (Array.isArray(parsed.sources))
            handlers.onSources?.(parsed.sources as { title: string; slug: string }[]);
          break;
        case 'retrieval': {
          const receipt = parseAgentRetrievalReceipt(parsed);
          if (receipt) handlers.onRetrieval?.(receipt);
          break;
        }
        case 'usage': {
          const usage = parseChatStreamUsage(parsed);
          if (usage) handlers.onUsage?.(usage);
          break;
        }
        case 'done':
          handlers.onDone?.();
          return true;
        case 'error':
          // code / retryable 原样透传给上层做编排；类型不对时置 undefined（未知）。
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
    // 若不在这里补处理，完整收到的回答会被误报成「意外中断」。
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
