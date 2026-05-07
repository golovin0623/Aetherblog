/**
 * Agent 会话本地存储层（admin 端）
 *
 * MVP：会话与消息存 localStorage，每个用户独立 namespace。后续上 DB 时把
 * load/saveSessions 替换为 /api/v1/agent/sessions REST 即可。
 *
 * namespace 与 blog 端隔离：admin 在自己的 storage key 下写，避免两边混读。
 */

export type AgentMode = 'chat' | 'cowork' | 'code';

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  think?: string;
  sources?: { title: string; slug: string }[];
  createdAt: number;
  pending?: boolean;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  firstTokenAt?: number;
}

export interface AgentSession {
  id: string;
  title: string;
  mode: AgentMode;
  modelId?: string | null;
  providerCode?: string | null;
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
  return Array.isArray(list) ? list : [];
}

export function saveSessions(userId: number | string, sessions: AgentSession[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(sessions));
  } catch {
    /* quota / private mode 静默失败 */
  }
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

export function deriveSessionTitle(firstMessage: string): string {
  const trimmed = firstMessage.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()} 新对话`;
  }
  if (trimmed.length <= 24) return trimmed;
  return `${trimmed.slice(0, 24)}…`;
}

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

export function createEmptySession(mode: AgentMode = 'chat'): AgentSession {
  const now = Date.now();
  return {
    id: newSessionId(),
    title: '新对话',
    mode,
    modelId: null,
    providerCode: null,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}
