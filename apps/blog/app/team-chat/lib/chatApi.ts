'use client';

import type {
  AttachmentResult,
  ChatAgent,
  ChatConversation,
  ChatMember,
  ChatMessage,
  ChatReaction,
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
      mentions?: number[];
    },
  ) => post<ChatMessage>(`/conversations/${conversationId}/messages`, body),

  /** 编辑本人文本消息（服务端 2 分钟窗口校验；mentions 随新文本覆盖），成功后 WS 广播 message-updated。 */
  editMessage: (conversationId: number, messageId: number, content: string, mentions?: number[]) =>
    fetch(`/api/v1/chat/conversations/${conversationId}/messages/${messageId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, mentions: mentions?.length ? mentions : undefined }),
    }).then((r) => unwrap<ChatMessage>(r)),

  /** 软撤回本人消息（2 分钟窗口），行保留为「已撤回」占位。 */
  recallMessage: (conversationId: number, messageId: number) =>
    fetch(`/api/v1/chat/conversations/${conversationId}/messages/${messageId}`, {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => unwrap<ChatMessage>(r)),

  /** 添加表情回应，返回该消息最新聚合。 */
  addReaction: (conversationId: number, messageId: number, emoji: string) =>
    post<{ messageId: number; reactions: ChatReaction[] }>(
      `/conversations/${conversationId}/messages/${messageId}/reactions`,
      { emoji },
    ),

  /** 移除本人表情回应，返回该消息最新聚合。 */
  removeReaction: (conversationId: number, messageId: number, emoji: string) =>
    fetch(`/api/v1/chat/conversations/${conversationId}/messages/${messageId}/reactions`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    }).then((r) => unwrap<{ messageId: number; reactions: ChatReaction[] }>(r)),

  /** 更新会话偏好（置顶 / 免打扰），只影响本人视图。 */
  updateConvPrefs: (conversationId: number, body: { pinned?: boolean; muted?: boolean }) =>
    fetch(`/api/v1/chat/conversations/${conversationId}/prefs`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => unwrap<{ pinned: boolean; muted: boolean }>(r)),

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

  /**
   * 带进度的附件上传（图片托盘进度环）。fetch 拿不到上行进度，这里用 XHR 的
   * upload.onprogress 驱动；响应仍遵循统一信封 { code, data, message }。
   */
  uploadAttachmentWithProgress: (
    file: File | Blob,
    fileName: string,
    onProgress: (percent: number) => void,
  ): Promise<AttachmentResult> =>
    new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('file', file, fileName);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/v1/chat/attachments');
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText) as { data?: AttachmentResult; message?: string };
          if (xhr.status >= 200 && xhr.status < 300 && json.data) resolve(json.data);
          else reject(new Error(json.message || `上传失败 (${xhr.status})`));
        } catch {
          reject(new Error(`上传失败 (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error('网络错误，上传失败'));
      xhr.send(fd);
    }),

  // --- Phase 2: Agent 纳入与管理 ---

  listAgents: () => get<ChatAgent[]>('/agents'),

  createAgent: (body: {
    name: string;
    avatar?: string;
    description?: string;
    scope?: 'PRIVATE' | 'TEAM' | 'GLOBAL';
    teamId?: number;
    providerCode?: string;
    modelId?: string;
    systemPrompt?: string;
  }) => post<ChatAgent>('/agents', body),

  deleteAgent: (agentId: number) =>
    fetch(`/api/v1/chat/agents/${agentId}`, {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => unwrap<void>(r)),

  listConversationAgents: (conversationId: number) =>
    get<ChatAgent[]>(`/conversations/${conversationId}/agents`),

  seatAgent: (conversationId: number, agentId: number) =>
    post<ChatAgent>(`/conversations/${conversationId}/agents`, { agentId }),

  unseatAgent: (conversationId: number, agentId: number) =>
    fetch(`/api/v1/chat/conversations/${conversationId}/agents/${agentId}`, {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => unwrap<void>(r)),

  postAgentMessage: (conversationId: number, agentId: number, content: string, clientMsgId?: string) =>
    post<ChatMessage>(`/conversations/${conversationId}/agents/${agentId}/messages`, {
      content,
      clientMsgId,
    }),
};
