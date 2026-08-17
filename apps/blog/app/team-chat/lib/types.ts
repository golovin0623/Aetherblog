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
  /** 该成员的已读位点（消息 id），用于渲染 ✓✓ 已读回执。 */
  lastReadMessageId?: number;
}

/** 私聊选人搜索结果（GET /dm-targets，已按 chat_dm_scope 策略过滤）。 */
export interface ChatDMTarget {
  userId: number;
  username: string;
  nickname?: string;
  avatar?: string;
}

/** 「我的团队」条目（GET /teams），群聊入口直接点选。 */
export interface ChatMyTeam {
  teamId: number;
  name: string;
  memberCount: number;
}

/** 单条消息上同一表情的聚合回应。 */
export interface ChatReaction {
  emoji: string;
  userIds: number[];
}

/** 被引用消息的预览快照 —— 引用可能落在已加载历史页之外，快照兜底渲染。 */
export interface ChatReplyPreview {
  senderName: string;
  messageType: MessageType;
  content?: string;
  recalled?: boolean;
  sticker?: boolean;
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
  /** 被引用消息快照（服务端 join 下发），跨历史页兜底。 */
  replyPreview?: ChatReplyPreview;
  clientMsgId?: string;
  /** @提及的用户 id 集合（仅会话成员，服务端过滤）。 */
  mentions?: number[];
  /** 表情回应聚合。 */
  reactions?: ChatReaction[];
  editedAt?: string;
  /** 软撤回时间：非空则渲染「已撤回」占位行。 */
  recalledAt?: string;
  createdAt: string;
  /** 仅前端：乐观渲染的本地待确认态。 */
  pending?: boolean;
  /** 仅前端：发送失败，等待重试。 */
  failed?: boolean;
  /** 仅前端：本人撤回后本地保留的原文，供「重新编辑」（刷新即失，微信同款语义）。 */
  localOrigText?: string;
}

export interface ChatConversation {
  id: number;
  kind: ChatKind;
  teamId?: number;
  title: string;
  lastMessageAt?: string;
  unreadCount: number;
  /** 未读中 @我 的条数 —— 红色 @ 徽标，穿透免打扰。 */
  mentionCount: number;
  /** 当前用户是否置顶该会话。 */
  pinned: boolean;
  /** 当前用户是否对该会话免打扰（灰点代替计数，提示链 L4/L5 静默）。 */
  muted: boolean;
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
  type: 'message' | 'message-updated' | 'reaction' | 'typing' | 'read' | 'presence' | 'ack' | 'error';
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
