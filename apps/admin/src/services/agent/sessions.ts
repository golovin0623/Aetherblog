/**
 * Agent 会话本地存储层（admin 端）—— 本地优先架构的第一真值层。
 *
 * 会话与消息存 localStorage，每个用户独立 namespace；UI 的读写只碰本地，
 * 永不等网络（加载即 loadSessions，落盘走 scheduleSaveSessions 节流）。
 *
 * 二期起本模块**不再是唯一真值**：跨设备漫游由同目录 sessionsSync.ts 在后台
 * 与 /api/v1/agent/sessions 对账并整会话 PUT（LWW，网络失败静默重试）。云端是
 * 本地的镜像而非上游 —— 断网仍是完整可用的存储层，页面也不因同步失败而降级。
 *
 * 上行边界（wire 映射见 sessionsSync.ts）：
 *   · titleEdited —— 纯本地标记，不上行（wire 是显式字段构建，天然忽略）；
 *     采纳服务端版本时从本地继承，「手动改名永远赢」；
 *   · draft —— 上行，但采纳服务端版本时保留本地值（用户可能正在输入）；
 *   · attachments[].dataUrl —— 上行剥离（4MB body 上限，服务端不存原图），
 *     回程补空串，刷新后降级为占位卡；
 *   · pending 消息 / pending 翻译 —— 流式中的会话整体不推送，等流结束。
 *
 * namespace 与 blog 端隔离：admin 在自己的 storage key 下写，避免两边混读。
 *
 * 数据形态与 blog 端 agentSessions.ts 对齐：assistant 消息附带流式元数据
 * （思考段、检索回执、模型戳记、翻译、用量），user 消息附带发送时的请求快照
 * 与图片附件，供重试与编辑无损恢复。所有新增字段均可选 —— 旧版 localStorage
 * 快照直接兼容加载。
 */

import type { AgentRetrievalReceipt } from '@aetherblog/agent-kit';
import type { KnowledgeContextSelection } from '../knowledgeWorkspaceHandoff';

export type AgentMode = 'chat' | 'cowork' | 'code';

export interface AgentRequestSnapshotV1 {
  schemaVersion: 1;
  knowledgeContext: KnowledgeContextSelection;
  articleIds: number[] | null;
  tagSlugs: string[] | null;
}

/** 消息内联翻译 —— 由消息操作条的「翻译」触发，流式写入。 */
export interface AgentTranslation {
  /** 目标语言（'en' | 'zh'，按源文本主导语种自动取反）。 */
  lang: 'en' | 'zh';
  content: string;
  pending?: boolean;
  error?: string;
}

/** 单条 assistant 消息的 token 用量。后端不回传时由前端估算，estimated 标记来源。 */
export interface AgentUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
}

/**
 * assistant 消息的单次工具调用轨迹 —— SSE tool_call 到达即建（进行中），
 * 同 id 的 tool_result 到达后合并 result / isError / finishedAt。
 * 数组顺序即服务端执行顺序（协议保证一次 tool_call 后必跟同 id 的 tool_result）。
 */
export interface AgentToolEvent {
  id: string;
  name: string;
  /** 服务端拼装完成的完整 JSON 参数串（展示层再尝试 pretty-print）。 */
  arguments: string;
  /** 工具执行结果（服务端已截断 ≤2000 字符）；undefined = 尚未返回。 */
  result?: string;
  isError?: boolean;
  startedAt: number;
  finishedAt?: number;
}

/**
 * 多模型对比的存档回答 —— 「对比」浮层采纳某一列后，其余完成的列与被替换的
 * 原回答落在这里，随消息持久化 / 云同步，可在消息 meta footer 下方回看。
 */
export interface AgentAlternative {
  /** 产生该回答的模型戳记（null = 后端自动路由）。 */
  modelId: string | null;
  providerCode: string | null;
  content: string;
  usage?: AgentUsage;
  /** 该回答从发起到完成的耗时（毫秒）。 */
  elapsedMs?: number;
}

/** 消息图片附件 —— dataUrl 内联落 localStorage（不走对象存储）；
 *  云同步上行时剥离 dataUrl，跨设备只保留元信息占位卡。 */
export interface AgentAttachment {
  id: string;
  kind: 'image';
  mime: string;
  name: string;
  size: number;
  dataUrl: string;
  width?: number;
  height?: number;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Immutable request scope used to reproduce this user turn on retry. */
  requestSnapshot?: AgentRequestSnapshotV1;
  think?: string;
  sources?: { title: string; slug: string }[];
  retrieval?: AgentRetrievalReceipt;
  /** assistant 消息实际请求的模型戳记（null = 交给后端自动路由）。 */
  modelId?: string | null;
  providerCode?: string | null;
  /** 消息操作条「翻译」的内联结果。 */
  translation?: AgentTranslation;
  /** 本条消息的 token 用量（assistant 消息使用）。 */
  usage?: AgentUsage;
  /** 本轮回答的工具调用轨迹（assistant 消息使用，按执行顺序排列）。 */
  toolEvents?: AgentToolEvent[];
  /** 多模型对比后存档的其他回答（assistant 消息使用，采纳时写入）。 */
  alternatives?: AgentAlternative[];
  /** 本轮 user 消息携带的图片附件。 */
  attachments?: AgentAttachment[];
  createdAt: number;
  pending?: boolean;
  error?: string;
  /** 结构化错误码（如 selected_context_not_grounded）—— 供定向编排。 */
  errorCode?: string;
  /** 服务端标记该错误可重试。 */
  retryable?: boolean;
  startedAt?: number;
  finishedAt?: number;
  firstTokenAt?: number;
}

export type AgentModelParamValue = string | number | boolean | null;

export interface AgentModelParams {
  temperature?: number | null;
  top_p?: number | null;
  max_tokens?: number | null;
  presence_penalty?: number | null;
  frequency_penalty?: number | null;
  reasoning_effort?: string | null;
  [key: string]: AgentModelParamValue | undefined;
}

export interface AgentSession {
  id: string;
  title: string;
  mode: AgentMode;
  modelId?: string | null;
  providerCode?: string | null;
  modelParams?: AgentModelParams;
  /** 未发送的输入框文本。可选 —— 该字段之前存下的会话仍能直接加载。
   *  上行云端，但采纳服务端版本时永远保留本地值（用户可能正在输入）。 */
  draft?: string;
  /** 置顶 —— 侧栏排序时优先于时间分组。 */
  pinned?: boolean;
  /** 上下文断点：该 id 的消息（含）之前的历史不再随请求发送。
   *  null/undefined = 无断点。对齐 Cherry Studio「清除上下文」心智：
   *  消息仍在、可回看，但模型从断点后重新开始记忆。 */
  contextBreakId?: string | null;
  /** 用户手动改过标题 —— AI 自动起名不再覆盖。
   *  本地字段：云同步 wire 映射是显式字段构建，天然忽略它（跨设备不持久化
   *  属已知边界——其他设备最多多做一次无害的自动起名尝试）。 */
  titleEdited?: boolean;
  createdAt: number;
  updatedAt: number;
  messages: AgentMessage[];
}

const STORAGE_KEY_PREFIX = 'aetherblog.admin.agent.sessions';

function storageKey(userId: number | string): string {
  return `${STORAGE_KEY_PREFIX}.${userId}`;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as T;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadSessions(userId: number | string): AgentSession[] {
  if (typeof window === 'undefined') return [];
  const list = safeParse<AgentSession[]>(localStorage.getItem(storageKey(userId)), []);
  if (!Array.isArray(list)) return [];
  // 加载期收敛：页面在流式中途被关闭时，pending 消息 / pending 翻译会连同
  // 状态一起持久化 —— 重载后没有任何流会续写它们，若不收敛就永远卡在
  // "正在生成/翻译中"。统一定格为"已中断"，已收到的内容原样保留。
  return list.map((s) => {
    if (!Array.isArray(s.messages)) return { ...s, messages: [] };
    const needsFix = s.messages.some((m) => m.pending || m.translation?.pending);
    if (!needsFix) return s;
    return {
      ...s,
      messages: s.messages.map((m) => {
        if (!m.pending && !m.translation?.pending) return m;
        const fixed: AgentMessage = { ...m };
        if (fixed.pending) {
          fixed.pending = false;
          fixed.error = fixed.error || '已中断（页面关闭）';
          fixed.finishedAt = fixed.finishedAt ?? s.updatedAt;
        }
        if (fixed.translation?.pending) {
          fixed.translation = fixed.translation.content
            ? { ...fixed.translation, pending: false, error: '翻译已中断' }
            : undefined;
        }
        return fixed;
      }),
    };
  });
}

/** quota 失败只 warn 一次 —— 流式期间每 800ms 会重试落盘，逐次告警等于刷屏。 */
let quotaWarned = false;

function persistNow(userId: number | string, sessions: AgentSession[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(sessions));
  } catch (err) {
    // quota / private mode：下次 reload 拿到的是上次成功的快照。完全静默会让
    // "会话怎么没存住"变成不可诊断的幽灵问题，这里去重后 warn 一次留痕。
    if (!quotaWarned) {
      quotaWarned = true;
      console.warn('[agent/sessions] 会话持久化失败（localStorage 配额或隐私模式），新增内容将不会被保存', err);
    }
  }
}

export function saveSessions(userId: number | string, sessions: AgentSession[]) {
  if (typeof window === 'undefined') return;
  // 立即写入即最新真值 —— 丢弃在途的节流快照，避免旧数据在定时器触发时倒灌。
  clearPendingSave();
  persistNow(userId, sessions);
}

const SAVE_THROTTLE_MS = 800;

interface PendingSave {
  userId: number | string;
  sessions: AgentSession[];
}

let pendingSave: PendingSave | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let flushListenersRegistered = false;

function clearPendingSave() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingSave = null;
}

function registerFlushListeners() {
  if (flushListenersRegistered || typeof window === 'undefined') return;
  flushListenersRegistered = true;
  // pagehide 覆盖关页/跳转；visibilitychange(hidden) 覆盖移动端切后台被杀 ——
  // 两者都可能是页面生命的最后时刻，必须把在途快照强制落盘。
  window.addEventListener('pagehide', flushSaveSessions);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSaveSessions();
    });
  }
}

/** 流式期间每个 delta 都会触发 sessions 变化 —— 直接落盘等于每秒几十次全量
 *  JSON.stringify。这里做尾沿节流：写请求合并，至多每 800ms 真实落盘一次，
 *  并在 pagehide/visibilitychange(hidden) 时强制 flush，保证关页不丢。 */
export function scheduleSaveSessions(userId: number | string, sessions: AgentSession[]): void {
  if (typeof window === 'undefined') return;
  registerFlushListeners();
  pendingSave = { userId, sessions };
  if (saveTimer !== null) return; // 定时器在途：只更新待写快照，落盘时取最新值
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const p = pendingSave;
    pendingSave = null;
    if (p) persistNow(p.userId, p.sessions);
  }, SAVE_THROTTLE_MS);
}

/** 立即把在途的节流快照落盘（无在途快照时为 no-op）。 */
export function flushSaveSessions(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const p = pendingSave;
  pendingSave = null;
  if (p) persistNow(p.userId, p.sessions);
}

export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function readAgentSessionDraft(session: AgentSession | null | undefined): string {
  return typeof session?.draft === 'string' ? session.draft : '';
}

/** Preserve composer text without changing recency or reordering the session list. */
export function withAgentSessionDraft(session: AgentSession, draft: string): AgentSession {
  return session.draft === draft ? session : { ...session, draft };
}

export function resolveAgentSessionDraftAfterRequestStart(
  session: AgentSession,
  replayingHistory: boolean,
): string {
  return replayingHistory ? readAgentSessionDraft(session) : '';
}

export function deriveSessionTitle(firstMessage: string): string {
  const trimmed = firstMessage.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()} 新对话`;
  }
  if (trimmed.length <= 24) return trimmed;
  return `${trimmed.slice(0, 24)}…`;
}

/** 模型爱加的首尾包装字符（引号 / 书名号 / 括号）。 */
const TITLE_WRAPPER_EDGE_RE = /^[\s"'“”‘’「」『』《》【】()（）]+|[\s"'“”‘’「」『』《》【】()（）]+$/g;
/** 收尾句读。 */
const TITLE_TRAILING_PUNCT_RE = /[。．.!！?？~～、，,;；:：]+$/g;

/**
 * 清洗 AI 生成的会话标题 —— 模型偶尔会带引号 / 书名号 / 收尾句号 / 换行，
 * 全部剥掉后截 24 字（与 deriveSessionTitle 的截断上限一致，但不加省略号）。
 * 清洗后为空返回 ''，调用方据此放弃写入。
 */
export function sanitizeGeneratedSessionTitle(raw: string): string {
  // 换行与连续空白折叠为单空格
  let title = raw.replace(/\s+/g, ' ').trim();
  // 包装字符与收尾句读可能交替嵌套（《标题》。 / "标题"。）—— 剥到稳定为止：
  // 只剥一趟时标点落在包装外，会留下半个书名号 / 引号。
  for (;;) {
    const before = title;
    title = title.replace(TITLE_WRAPPER_EDGE_RE, '');
    title = title.replace(TITLE_TRAILING_PUNCT_RE, '').trim();
    if (title === before) break; // 替换只会缩短，必然收敛
  }
  if (!title) return '';
  return title.length > 24 ? title.slice(0, 24) : title;
}

export interface SessionGroup {
  label: string;
  sessions: AgentSession[];
}

export const PINNED_GROUP_LABEL = '置顶';

/**
 * 把会话按 updatedAt 分组成"置顶 / 今天 / 昨天 / 本周 / 更早"，方便侧栏直接渲染。
 * 置顶组永远排在时间分组之前，组内仍按 updatedAt 倒序。
 */
export function groupSessionsByRecency(sessions: AgentSession[]): SessionGroup[] {
  if (sessions.length === 0) return [];
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  const pinned = sorted.filter((s) => s.pinned);
  const rest = sorted.filter((s) => !s.pinned);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

  const groups: Record<string, AgentSession[]> = {
    今天: [],
    昨天: [],
    本周: [],
    更早: [],
  };

  for (const s of rest) {
    if (s.updatedAt >= startOfToday) groups['今天'].push(s);
    else if (s.updatedAt >= startOfYesterday) groups['昨天'].push(s);
    else if (s.updatedAt >= startOfWeek) groups['本周'].push(s);
    else groups['更早'].push(s);
  }

  const timeGroups = Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, sessions: list }));

  return pinned.length > 0
    ? [{ label: PINNED_GROUP_LABEL, sessions: pinned }, ...timeGroups]
    : timeGroups;
}

/**
 * 侧栏搜索匹配 —— 标题命中或任意消息正文命中（大小写不敏感）。
 * 对齐 ChatGPT / LobeHub 的"搜索历史对话内容"能力。
 */
export function sessionMatchesQuery(session: AgentSession, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  if (session.title.toLowerCase().includes(normalizedQuery)) return true;
  return session.messages.some((m) => m.content.toLowerCase().includes(normalizedQuery));
}

/**
 * 上下文断点切片 —— 返回将随下一轮请求发送的历史消息。
 * contextBreakId 指向"断点之前的最后一条消息"；找不到（消息被删/截断）时
 * 视为无断点，发送全部历史。
 */
export function sliceContextMessages(
  messages: AgentMessage[],
  contextBreakId: string | null | undefined,
): AgentMessage[] {
  if (!contextBreakId) return messages;
  const idx = messages.findIndex((m) => m.id === contextBreakId);
  if (idx < 0) return messages;
  return messages.slice(idx + 1);
}

/** 断点在截断/删除后可能悬空 —— 持久化前归一化，悬空时清除。 */
export function normalizeContextBreak(
  messages: AgentMessage[],
  contextBreakId: string | null | undefined,
): string | null {
  if (!contextBreakId) return null;
  return messages.some((m) => m.id === contextBreakId) ? contextBreakId : null;
}

/**
 * 会话导出为 Markdown —— 供「导出对话」下载。正文原样保留（本就是 markdown），
 * 思考过程收进 <details>，检索命中以脚注列表附在对应回复之后。
 */
export function sessionToMarkdown(session: AgentSession): string {
  const lines: string[] = [];
  const fmt = (ts: number) =>
    new Date(ts).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  lines.push(`# ${session.title}`);
  lines.push('');
  lines.push(
    `> 导出自 灵境 AI 工作台（后台） · ${fmt(session.createdAt)} 创建 · ${session.messages.length} 条消息`,
  );
  lines.push('');

  for (const m of session.messages) {
    lines.push('---');
    lines.push('');
    lines.push(`## ${m.role === 'user' ? '⟡ 我' : '✦ 灵境'} · ${fmt(m.createdAt)}`);
    lines.push('');
    if (m.role === 'assistant' && m.think?.trim()) {
      lines.push('<details><summary>思考过程</summary>');
      lines.push('');
      lines.push(m.think.trim());
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
    lines.push(m.content || (m.error ? `*（${m.error}）*` : '*（空）*'));
    lines.push('');
    if (m.retrieval && m.retrieval.hits.length > 0) {
      lines.push('**知识来源：**');
      lines.push('');
      for (const hit of m.retrieval.hits) {
        const label = hit.sourceTitle && hit.sourceTitle !== hit.title
          ? `${hit.title} — ${hit.sourceTitle}`
          : hit.title;
        lines.push(hit.href ? `${hit.rank}. [${label}](${hit.href})` : `${hit.rank}. ${label}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** 导出文件名（跨平台安全字符）。 */
export function exportFileName(session: AgentSession): string {
  const safeTitle = session.title.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'conversation';
  const d = new Date(session.updatedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  return `lingjing-${safeTitle}-${stamp}.md`;
}

export function createEmptySession(mode: AgentMode = 'chat'): AgentSession {
  const now = Date.now();
  return {
    id: newSessionId(),
    title: '新对话',
    mode,
    modelId: null,
    providerCode: null,
    draft: '',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}
