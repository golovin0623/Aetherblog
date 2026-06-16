// 团队聊天前端类型 —— 与后端 dto/chat.go 对齐。

export type ChatKind = 'TEAM' | 'DIRECT' | 'GROUP';
export type SenderType = 'USER' | 'AGENT' | 'SYSTEM';
export type MessageType = 'TEXT' | 'IMAGE' | 'FILE' | 'VOICE' | 'SYSTEM';

export interface ChatMember {
  userId: number;
  username: string;
  nickname?: string;
  avatar?: string;
  memberRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'AGENT';
  muted: boolean;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  senderId?: number;
  senderType: SenderType;
  senderName?: string;
  senderAvatar?: string;
  messageType: MessageType;
  content?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentMime?: string;
  attachmentSize?: number;
  attachmentMeta?: Record<string, unknown>;
  replyToId?: number;
  clientMsgId?: string;
  editedAt?: string;
  createdAt: string;
  /** 仅前端：乐观渲染的本地待确认态。 */
  pending?: boolean;
}

export interface ChatConversation {
  id: number;
  kind: ChatKind;
  teamId?: number;
  title: string;
  lastMessageAt?: string;
  unreadCount: number;
  members?: ChatMember[];
  lastMessage?: ChatMessage;
  createdAt: string;
}

export interface ChatSettings {
  themeSkin: string;
  bubbleStyle: string;
  fontFamily?: string;
  accentColor?: string;
  preferences?: Record<string, unknown>;
}

/** WebSocket 下行事件信封。 */
export interface ChatEvent {
  type: 'message' | 'typing' | 'read' | 'presence' | 'ack' | 'error';
  conversationId?: number;
  payload?: unknown;
}

export interface ChatAgent {
  id: number;
  name: string;
  slug: string;
  avatar?: string;
  description?: string;
  providerCode?: string;
  modelId?: string;
  systemPrompt?: string;
  scope: 'PRIVATE' | 'TEAM' | 'GLOBAL';
  teamId?: number;
  status: 'ACTIVE' | 'DISABLED';
  createdBy?: number;
  canManage: boolean;
  createdAt: string;
}

export interface AttachmentResult {
  url: string;
  name: string;
  size: number;
  mime?: string;
  fileType: string;
  width?: number;
  height?: number;
}
