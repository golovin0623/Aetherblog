'use client';

import type {
  AttachmentResult,
  ChatConversation,
  ChatMember,
  ChatMessage,
  ChatSettings,
} from './types';

/**
 * 团队聊天 REST 客户端 —— 复用后端 `/api/v1/chat/*`，凭据走同源 HttpOnly Cookie。
 *
 * 实时消息走 WebSocket（见 useChatSocket）；这里的 REST 负责会话列表、历史分页、
 * 发送兜底、附件上传与皮肤偏好。所有响应遵循统一信封 { code, data, message }。
 */

interface Envelope<T> {
  code?: number;
  data?: T;
  message?: string;
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const json = (await res.json()) as Envelope<unknown>;
      if (json?.message) msg = json.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const json = (await res.json()) as Envelope<T>;
  return json.data as T;
}

function get<T>(path: string): Promise<T> {
  return fetch(`/api/v1/chat${path}`, {
    credentials: 'include',
    cache: 'no-store',
  }).then((r) => unwrap<T>(r));
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return fetch(`/api/v1/chat${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => unwrap<T>(r));
}

export const chatApi = {
  listConversations: () => get<ChatConversation[]>('/conversations'),

  openDirect: (userId: number) =>
    post<ChatConversation>('/conversations/direct', { userId }),

  openTeam: (teamId: number) =>
    post<ChatConversation>(`/conversations/team/${teamId}`),

  getHistory: (conversationId: number, before?: number, limit = 30) => {
    const q = new URLSearchParams();
    if (before) q.set('before', String(before));
    q.set('limit', String(limit));
    return get<ChatMessage[]>(`/conversations/${conversationId}/messages?${q}`);
  },

  sendMessage: (
    conversationId: number,
    body: {
      messageType?: string;
      content?: string;
      attachmentUrl?: string;
      attachmentName?: string;
      attachmentMime?: string;
      attachmentSize?: number;
      attachmentMeta?: Record<string, unknown>;
      replyToId?: number;
      clientMsgId?: string;
    },
  ) => post<ChatMessage>(`/conversations/${conversationId}/messages`, body),

  markRead: (conversationId: number, messageId: number) =>
    post<void>(`/conversations/${conversationId}/read`, { messageId }),

  getMembers: (conversationId: number) =>
    get<ChatMember[]>(`/conversations/${conversationId}/members`),

  getSettings: () => get<ChatSettings>('/settings'),

  updateSettings: (body: Partial<ChatSettings>) =>
    fetch('/api/v1/chat/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => unwrap<ChatSettings>(r)),

  uploadAttachment: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/v1/chat/attachments', {
      method: 'POST',
      credentials: 'include',
      body: fd,
    }).then((r) => unwrap<AttachmentResult>(r));
  },
};
