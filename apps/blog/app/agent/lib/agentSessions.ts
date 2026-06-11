'use client';

import type { AgentArticle, AgentTag } from './agentResources';

/**
 * Agent 会话本地存储层
 *
 * MVP 不上 DB —— 会话与消息直接存 localStorage，每个用户独立 namespace。
 * 后续若要跨设备同步，把 read/write 替换为后端 `/api/v1/agent/sessions` REST
 * 即可（接口已预留）。
 *
 * 数据形态：每条消息有 role / content / 时间戳，sources 可选用于 RAG 引用展示。
 */

export type AgentMode = 'chat' | 'cowork' | 'code';

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 本轮 user 消息显式绑定的文章上下文。重试/编辑时用它恢复请求上下文。 */
  contextArticles?: AgentArticle[];
  /** 本轮 user 消息显式绑定的标签上下文。重试/编辑时用它恢复请求上下文。 */
  contextTags?: AgentTag[];
  /** 模型流式返回的"思考过程"段，可折叠展示。 */
  think?: string;
  /** RAG 引用源 —— 由后端 SSE `sources` 事件填充。 */
  sources?: { title: string; slug: string }[];
  createdAt: number;
  /** 标记是否还在 streaming（最后一条 assistant 消息）。 */
  pending?: boolean;
  /** 错误状态：若 SSE 异常打断，记录原因。 */
  error?: string;
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
  return Array.isArray(list) ? list : [];
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
 * 把会话按 updatedAt 分组成"今天 / 昨天 / 更早"，方便侧栏直接渲染。
 */
export interface SessionGroup {
  label: string;
  sessions: AgentSession[];
}

export function groupSessionsByRecency(sessions: AgentSession[]): SessionGroup[] {
  if (sessions.length === 0) return [];
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

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

  for (const s of sorted) {
    if (s.updatedAt >= startOfToday) groups['今天'].push(s);
    else if (s.updatedAt >= startOfYesterday) groups['昨天'].push(s);
    else if (s.updatedAt >= startOfWeek) groups['本周'].push(s);
    else groups['更早'].push(s);
  }

  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, sessions: list }));
}
