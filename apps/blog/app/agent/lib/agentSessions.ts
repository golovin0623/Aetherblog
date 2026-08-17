'use client';

import type { AgentArticle, AgentTag } from './agentResources';
import type { AgentKbRef } from './agentKbs';
import type { AgentRetrievalReceipt, KnowledgeContextMode } from './agentChatStream';

/**
 * Agent 会话本地存储层
 *
 * MVP 不上 DB —— 会话与消息直接存 localStorage，每个用户独立 namespace。
 * 后续若要跨设备同步，把 read/write 替换为后端 `/api/v1/agent/sessions` REST
 * 即可（接口已预留）。
 *
 * 数据形态：每条消息有 role / content / 时间戳；assistant 消息附带流式元数据
 * （思考段、检索回执、模型戳记、翻译），user 消息附带发送时的显式上下文快照
 * （文章 / 标签 / 知识库），供重试与编辑无损恢复。所有新增字段均可选 ——
 * 旧版 localStorage 快照直接兼容加载。
 */

export type AgentMode = 'chat' | 'cowork' | 'code';

/** 消息内联翻译 —— 由消息操作条的「翻译」触发，流式写入。 */
export interface AgentTranslation {
  /** 目标语言（'en' | 'zh'，按源文本主导语种自动取反）。 */
  lang: 'en' | 'zh';
  content: string;
  pending?: boolean;
  error?: string;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 本轮 user 消息显式绑定的文章上下文。重试/编辑时用它恢复请求上下文。 */
  contextArticles?: AgentArticle[];
  /** 本轮 user 消息显式绑定的标签上下文。重试/编辑时用它恢复请求上下文。 */
  contextTags?: AgentTag[];
  /** 本轮 user 消息显式绑定的知识库上下文（轻量引用）。 */
  contextKbs?: AgentKbRef[];
  /** 本轮 user 消息的知识检索模式快照。 */
  knowledgeMode?: KnowledgeContextMode;
  /** 模型流式返回的"思考过程"段，可折叠展示。 */
  think?: string;
  /** RAG 引用源 —— 旧版 SSE `sources` 事件填充（已废弃但保留渲染兼容）。 */
  sources?: { title: string; slug: string }[];
  /** 知识检索回执 —— SSE `retrieval` 事件（正文开始前一次性发出）。 */
  retrieval?: AgentRetrievalReceipt;
  /** assistant 消息实际请求的模型戳记（null = 交给后端自动路由）。 */
  modelId?: string | null;
  providerCode?: string | null;
  /** 消息操作条「翻译」的内联结果。 */
  translation?: AgentTranslation;
  createdAt: number;
  /** 标记是否还在 streaming（最后一条 assistant 消息）。 */
  pending?: boolean;
  /** 错误状态：若 SSE 异常打断，记录原因。 */
  error?: string;
  /** 结构化错误码（如 selected_context_not_grounded）—— 供定向编排。 */
  errorCode?: string;
  /** 服务端标记该错误可重试。 */
  retryable?: boolean;
  /** 流式开始（=请求发出）时间戳。仅 assistant 消息使用，配合 finishedAt
   *  渲染 "已深度思考 · X.Xs" 这条状态行。 */
  startedAt?: number;
  /** 流式结束（done / error / abort）时间戳。 */
  finishedAt?: number;
  /** 接收到第一个 delta 的时间戳，用于区分"在思考"vs"在生成"两阶段。 */
  firstTokenAt?: number;
}

export interface AgentSession {
  id: string;
  title: string;
  mode: AgentMode;
  /** 用户在 ModelPicker 选中的模型；null 表示由后端按任务路由自动决定。 */
  modelId?: string | null;
  providerCode?: string | null;
  /** 会话级显式引用上下文。发送后继续保留，直到用户手动移除或切换会话。 */
  contextArticles?: AgentArticle[];
  contextTags?: AgentTag[];
  /** 会话级知识库选择（selected 模式的 KB 列表）。 */
  contextKbs?: AgentKbRef[];
  /** 知识检索模式：auto（默认，后端自动发现）/ selected / none。 */
  knowledgeMode?: KnowledgeContextMode;
  /** 置顶 —— 侧栏排序时优先于时间分组。 */
  pinned?: boolean;
  /** 上下文断点：该 id 的消息（含）之前的历史不再随请求发送。
   *  null/undefined = 无断点。对齐 Cherry Studio「清除上下文」心智：
   *  消息仍在、可回看，但模型从断点后重新开始记忆。 */
  contextBreakId?: string | null;
  createdAt: number;
  updatedAt: number;
  messages: AgentMessage[];
}

const STORAGE_KEY_PREFIX = 'aetherblog.agent.sessions';

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

export function saveSessions(userId: number | string, sessions: AgentSession[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(sessions));
  } catch {
    /* quota / private mode 时静默失败，下次 reload 会拿到上次成功的快照 */
  }
}

export function newSessionId(): string {
  // crypto.randomUUID 在所有目标浏览器（含 Safari ≥ 15.4）都可用，无需 polyfill。
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 取消息内容里的前 32 字作为会话标题。空 / 太长时给个时间默认。
 */
export function deriveSessionTitle(firstMessage: string): string {
  const trimmed = firstMessage.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()} 新对话`;
  }
  if (trimmed.length <= 24) return trimmed;
  return `${trimmed.slice(0, 24)}…`;
}

/**
 * 把会话按 updatedAt 分组成"置顶 / 今天 / 昨天 / 本周 / 更早"，方便侧栏直接渲染。
 */
export interface SessionGroup {
  label: string;
  sessions: AgentSession[];
}

export const PINNED_GROUP_LABEL = '置顶';

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
    `> 导出自 灵境 AI 工作台 · ${fmt(session.createdAt)} 创建 · ${session.messages.length} 条消息`,
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
