/**
 * 灵境会话云同步（admin 端）—— 本地优先 + 服务端 LWW 漫游。
 *
 * 职责边界：
 *   · sessions.ts 仍是唯一的本地真值层（localStorage 即时读写，UI 永不等网络）；
 *   · 本模块只负责「本地 ↔ /api/v1/agent/sessions」的后台对账与推送，
 *     所有网络失败静默（同类告警去重 warn 一次），下次 flush 自然重试；
 *   · 页面通过 configureAgentSessionSync 注册回调，网络细节全部收口在这里。
 *
 * 同步状态机（per-session）：
 *
 *   watermark（已同步水位）: 最近一次确认与服务端一致的 updatedAt。
 *     dirty 判定 = session.updatedAt !== watermark 且无 pending 消息/翻译
 *     （pending 即流式中 —— 流式期间绝不 PUT，等流结束后的那次 flush）。
 *     水位缺失（从未同步过）时仅推送「值得同步」的会话（有消息或有草稿），
 *     避免每次进页面自动创建的空会话在多设备间来回打架。
 *
 *   serverNewer（懒加载标记）: reconcile 时发现服务端 updatedAt 更大，
 *     **或**本地是空壳而服务端有消息（无论时间戳大小 —— 空壳永远不是权威版本）。
 *     不立即拉全量 —— 激活该会话时才 GET /:id 用服务端版本整体替换本地。
 *     服务端有、本地没有的会话以 meta 占位（messages 空）进侧栏，同样懒加载。
 *     标记在场期间本地不是权威版本：flush 拒绝 PUT（改为触发一次懒加载重试），
 *     页面发消息前也应先查 isSessionAwaitingHydration。懒加载仅在 HTTP 404
 *     （服务端确已删除）时清标记；网络 / 5xx 失败保留标记待重试 —— 否则空壳
 *     占位会话会被误判为已同步，随后一次发消息即以更晚 updatedAt 通过 LWW
 *     覆盖服务端全量历史（PUT 是整会话替换：0 条消息 = 服务端历史被清空）。
 *
 *   permanentFailures（永久失败 skip）: PUT 撞上「数据校验类」4xx
 *     （400 / 413 / 422，且不是会话数配额已满）属永久失败，按「失败时的
 *     updatedAt」记入 skip —— updatedAt 再变才重试，避免每轮 flush 重推注定
 *     失败的请求。其余 4xx（401 掉登录、403、404、429 限流，以及「会话数量
 *     已达上限」这类配额错误）都属**可恢复**，按瞬时失败处理，下轮 flush 自然
 *     重试；任一会话 DELETE 成功（配额腾出一格）后整张表清空。用户提示按
 *     「状态码 + 服务端 message」去重 —— 不同失败原因各提示一次，同一原因跨
 *     会话只提示一次。
 *
 *   LWW: PUT 时服务端 client_updated_at 更新 → HTTP 409 且 data=服务端完整
 *     版本（极端为 null → GET /:id 自取），通过页面回调采纳写回 React state；
 *     正在流式的会话拒绝采纳（回调返回 false），水位不动、下轮 flush 重试。
 *     相等时间戳视为幂等重放，服务端回 200。
 *
 * 首次迁移：服务端为空、本地有历史时，所有本地会话都无水位 → 全部 dirty →
 * 首次 flush 逐个 PUT 上去（即一次性导入，无需特殊分支）。单轮 flush 至多推
 * MAX_PUTS_PER_FLUSH 条，仍有剩余时自行接力调度下一轮 —— 页面不会为「推送」
 * 再产生一次 state 变化，没有接力就等于剩余会话永远不同步。
 *
 * 已知边界（有意取舍）：
 *   · 首次迁移超过写限流（60/min/user）规模时，某一轮可能整轮 429 —— 该轮零
 *     进展即停止接力，剩余会话等下一次真实状态变化（发消息 / 重进页面对账）
 *     再续；不做定时重试是刻意的，避免限流期间的热重试雪上加霜；
 *   · 多标签页各自持有内存水位，可能交替 PUT 同一会话 —— LWW 保证收敛；
 *   · DELETE 失败（网络中断）时服务端副本残留，下次 reconcile 会以占位形式
 *     复活 —— 本地优先架构下无墓碑，接受；
 *   · 置顶/重命名不 bump updatedAt（沿用页面既有行为），要等下一次内容变更
 *     才随会话同步。
 */

import type {
  AgentAlternative,
  AgentAttachment,
  AgentMessage,
  AgentMode,
  AgentModelParams,
  AgentRequestSnapshotV1,
  AgentSession,
  AgentToolEvent,
  AgentTranslation,
  AgentUsage,
} from './sessions';
import { readAgentSessionDraft } from './sessions';
import type { AgentRetrievalReceipt } from '@aetherblog/agent-kit';

// ============================================================
// Wire 形状（与 apps/server-go/internal/dto/agent_session.go 对齐）
// ============================================================

/** 消息 payload —— 服务端不解析的透传 JSON，装下 AgentMessage 的全部可选元数据。 */
export interface AgentSessionWirePayload {
  think?: string;
  sources?: { title: string; slug: string }[];
  retrieval?: AgentRetrievalReceipt;
  modelId?: string | null;
  providerCode?: string | null;
  usage?: AgentUsage;
  /** 工具调用轨迹（含参数 / 结果 / 计时，服务端 result 已截断 ≤2000 字符）。 */
  toolEvents?: AgentToolEvent[];
  /** 多模型对比后存档的其他回答（采纳时写入）。 */
  alternatives?: AgentAlternative[];
  /** 附件元信息 —— dataUrl 已剥离（原图只在发送当次的内存缓存里）。 */
  attachments?: Omit<AgentAttachment, 'dataUrl'>[];
  translation?: Omit<AgentTranslation, 'pending'>;
  requestSnapshot?: AgentRequestSnapshotV1;
  error?: string;
  errorCode?: string;
  retryable?: boolean;
  startedAt?: number;
  firstTokenAt?: number;
  finishedAt?: number;
}

export interface AgentSessionWireMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 客户端毫秒时间戳（原值透传）。 */
  createdAt: number;
  payload?: AgentSessionWirePayload;
}

/** 列表项 / PUT 成功响应的 meta（不含 messages）。 */
export interface AgentSessionWireMeta {
  id: string;
  title: string;
  mode: string;
  modelId: string | null;
  providerCode: string | null;
  modelParams?: AgentModelParams | null;
  pinned: boolean;
  contextBreakId: string | null;
  draft: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** GET /:id 与 409 data 的完整会话（meta + seq 升序 messages）。 */
export interface AgentSessionWireDetail extends AgentSessionWireMeta {
  messages: AgentSessionWireMessage[];
}

/** PUT /:id 请求体（会话 id 走路径参数）。 */
export interface AgentSessionWireUpsert {
  title: string;
  mode: AgentMode;
  modelId: string | null;
  providerCode: string | null;
  modelParams: AgentModelParams | null;
  pinned: boolean;
  contextBreakId: string | null;
  draft: string;
  createdAt: number;
  updatedAt: number;
  messages: AgentSessionWireMessage[];
}

// ============================================================
// 纯函数：wire ↔ 本地模型映射
// ============================================================

/** AgentMessage → wire。可选元数据全部收进 payload；attachments 剥 dataUrl，
 *  translation 剥 pending（进行中的翻译不值得漫游，且 pending 会话本就不推）。 */
export function messageToWire(message: AgentMessage): AgentSessionWireMessage {
  const payload: AgentSessionWirePayload = {};
  if (message.think !== undefined) payload.think = message.think;
  if (message.sources !== undefined) payload.sources = message.sources;
  if (message.retrieval !== undefined) payload.retrieval = message.retrieval;
  if (message.modelId !== undefined) payload.modelId = message.modelId;
  if (message.providerCode !== undefined) payload.providerCode = message.providerCode;
  if (message.usage !== undefined) payload.usage = message.usage;
  if (message.toolEvents !== undefined) payload.toolEvents = message.toolEvents;
  if (message.alternatives !== undefined) payload.alternatives = message.alternatives;
  if (message.attachments && message.attachments.length > 0) {
    payload.attachments = message.attachments.map(({ dataUrl: _dataUrl, ...meta }) => meta);
  }
  if (message.translation && !message.translation.pending) {
    const { pending: _pending, ...rest } = message.translation;
    payload.translation = rest;
  }
  if (message.requestSnapshot !== undefined) payload.requestSnapshot = message.requestSnapshot;
  if (message.error !== undefined) payload.error = message.error;
  if (message.errorCode !== undefined) payload.errorCode = message.errorCode;
  if (message.retryable !== undefined) payload.retryable = message.retryable;
  if (message.startedAt !== undefined) payload.startedAt = message.startedAt;
  if (message.firstTokenAt !== undefined) payload.firstTokenAt = message.firstTokenAt;
  if (message.finishedAt !== undefined) payload.finishedAt = message.finishedAt;

  const wire: AgentSessionWireMessage = {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
  if (Object.keys(payload).length > 0) wire.payload = payload;
  return wire;
}

/** wire → AgentMessage。附件补空 dataUrl（原图不入库，刷新后本就降级为占位卡）。 */
export function messageFromWire(wire: AgentSessionWireMessage): AgentMessage {
  const message: AgentMessage = {
    id: wire.id,
    role: wire.role === 'assistant' ? 'assistant' : 'user',
    content: typeof wire.content === 'string' ? wire.content : '',
    createdAt: wire.createdAt,
  };
  const p = wire.payload;
  if (!p || typeof p !== 'object') return message;
  if (typeof p.think === 'string') message.think = p.think;
  if (Array.isArray(p.sources)) message.sources = p.sources;
  if (p.retrieval) message.retrieval = p.retrieval;
  if (p.modelId !== undefined) message.modelId = p.modelId;
  if (p.providerCode !== undefined) message.providerCode = p.providerCode;
  if (p.usage) message.usage = p.usage;
  if (Array.isArray(p.toolEvents)) message.toolEvents = p.toolEvents;
  if (Array.isArray(p.alternatives)) message.alternatives = p.alternatives;
  if (Array.isArray(p.attachments)) {
    message.attachments = p.attachments.map((meta) => ({ ...meta, dataUrl: '' }));
  }
  if (p.translation) message.translation = p.translation;
  if (p.requestSnapshot) message.requestSnapshot = p.requestSnapshot;
  if (typeof p.error === 'string') message.error = p.error;
  if (typeof p.errorCode === 'string') message.errorCode = p.errorCode;
  if (typeof p.retryable === 'boolean') message.retryable = p.retryable;
  if (typeof p.startedAt === 'number') message.startedAt = p.startedAt;
  if (typeof p.firstTokenAt === 'number') message.firstTokenAt = p.firstTokenAt;
  if (typeof p.finishedAt === 'number') message.finishedAt = p.finishedAt;
  return message;
}

/** AgentSession → PUT 请求体（整会话替换，幂等可重放）。 */
export function sessionToWire(session: AgentSession): AgentSessionWireUpsert {
  return {
    title: session.title,
    mode: session.mode,
    modelId: session.modelId ?? null,
    providerCode: session.providerCode ?? null,
    modelParams: session.modelParams ?? null,
    pinned: session.pinned === true,
    contextBreakId: session.contextBreakId ?? null,
    draft: session.draft ?? '',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages.map(messageToWire),
  };
}

const VALID_MODES: readonly AgentMode[] = ['chat', 'cowork', 'code'];

function normalizeMode(mode: string): AgentMode {
  return (VALID_MODES as readonly string[]).includes(mode) ? (mode as AgentMode) : 'chat';
}

/** wire 详情 → AgentSession（服务端版本整体替换本地时使用）。 */
export function sessionFromWire(wire: AgentSessionWireDetail): AgentSession {
  const session: AgentSession = {
    id: wire.id,
    title: typeof wire.title === 'string' ? wire.title : '',
    mode: normalizeMode(wire.mode),
    modelId: wire.modelId ?? null,
    providerCode: wire.providerCode ?? null,
    draft: typeof wire.draft === 'string' ? wire.draft : '',
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
    messages: Array.isArray(wire.messages) ? wire.messages.map(messageFromWire) : [],
  };
  if (wire.modelParams && typeof wire.modelParams === 'object') {
    session.modelParams = wire.modelParams;
  }
  if (wire.pinned === true) session.pinned = true;
  if (wire.contextBreakId) session.contextBreakId = wire.contextBreakId;
  return session;
}

/** 服务端独有会话的侧栏占位（messages 空，激活时懒加载全量）。 */
export function sessionStubFromWireMeta(meta: AgentSessionWireMeta): AgentSession {
  return sessionFromWire({ ...meta, messages: [] });
}

// ============================================================
// 纯函数：同步判定
// ============================================================

/** 流式回答或流式翻译进行中 —— 此时快照不完整，绝不推送。 */
export function sessionHasPendingWork(session: AgentSession): boolean {
  return session.messages.some((m) => m.pending === true || m.translation?.pending === true);
}

/** 从未同步过的会话是否值得首推 —— 空壳「新对话」（无消息无草稿）不上云，
 *  避免每次进页面自动创建的空会话在多设备间累积成垃圾。 */
export function sessionWorthSyncing(session: AgentSession): boolean {
  return session.messages.length > 0 || (session.draft ?? '').trim() !== '';
}

/**
 * 水位判定：本轮 flush 的候选会话（按 updatedAt 倒序，最近的优先）。
 *   · updatedAt === 水位 → 已同步，跳过；
 *   · 有 pending 消息/翻译 → 流式中，跳过（等流结束后的 flush）；
 *   · 无水位且不值得同步（空壳会话）→ 跳过。
 *
 * 注意：**懒加载（serverNewer）与永久失败 skip 不在这里判**。仍带懒加载标记的
 * 会话同时是「拒绝 PUT」与「触发懒加载重试」的对象，两种处置只有 flush 分得清，
 * 所以这两道闸统一由 flushAgentSessionSync + pushSession 把守（见那里的注释）。
 */
export function selectSessionsToPush(
  sessions: readonly AgentSession[],
  watermarks: ReadonlyMap<string, number>,
): AgentSession[] {
  return sessions
    .filter((s) => {
      const watermark = watermarks.get(s.id);
      if (watermark === s.updatedAt) return false;
      if (sessionHasPendingWork(s)) return false;
      if (watermark === undefined && !sessionWorthSyncing(s)) return false;
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 采纳服务端版本前与本地会话合并（页面 onAdoptServerVersion 使用）：
 *   · local 不存在（其他设备新建）→ 原样采纳；
 *   · local.updatedAt > 服务端 → 返回 null 拒绝采纳（采纳瞬间本地已有更新的
 *     编辑），走既有 LWW 重试通道 —— 水位不动，下轮 flush 再冲突再收敛；
 *   · draft 是纯本地态（用户可能正在输入），永远保留本地值不被服务端覆盖；
 *   · titleEdited 不在 wire 里，从本地继承（手动改名永远赢）；
 *   · pinned 在 wire 里有，保留服务端值。
 */
export function mergeAdoptedServerSession(
  server: AgentSession,
  local: AgentSession | undefined,
): AgentSession | null {
  if (!local) return server;
  if (local.updatedAt > server.updatedAt) return null;
  const merged: AgentSession = { ...server, draft: readAgentSessionDraft(local) };
  if (local.titleEdited) merged.titleEdited = true;
  return merged;
}

// ============================================================
// 同步运行时（模块级单例 —— 页面唯一，网络细节全部收口于此）
// ============================================================

export interface AgentSessionSyncConfig {
  /** 当前登录用户 id；null = 未登录，同步整体禁用。用户变化时水位自动清空。 */
  userId: string | null;
  /**
   * 采纳服务端版本写回 React state。返回 false 表示拒绝（如该会话正在流式），
   * 此时水位不动，下一轮 flush 会再次冲突、再次尝试采纳。
   */
  onAdoptServerVersion: (session: AgentSession) => boolean;
  /** 服务端有、本地没有的会话（其他设备创建）—— 以 meta 占位进侧栏。 */
  onServerOnlySessions?: (sessions: AgentSession[]) => void;
  /** 用户可见的一次性同步提示（页面映射为 toast.info）。 */
  onSyncNotice?: (message: string) => void;
}

interface Envelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const API_BASE = '/api/v1/agent/sessions';
const LIST_LIMIT = 100;
/** 推送节流 —— 略宽于本地落盘的 800ms，合并同一轮编辑的多次状态变化。 */
const SYNC_THROTTLE_MS = 1500;
/** 单轮 flush 的 PUT 上限 —— 写路径限流 60/min/user，首次迁移分批走。 */
const MAX_PUTS_PER_FLUSH = 20;

interface SyncState {
  userId: string | null;
  callbacks: AgentSessionSyncConfig | null;
  /** per-session 已同步 updatedAt 水位。 */
  watermarks: Map<string, number>;
  /** 服务端较新的会话 id → 服务端 updatedAt（激活时懒加载）。 */
  serverNewer: Map<string, number>;
  /** 在途请求的会话 id（PUT / 懒加载 GET 互斥）。 */
  inflight: Set<string>;
  pendingSnapshot: AgentSession[] | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  activeSessionId: string | null;
  /** 列表对账是否已成功完成（失败时后续 flush 自动重试）。 */
  reconciled: boolean;
  /** 「已同步另一设备的更新」只提示一次。 */
  conflictNoticed: boolean;
  /** 告警去重（按场景一次）。 */
  warned: Set<string>;
  /** 用户提示去重（按场景一次）。 */
  noticed: Set<string>;
  /** PUT 永久失败（4xx，除 409/429）的会话 id → 失败时的 updatedAt；
   *  updatedAt 再变才重试，避免每轮 flush 重推注定失败的请求。 */
  permanentFailures: Map<string, number>;
}

function freshState(): SyncState {
  return {
    userId: null,
    callbacks: null,
    watermarks: new Map(),
    serverNewer: new Map(),
    inflight: new Set(),
    pendingSnapshot: null,
    flushTimer: null,
    activeSessionId: null,
    reconciled: false,
    conflictNoticed: false,
    warned: new Set(),
    noticed: new Set(),
    permanentFailures: new Map(),
  };
}

let state: SyncState = freshState();
let reconcilePromise: Promise<void> | null = null;
let fetchOverride: FetchLike | null = null;

function doFetch(url: string, init?: RequestInit): Promise<Response> {
  const impl: FetchLike | null =
    fetchOverride ?? (typeof fetch === 'function' ? (fetch as FetchLike) : null);
  if (!impl) return Promise.reject(new Error('fetch unavailable'));
  return impl(url, init);
}

function warnOnce(scope: string, err: unknown): void {
  if (state.warned.has(scope)) return;
  state.warned.add(scope);
  console.warn(`[agent/sessionsSync] ${scope} 失败（将在下次同步时重试）`, err);
}

/** 用户可见提示（按场景去重一次）。 */
function noticeOnce(scope: string, message: string): void {
  if (state.noticed.has(scope)) return;
  state.noticed.add(scope);
  state.callbacks?.onSyncNotice?.(message);
}

function clearFlushTimer(): void {
  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
}

/**
 * 注册/更新同步配置。userId 变化（登录用户切换）时清空全部水位与懒加载
 * 标记 —— 在途请求靠闭包里 pin 住的 uid 自弃，不会写脏新用户的状态。
 */
export function configureAgentSessionSync(config: AgentSessionSyncConfig): void {
  if (state.userId !== config.userId) {
    clearFlushTimer();
    state = freshState();
    state.userId = config.userId;
    // reconcilePromise 是模块级的（不在 state 里）—— 不一并清空，新用户的
    // reconcileAgentSessions 会复用旧用户那个在途 promise，而那一轮在
    // `state.userId !== uid` 处自弃 → 新用户这一轮对账静默落空，reconciled
    // 永远为 false，直到下一次 flush 才补上。
    reconcilePromise = null;
  }
  state.callbacks = config;
}

/**
 * 后台对账：GET 列表，与本地快照比 updatedAt。
 *   服务端较新 → 标 serverNewer（激活时懒加载）；
 *   本地较新 / 仅存本地 → 保持 dirty（水位落后），待 flush 推送；
 *   仅存服务端 → 生成占位会话交给页面进侧栏。
 * 网络失败静默返回（reconciled 保持 false，后续 flush 自动重试）。
 */
export function reconcileAgentSessions(localSessions: AgentSession[]): Promise<void> {
  if (!state.userId || state.reconciled) return Promise.resolve();
  if (reconcilePromise) return reconcilePromise;
  reconcilePromise = doReconcile(localSessions).finally(() => {
    reconcilePromise = null;
  });
  return reconcilePromise;
}

async function doReconcile(localSessions: AgentSession[]): Promise<void> {
  const uid = state.userId;
  let metas: AgentSessionWireMeta[];
  try {
    const res = await doFetch(`${API_BASE}?limit=${LIST_LIMIT}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as Envelope<AgentSessionWireMeta[]>;
    metas = Array.isArray(json?.data) ? json.data : [];
  } catch (err) {
    warnOnce('reconcile', err);
    return;
  }
  if (state.userId !== uid) return; // 用户已切换，本次结果作废

  const localById = new Map(localSessions.map((s) => [s.id, s]));
  const serverOnly: AgentSession[] = [];
  for (const meta of metas) {
    const local = localById.get(meta.id);
    if (!local) {
      // 其他设备创建：占位进侧栏。水位 = 服务端值，占位自身永不被误推。
      serverOnly.push(sessionStubFromWireMeta(meta));
      state.serverNewer.set(meta.id, meta.updatedAt);
      state.watermarks.set(meta.id, meta.updatedAt);
      continue;
    }
    // 空壳兜底（与时间戳无关）：本地无消息、服务端有消息 —— 本地一定不是权威
    // 版本。落盘的占位会话跨页面生命周期后 updatedAt 可能与服务端相等，也可能
    // 因任意本地编辑（切模型 / 存草稿 / 改标题）反超服务端；不在这里标记，它就
    // 会以「更晚的 updatedAt」赢下 LWW 被 PUT 上行，而 PUT 是整会话替换 ——
    // 服务端 DELETE 全部消息后插入 0 条，历史被静默清空。
    // 代价：极小概率误伤「reconcile 落地前刚被清空的会话」（清空动作被服务端
    // 版本还原）—— 数据仍在，远优于永久丢历史。
    const localIsEmptyShell = local.messages.length === 0 && meta.messageCount > 0;
    if (meta.updatedAt > local.updatedAt || localIsEmptyShell) {
      // 服务端较新（或本地空壳）：懒加载标记；水位对齐本地值，本地未再变化就不推
      //（若用户在懒加载前又改了本地 → dirty → 仍被 serverNewer 挡住 → 懒加载重试）。
      state.serverNewer.set(meta.id, meta.updatedAt);
      state.watermarks.set(meta.id, local.updatedAt);
    } else {
      // 本地相等（已同步）或较新（dirty，水位落在服务端旧值上待推）。
      state.watermarks.set(meta.id, meta.updatedAt);
    }
  }
  state.reconciled = true;

  if (serverOnly.length > 0) state.callbacks?.onServerOnlySessions?.(serverOnly);

  // 当前激活的会话若已被标记服务端较新 → 立即懒加载（不等下次切换）。
  if (state.activeSessionId && state.serverNewer.has(state.activeSessionId)) {
    void hydrateSessionFromServer(state.activeSessionId);
  }

  // 本地较新 / 仅存本地（含首次迁移：服务端为空）→ 调度推送。
  if (selectSessionsToPush(localSessions, state.watermarks).length > 0) {
    scheduleAgentSessionSync(localSessions);
  }
}

/**
 * 推送调度 —— 页面在 sessions 变化处（与 scheduleSaveSessions 同一触发点）
 * 喂最新快照；尾沿节流合并，真正的 dirty 判定在 flush 时进行。
 */
export function scheduleAgentSessionSync(sessions: AgentSession[]): void {
  if (!state.userId) return;
  state.pendingSnapshot = sessions;
  if (state.flushTimer !== null) return; // 定时器在途：只更新快照
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    void flushAgentSessionSync();
  }, SYNC_THROTTLE_MS);
}

/** 立即执行一轮推送（测试与定时器共用入口）。 */
export async function flushAgentSessionSync(): Promise<void> {
  clearFlushTimer();
  const snapshot = state.pendingSnapshot;
  state.pendingSnapshot = null;
  if (!state.userId || !snapshot) return;
  if (!state.reconciled) {
    // 对账失败过（或从未成功）：先补一次对账，仍失败则静默等下轮。
    await reconcileAgentSessions(snapshot);
    if (!state.reconciled) return;
  }
  const dirty = selectSessionsToPush(snapshot, state.watermarks);
  const candidates: AgentSession[] = [];
  for (const session of dirty) {
    if (state.serverNewer.has(session.id)) {
      // 本地不是权威版本（服务端较新 / 本地空壳，且尚未懒加载成功）：拒绝 PUT，
      // 改为再触发一次懒加载 —— hydration 读失败（'error'）保留标记后，
      // 这里即其重试通道。
      void hydrateSessionFromServer(session.id);
      continue;
    }
    if (state.inflight.has(session.id)) continue;
    // 永久失败 skip：失败时的 updatedAt 未变 → 内容没变，重推必然再失败。
    if (state.permanentFailures.get(session.id) === session.updatedAt) continue;
    candidates.push(session);
  }
  // 串行推送 —— 写路径限流 60/min/user，并发只会更快触顶。
  const batch = candidates.slice(0, MAX_PUTS_PER_FLUSH);
  let progressed = false;
  for (const session of batch) {
    if (await pushSession(session)) progressed = true;
  }
  // 续推接力：被单轮上限截断的会话没有别的触发源（pushSession 只改模块内水位，
  // 不产生任何 React state 变化 → 页面不会再喂快照），不接力就等于首次迁移
  // 只上行前 20 个会话。用页面在推送期间喂进来的新快照优先（避免旧数据倒灌），
  // 没有才用本轮快照。
  // 本轮零进展（全是网络 / 5xx 失败）时不接力 —— 否则服务端持续故障会变成
  // 每 1.5s 一轮的热重试；那种情况等下一次真实状态变化再重试即可。
  if (candidates.length > batch.length && progressed) {
    scheduleAgentSessionSync(state.pendingSnapshot ?? snapshot);
  }
}

/**
 * 推送单个会话。返回「本轮是否取得进展」（同步成功 / 采纳了服务端版本 /
 * 判定为永久失败 —— 三者都让该会话退出候选集），供 flush 决定是否接力续推。
 */
async function pushSession(session: AgentSession): Promise<boolean> {
  const uid = state.userId;
  if (!uid || state.inflight.has(session.id)) return false;
  // 兜底（调用方已过滤，这里再挡一道）：仍待懒加载的会话本地不是权威版本，
  // 绝不 PUT；永久失败且内容未变的会话不重推。
  if (state.serverNewer.has(session.id)) return false;
  if (state.permanentFailures.get(session.id) === session.updatedAt) return false;
  state.inflight.add(session.id);
  try {
    const res = await doFetch(`${API_BASE}/${encodeURIComponent(session.id)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionToWire(session)),
    });
    if (state.userId !== uid) return false;
    if (res.status === 409) {
      // LWW 冲突：data = 服务端完整版本；极端为 null 时 GET 自取。
      const envelope = (await res
        .json()
        .catch(() => null)) as Envelope<AgentSessionWireDetail | null> | null;
      let server = envelope?.data ?? null;
      if (!server) {
        const detail = await fetchSessionDetail(session.id);
        if (detail.status === 'ok') server = detail.session;
      }
      if (state.userId !== uid) return false;
      if (!server) return false;
      return adoptServerVersion(server, { conflict: true });
    }
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        const message = await readEnvelopeMessage(res);
        if (state.userId !== uid) return false;
        return handlePushClientError(session, res.status, message);
      }
      warnOnce('push', new Error(`HTTP ${res.status}`));
      return false;
    }
    state.watermarks.set(session.id, session.updatedAt);
    state.serverNewer.delete(session.id);
    state.permanentFailures.delete(session.id);
    return true;
  } catch (err) {
    warnOnce('push', err);
    return false;
  } finally {
    state.inflight.delete(session.id);
  }
}

/** 数据校验类永久失败的 HTTP 状态 —— 同一内容重推必然再失败：
 *  400 = 服务端校验（id 形态 / mode / 时间戳 / 长度上限…），413 = body 超 4MB，
 *  422 预留。其余 4xx 都可能自行恢复：401 掉登录（重新登录后可用）、403、
 *  404（会话被其他设备删除，下轮 reconcile 收敛）、429 限流。 */
const PERMANENT_PUSH_STATUSES: ReadonlySet<number> = new Set([400, 413, 422]);

/** 会话数配额已满 —— 服务端与数据校验共用 HTTP 400，只能按文案区分
 *  （见 apps/server-go/internal/service/agent_session_service.go：
 *  「会话数量已达上限（500），请删除部分旧对话后重试」）。用户删掉旧会话即可
 *  恢复，绝不能钉成永久失败。注意不能只匹配「上限」—— 消息数 / draft 超长
 *  也用这个词，那些才是真永久失败。后端若补上专用 errorCode 应改判 code。 */
const QUOTA_MESSAGE_PATTERN = /会话数量.*上限|删除部分旧对话/;

/** 推送失败提示的去重 key 前缀（DELETE 成功后按前缀放开重提）。 */
const PUSH_NOTICE_PREFIX = 'push-4xx:';

/** 读 4xx 响应体（服务端统一 R 信封）的 message；缺失 / 非 JSON 返回空串。 */
async function readEnvelopeMessage(res: Response): Promise<string> {
  try {
    const envelope = (await res.json()) as Envelope<unknown> | null;
    return typeof envelope?.message === 'string' ? envelope.message.trim() : '';
  } catch {
    return '';
  }
}

/**
 * PUT 撞 4xx 的处置：判定永久 / 瞬时，透传服务端 message 给用户，返回
 * 「是否取得进展」（永久失败 = 会话退出候选集，算进展；瞬时失败下轮还要重试）。
 */
function handlePushClientError(session: AgentSession, status: number, message: string): boolean {
  const quotaExhausted = QUOTA_MESSAGE_PATTERN.test(message);
  const permanent = PERMANENT_PUSH_STATUSES.has(status) && !quotaExhausted;
  if (permanent) {
    // 按失败时的 updatedAt 记入 skip —— 内容再变（updatedAt bump）才重试。
    state.permanentFailures.set(session.id, session.updatedAt);
  }
  // 提示按「状态码 + 服务端文案」去重：不同失败原因各提示一次（旧实现一个固定
  // key 把配额已满、数据超长全吞成同一条与事实不符的提示），同一原因跨会话仍
  // 只提示一次（20 个会话同因失败不该刷 20 条 toast）。
  noticeOnce(
    `${PUSH_NOTICE_PREFIX}${status}:${message}`,
    pushFailureNotice(status, message, permanent),
  );
  warnOnce(`push-4xx-${status}`, new Error(`HTTP ${status}${message ? ` ${message}` : ''}`));
  return permanent;
}

function pushFailureNotice(status: number, message: string, permanent: boolean): string {
  if (permanent) {
    return message
      ? `云端同步失败：${message}（该对话仅保存在本设备）`
      : '有对话未能同步到云端（数据校验未通过），仅保存在本设备';
  }
  return message
    ? `云端同步暂时失败：${message}（本地已保存，稍后自动重试）`
    : `有对话暂时未能同步到云端（HTTP ${status}），本地已保存，稍后自动重试`;
}

/** GET /:id 的判别式结果 —— 'deleted'（HTTP 404，服务端确已删）必须与
 *  'error'（网络 / 5xx，真相未知）严格区分：只有前者允许清懒加载标记。 */
type SessionDetailResult =
  | { status: 'ok'; session: AgentSessionWireDetail }
  | { status: 'deleted' }
  | { status: 'error' };

async function fetchSessionDetail(id: string): Promise<SessionDetailResult> {
  try {
    const res = await doFetch(`${API_BASE}/${encodeURIComponent(id)}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (res.status === 404) return { status: 'deleted' };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as Envelope<AgentSessionWireDetail>;
    const session = json?.data ?? null;
    // 200 但无 data：协议异常，按 'error' 处理（真相未知，不清标记）。
    if (!session) return { status: 'error' };
    return { status: 'ok', session };
  } catch (err) {
    warnOnce('fetch-detail', err);
    return { status: 'error' };
  }
}

/** 采纳服务端版本；返回是否真的采纳（页面在流式中会拒绝）。 */
function adoptServerVersion(wire: AgentSessionWireDetail, opts: { conflict: boolean }): boolean {
  const session = sessionFromWire(wire);
  const adopted = state.callbacks?.onAdoptServerVersion(session) ?? false;
  if (!adopted) return false; // 流式中拒绝采纳：水位不动，下轮 flush 再冲突再采纳
  state.watermarks.set(session.id, session.updatedAt);
  state.serverNewer.delete(session.id);
  if (opts.conflict && !state.conflictNoticed) {
    state.conflictNoticed = true;
    state.callbacks?.onSyncNotice?.('已同步另一设备的更新');
  }
  return true;
}

/**
 * 会话被激活（含首次挂载的默认激活）。若 reconcile 标记过「服务端较新」，
 * 此刻才真正 GET /:id 拉全量替换本地 —— 懒加载，列表滚动零网络开销。
 */
export function notifyAgentSessionActivated(sessionId: string | null): void {
  state.activeSessionId = sessionId;
  if (!sessionId || !state.userId) return;
  if (!state.serverNewer.has(sessionId)) return;
  void hydrateSessionFromServer(sessionId);
}

/**
 * 该会话是否仍在等待从服务端懒加载全量。标记在场期间本地不是权威版本 ——
 * 页面发消息前先查它：此刻发消息会让空壳/旧壳以更晚 updatedAt 覆盖服务端。
 */
export function isSessionAwaitingHydration(sessionId: string): boolean {
  return state.serverNewer.has(sessionId);
}

/** 手动触发一次懒加载重试（发送前置检查拦下用户后调用，加速恢复）。 */
export function retryAgentSessionHydration(sessionId: string): void {
  if (!state.userId || !state.serverNewer.has(sessionId)) return;
  void hydrateSessionFromServer(sessionId);
}

async function hydrateSessionFromServer(id: string): Promise<void> {
  const uid = state.userId;
  if (!uid || state.inflight.has(id)) return;
  state.inflight.add(id);
  try {
    const result = await fetchSessionDetail(id);
    if (state.userId !== uid) return;
    if (result.status === 'deleted') {
      // 服务端确已删（HTTP 404）：清除懒加载标记，保留本地副本（本地优先）。
      state.serverNewer.delete(id);
      return;
    }
    if (result.status === 'error') {
      // 网络 / 5xx：真相未知，保留 serverNewer 标记待重试（下次激活或 flush
      // 再试）。绝不能在这里清标记 —— 空壳占位一旦被误判为已同步，随后一次
      // 发消息就会以更晚的 updatedAt 通过 LWW 覆盖服务端全量历史。
      return;
    }
    adoptServerVersion(result.session, { conflict: false });
  } finally {
    state.inflight.delete(id);
  }
}

/** 删除会话的云端镜像 —— fire-and-forget，404 / 网络失败一律忽略。
 *  三张 per-session 表（水位 / 懒加载 / 永久失败）必须一起清，漏一张就会让
 *  同 id 会话（如导入旧快照）带着上个生命周期的状态复活。 */
export function deleteAgentSessionRemote(sessionId: string): void {
  state.watermarks.delete(sessionId);
  state.serverNewer.delete(sessionId);
  state.permanentFailures.delete(sessionId);
  if (!state.userId) return;
  const uid = state.userId;
  void doFetch(`${API_BASE}/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
    .then((res) => {
      if (state.userId !== uid) return;
      // 删成功 = 服务端真的少了一个会话（配额腾出一格）：之前因「会话数量已达
      // 上限」等原因失败的会话状态可能已恢复 —— 清空整张永久失败表与推送失败
      // 提示去重，让下一轮 flush 重新尝试并可再次提示。
      // 404（服务端本就没有）不算腾出配额，不做全表放开。
      if (!res.ok) return;
      state.permanentFailures.clear();
      for (const key of [...state.noticed]) {
        if (key.startsWith(PUSH_NOTICE_PREFIX)) state.noticed.delete(key);
      }
    })
    .catch(() => undefined);
}

// ============================================================
// 测试钩子（生产代码不引用）
// ============================================================

/** 注入 fetch mock；传 null 还原为全局 fetch。 */
export function setAgentSessionSyncFetchForTests(impl: FetchLike | null): void {
  fetchOverride = impl;
}

/** 重置全部运行时状态（watermarks / 定时器 / 去重标记）。 */
export function resetAgentSessionSyncForTests(): void {
  clearFlushTimer();
  state = freshState();
  reconcilePromise = null;
}

/** 只读窥视内部状态 —— 断言水位 / 懒加载标记 / 永久失败 skip 用。 */
export function inspectAgentSessionSyncForTests(): {
  watermarks: ReadonlyMap<string, number>;
  serverNewer: ReadonlyMap<string, number>;
  permanentFailures: ReadonlyMap<string, number>;
  reconciled: boolean;
} {
  return {
    watermarks: state.watermarks,
    serverNewer: state.serverNewer,
    permanentFailures: state.permanentFailures,
    reconciled: state.reconciled,
  };
}
