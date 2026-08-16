'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  ChevronLeft,
  Copy,
  CornerUpLeft,
  Hash,
  MessageCircle,
  MessageSquarePlus,
  MessagesSquare,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  Search,
  Trash2,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Avatar, spring, transition } from '@aetherblog/ui';
import { sanitizeUrl } from '@/app/lib/sanitizeUrl';
import { useAgentAuth } from '../agent/lib/agentAuth';
import { chatApi } from './lib/chatApi';
import { newClientId } from './lib/ids';
import { useChatSocket } from './lib/useChatSocket';
import type {
  ChatAgent,
  ChatConversation,
  ChatEvent,
  ChatMessage,
  ChatReaction,
  ChatSettings,
} from './lib/types';
import type { PreparedImage } from './lib/imagePipeline';
import { isStickerMeta, stickerUrl } from './lib/stickers';
import { getSoundEnabled, playDing, setSoundEnabled } from './lib/sound';
import ConversationList from './components/ConversationList';
import MessageThread, { messageSummary } from './components/MessageThread';
import Composer, { type ComposerHandle } from './components/Composer';
import AgentBar from './components/AgentBar';
import NewConversationModal from './components/NewConversationModal';
import ContactsView from './components/ContactsView';
import InfoPanel from './components/InfoPanel';
import Lightbox from './components/Lightbox';
import MessageContextMenu, { type MenuState } from './components/MessageContextMenu';

const DEFAULT_SETTINGS: ChatSettings = { themeSkin: 'aurora', bubbleStyle: 'rounded' };
/** 编辑 / 撤回窗口（与服务端 SQL 校验一致），超窗的菜单项直接不显示。 */
const EDIT_WINDOW_MS = 2 * 60 * 1000;

interface ToastItem {
  id: number;
  convId: number;
  title: string;
  body: string;
  avatar?: string;
  fallback: string;
}

type ListTab = 'chats' | 'contacts';
type ListFilter = 'all' | 'unread' | 'mention';

export default function TeamChatClient() {
  const { state: auth } = useAgentAuth();
  const currentUserId = auth.status === 'authed' ? auth.user.id : 0;

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_SETTINGS);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<number>>(new Set());
  // conversationId -> (userId -> 过期时间戳)，到点自动清除「正在输入」。
  const [typingByConv, setTypingByConv] = useState<Map<number, Map<number, number>>>(new Map());

  // UI 态。
  const [tab, setTab] = useState<ListTab>('chats');
  const [filter, setFilter] = useState<ListFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list');
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<number | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [dragOver, setDragOver] = useState(false);
  const [agents, setAgents] = useState<ChatAgent[]>([]);
  const [convAgents, setConvAgents] = useState<ChatAgent[]>([]);

  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;
  const composerRef = useRef<ComposerHandle | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const draftsRef = useRef<Map<number, string>>(new Map());
  const [draftsVersion, setDraftsVersion] = useState(0);
  const toastIdRef = useRef(1);
  const dragDepth = useRef(0);
  const titleTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSoundOn(getSoundEnabled());
    if (typeof Notification !== 'undefined') setNotifPerm(Notification.permission);
  }, []);

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );

  // --- 会话列表 ---
  const refreshConversations = useCallback(async () => {
    try {
      const list = await chatApi.listConversations();
      setConversations(list);
    } catch {
      /* ignore */
    }
  }, []);

  // --- 消息本地更新工具 ---
  const patchMessage = useCallback((msgId: number, patch: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? patch(m) : m)));
  }, []);

  // --- 提示链（L4 页内 Toast / L5 标题闪烁 + 系统通知 + 声音） ---
  const flashTitle = useCallback((count: number) => {
    if (typeof document === 'undefined') return;
    if (titleTimer.current) clearInterval(titleTimer.current);
    const base = document.title.replace(/^\(\d+\) 新消息 · /, '');
    let flip = false;
    let ticks = 0;
    titleTimer.current = setInterval(() => {
      document.title = flip ? base : `(${count}) 新消息 · ${base}`;
      flip = !flip;
      ticks += 1;
      if (ticks > 6 || !document.hidden) {
        if (titleTimer.current) clearInterval(titleTimer.current);
        document.title = base;
      }
    }, 900);
  }, []);

  const pushToast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = toastIdRef.current++;
    setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 5000);
  }, []);

  const notifyIncoming = useCallback(
    (msg: ChatMessage) => {
      const conv = conversations.find((c) => c.id === msg.conversationId);
      const mentioned = !!msg.mentions?.includes(currentUserId);
      // 免打扰会话静默（@我 穿透 —— §6 打扰红线）。
      if (conv?.muted && !mentioned) return;
      const title = msg.senderName || conv?.title || '新消息';
      const body = messageSummary(msg);
      if (soundOn) playDing();
      if (typeof document !== 'undefined' && document.hidden) {
        flashTitle(1);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            const n = new Notification(`${title} · ${conv?.title || '对话'}`, { body, tag: `chat-${msg.conversationId}` });
            n.onclick = () => window.focus();
          } catch {
            /* ignore */
          }
        }
        return;
      }
      // 页面可见但会话不活跃 → 页内 Toast。
      if (msg.conversationId !== activeIdRef.current) {
        pushToast({
          convId: msg.conversationId,
          title: conv && conv.kind !== 'DIRECT' ? `${title} · ${conv.title}` : title,
          body: mentioned ? `@你 ${body}` : body,
          avatar: msg.senderAvatar,
          fallback: title,
        });
      }
    },
    [conversations, currentUserId, soundOn, flashTitle, pushToast],
  );

  // --- 下行事件处理 ---
  const handleEvent = useCallback(
    (ev: ChatEvent) => {
      switch (ev.type) {
        case 'message': {
          const msg = ev.payload as ChatMessage;
          if (msg.conversationId === activeIdRef.current) {
            setMessages((prev) => mergeMessage(prev, msg));
            if (msg.senderId !== currentUserId) {
              void chatApi.markRead(msg.conversationId, msg.id).catch(() => {});
            }
          }
          if (msg.senderId !== currentUserId) notifyIncoming(msg);
          void refreshConversations();
          break;
        }
        case 'message-updated': {
          // 编辑 / 撤回：整条替换（保留本地 localOrigText 供「重新编辑」）。
          const msg = ev.payload as ChatMessage;
          if (msg.conversationId === activeIdRef.current) {
            setMessages((prev) =>
              prev.map((m) => (m.id === msg.id ? { ...msg, localOrigText: m.localOrigText } : m)),
            );
          }
          void refreshConversations();
          break;
        }
        case 'reaction': {
          const p = ev.payload as { messageId: number; reactions: ChatReaction[] };
          if (ev.conversationId === activeIdRef.current) {
            setMessages((prev) =>
              prev.map((m) => (m.id === p.messageId ? { ...m, reactions: p.reactions } : m)),
            );
          }
          break;
        }
        case 'read': {
          // 对端已读位点推进 → ✓✓（会话成员数据是唯一事实源）。
          const p = ev.payload as { userId: number; messageId: number };
          if (!ev.conversationId) break;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === ev.conversationId
                ? {
                    ...c,
                    members: c.members?.map((m) =>
                      m.userId === p.userId
                        ? { ...m, lastReadMessageId: Math.max(m.lastReadMessageId ?? 0, p.messageId) }
                        : m,
                    ),
                  }
                : c,
            ),
          );
          break;
        }
        case 'typing': {
          const p = ev.payload as { userId: number; typing: boolean };
          if (!ev.conversationId) break;
          setTypingByConv((prev) => {
            const next = new Map(prev);
            const inner = new Map(next.get(ev.conversationId!) || []);
            if (p.typing) inner.set(p.userId, Date.now() + 4_000);
            else inner.delete(p.userId);
            next.set(ev.conversationId!, inner);
            return next;
          });
          break;
        }
        case 'presence': {
          const p = ev.payload as { userId: number; online: boolean };
          setOnlineUserIds((prev) => {
            const next = new Set(prev);
            if (p.online) next.add(p.userId);
            else next.delete(p.userId);
            return next;
          });
          break;
        }
        default:
          break;
      }
    },
    [currentUserId, notifyIncoming, refreshConversations],
  );

  const { connected, sendTyping } = useChatSocket({
    onEvent: handleEvent,
    enabled: auth.status === 'authed',
  });

  // --- 初始化 ---
  useEffect(() => {
    if (auth.status !== 'authed') return;
    void refreshConversations();
    void chatApi.getSettings().then(setSettings).catch(() => {});
    void chatApi.listAgents().then(setAgents).catch(() => {});
  }, [auth.status, refreshConversations]);

  // 周期性清理过期 typing 标记。
  useEffect(() => {
    const t = setInterval(() => {
      setTypingByConv((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map<number, Map<number, number>>();
        for (const [conv, inner] of prev) {
          const ni = new Map<number, number>();
          for (const [uid, exp] of inner) {
            if (exp > now) ni.set(uid, exp);
            else changed = true;
          }
          next.set(conv, ni);
        }
        return changed ? next : prev;
      });
    }, 1_500);
    return () => clearInterval(t);
  }, []);

  // ⌘K 聚焦搜索。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // --- 选择会话 ---
  const selectConversation = useCallback(
    async (conv: ChatConversation) => {
      // 保存上一会话草稿。
      const prevId = activeIdRef.current;
      if (prevId != null && composerRef.current) {
        const draft = composerRef.current.getText().trim();
        if (draft) draftsRef.current.set(prevId, draft);
        else draftsRef.current.delete(prevId);
        setDraftsVersion((v) => v + 1);
      }
      activeIdRef.current = conv.id;
      setActiveId(conv.id);
      setMessages([]);
      setReplyTo(null);
      setEditing(null);
      setFirstUnreadId(null);
      setLightboxIdx(null);
      setConvAgents([]);
      void chatApi.listConversationAgents(conv.id).then(setConvAgents).catch(() => {});
      try {
        const unreadBefore = conv.unreadCount;
        const history = await chatApi.getHistory(conv.id);
        // 防竞态：用户在历史返回前切到了别的会话 → 丢弃这份陈旧响应。
        if (activeIdRef.current !== conv.id) return;
        setMessages(history);
        setHasMore(history.length >= 30);
        // 「以下为新消息」定位：从尾部数 unreadCount 条他人消息。
        if (unreadBefore > 0) {
          let count = 0;
          for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].senderId !== currentUserId) {
              count += 1;
              if (count === unreadBefore) {
                setFirstUnreadId(history[i].id);
                break;
              }
            }
          }
        }
        const last = history[history.length - 1];
        if (last) {
          await chatApi.markRead(conv.id, last.id).catch(() => {});
        }
        setConversations((prev) =>
          prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0, mentionCount: 0 } : c)),
        );
        // 回填草稿。
        requestAnimationFrame(() => composerRef.current?.setText(draftsRef.current.get(conv.id) || ''));
      } catch {
        /* ignore */
      }
    },
    [currentUserId],
  );

  const handleSelect = useCallback(
    (conv: ChatConversation) => {
      setMobileView('thread');
      void selectConversation(conv);
    },
    [selectConversation],
  );

  const loadMore = useCallback(async () => {
    if (!activeId || messages.length === 0) return;
    const convId = activeId;
    const oldest = messages[0];
    try {
      const older = await chatApi.getHistory(convId, oldest.id);
      if (activeIdRef.current !== convId) return;
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length >= 30);
    } catch {
      /* ignore */
    }
  }, [activeId, messages]);

  // --- 发送 ---
  const sendText = useCallback(
    async (text: string, mentions: number[]) => {
      if (!activeId) return;
      const clientMsgId = newClientId();
      const optimistic: ChatMessage = {
        id: -Date.now(),
        conversationId: activeId,
        senderId: currentUserId,
        senderType: 'USER',
        messageType: 'TEXT',
        content: text,
        clientMsgId,
        replyToId: replyTo?.id,
        mentions: mentions.length ? mentions : undefined,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      const convId = activeId;
      const replyId = replyTo?.id;
      setMessages((prev) => [...prev, optimistic]);
      setReplyTo(null);
      try {
        const saved = await chatApi.sendMessage(convId, {
          messageType: 'TEXT',
          content: text,
          clientMsgId,
          replyToId: replyId,
          mentions: mentions.length ? mentions : undefined,
        });
        if (activeIdRef.current !== convId) return;
        setMessages((prev) => mergeMessage(prev, saved));
        void refreshConversations();
      } catch {
        if (activeIdRef.current !== convId) return;
        setMessages((prev) =>
          prev.map((m) => (m.clientMsgId === clientMsgId ? { ...m, pending: false, failed: true } : m)),
        );
      }
    },
    [activeId, currentUserId, replyTo, refreshConversations],
  );

  const retrySend = useCallback(
    async (msg: ChatMessage) => {
      if (!activeId || !msg.clientMsgId) return;
      const convId = activeId;
      patchMessage(msg.id, (m) => ({ ...m, pending: true, failed: false }));
      try {
        const saved = await chatApi.sendMessage(convId, {
          messageType: msg.messageType,
          content: msg.content,
          clientMsgId: msg.clientMsgId,
          replyToId: msg.replyToId,
          mentions: msg.mentions,
          attachmentUrl: msg.attachmentUrl,
          attachmentName: msg.attachmentName,
          attachmentMime: msg.attachmentMime,
          attachmentSize: msg.attachmentSize,
          attachmentMeta: msg.attachmentMeta,
        });
        if (activeIdRef.current !== convId) return;
        setMessages((prev) => mergeMessage(prev, saved));
      } catch {
        if (activeIdRef.current !== convId) return;
        patchMessage(msg.id, (m) => ({ ...m, pending: false, failed: true }));
      }
    },
    [activeId, patchMessage],
  );

  const sendSticker = useCallback(
    async (slug: string) => {
      if (!activeId) return;
      const convId = activeId;
      const clientMsgId = newClientId();
      const url = stickerUrl(slug);
      const meta = { sticker: true, pack: 'aeti', slug };
      const optimistic: ChatMessage = {
        id: -Date.now(),
        conversationId: convId,
        senderId: currentUserId,
        senderType: 'USER',
        messageType: 'IMAGE',
        attachmentUrl: url,
        attachmentName: `${slug}.svg`,
        attachmentMime: 'image/svg+xml',
        attachmentMeta: meta,
        clientMsgId,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        const saved = await chatApi.sendMessage(convId, {
          messageType: 'IMAGE',
          attachmentUrl: url,
          attachmentName: `${slug}.svg`,
          attachmentMime: 'image/svg+xml',
          attachmentMeta: meta,
          clientMsgId,
        });
        if (activeIdRef.current !== convId) return;
        setMessages((prev) => mergeMessage(prev, saved));
        void refreshConversations();
      } catch {
        if (activeIdRef.current !== convId) return;
        setMessages((prev) =>
          prev.map((m) => (m.clientMsgId === clientMsgId ? { ...m, pending: false, failed: true } : m)),
        );
      }
    },
    [activeId, currentUserId, refreshConversations],
  );

  const sendImage = useCallback(
    async (prep: PreparedImage, onProgress: (p: number) => void) => {
      if (!activeId) return;
      const convId = activeId;
      const att = await chatApi.uploadAttachmentWithProgress(prep.blob, prep.fileName, onProgress);
      const saved = await chatApi.sendMessage(convId, {
        messageType: 'IMAGE',
        attachmentUrl: att.url,
        attachmentName: att.name,
        attachmentMime: att.mime,
        attachmentSize: att.size,
        attachmentMeta: {
          width: prep.width || att.width,
          height: prep.height || att.height,
          ph: prep.placeholder,
        },
        clientMsgId: newClientId(),
      });
      if (activeIdRef.current !== convId) return;
      setMessages((prev) => mergeMessage(prev, saved));
      void refreshConversations();
    },
    [activeId, refreshConversations],
  );

  const sendFile = useCallback(
    async (file: File) => {
      if (!activeId) return;
      const convId = activeId;
      try {
        const att = await chatApi.uploadAttachment(file);
        const type = att.fileType === 'IMAGE' ? 'IMAGE' : att.fileType === 'AUDIO' ? 'VOICE' : 'FILE';
        const saved = await chatApi.sendMessage(convId, {
          messageType: type,
          attachmentUrl: att.url,
          attachmentName: att.name,
          attachmentMime: att.mime,
          attachmentSize: att.size,
          attachmentMeta: att.width ? { width: att.width, height: att.height } : undefined,
          clientMsgId: newClientId(),
        });
        if (activeIdRef.current !== convId) return;
        setMessages((prev) => mergeMessage(prev, saved));
        void refreshConversations();
      } catch {
        /* ignore */
      }
    },
    [activeId, refreshConversations],
  );

  const sendVoice = useCallback(
    async (blob: Blob, durationSec: number, peaks: number[]) => {
      if (!activeId) return;
      const convId = activeId;
      try {
        const att = await chatApi.uploadAttachmentWithProgress(blob, `voice-${Date.now()}.webm`, () => {});
        const saved = await chatApi.sendMessage(convId, {
          messageType: 'VOICE',
          attachmentUrl: att.url,
          attachmentName: att.name,
          attachmentMime: att.mime || 'audio/webm',
          attachmentSize: att.size,
          attachmentMeta: { duration: durationSec, peaks },
          clientMsgId: newClientId(),
        });
        if (activeIdRef.current !== convId) return;
        setMessages((prev) => mergeMessage(prev, saved));
        void refreshConversations();
      } catch {
        /* ignore */
      }
    },
    [activeId, refreshConversations],
  );

  // --- 编辑 / 撤回 / 回应 ---
  const submitEdit = useCallback(
    async (msg: ChatMessage, text: string) => {
      if (!activeId) return;
      setEditing(null);
      try {
        const updated = await chatApi.editMessage(activeId, msg.id, text);
        patchMessage(msg.id, (m) => ({ ...updated, localOrigText: m.localOrigText }));
      } catch (e) {
        pushToast({ convId: activeId, title: '编辑失败', body: (e as Error).message, fallback: '!' });
      }
    },
    [activeId, patchMessage, pushToast],
  );

  const recallMessage = useCallback(
    async (msg: ChatMessage) => {
      if (!activeId) return;
      const orig = msg.messageType === 'TEXT' ? msg.content || '' : '';
      try {
        const updated = await chatApi.recallMessage(activeId, msg.id);
        patchMessage(msg.id, () => ({ ...updated, localOrigText: orig || undefined }));
        void refreshConversations();
      } catch (e) {
        pushToast({ convId: activeId, title: '撤回失败', body: (e as Error).message, fallback: '!' });
      }
    },
    [activeId, patchMessage, refreshConversations, pushToast],
  );

  const toggleReaction = useCallback(
    async (msg: ChatMessage, emoji: string) => {
      if (!activeId || msg.pending || msg.id < 0) return;
      const mine = msg.reactions?.find((r) => r.emoji === emoji)?.userIds.includes(currentUserId);
      try {
        const res = mine
          ? await chatApi.removeReaction(activeId, msg.id, emoji)
          : await chatApi.addReaction(activeId, msg.id, emoji);
        patchMessage(msg.id, (m) => ({ ...m, reactions: res.reactions }));
      } catch {
        /* ignore */
      }
    },
    [activeId, currentUserId, patchMessage],
  );

  // --- 消息菜单 ---
  const openMessageMenu = useCallback(
    (x: number, y: number, msg: ChatMessage) => {
      if (msg.recalledAt || msg.pending || msg.id < 0) return;
      const mine = msg.senderType === 'USER' && msg.senderId === currentUserId;
      const withinWindow = Date.now() - new Date(msg.createdAt).getTime() < EDIT_WINDOW_MS;
      const items: MenuState['items'] = [{ key: 'reply', label: '回复', icon: CornerUpLeft, hint: 'R' }];
      if (msg.messageType === 'TEXT') items.push({ key: 'copy', label: '复制', icon: Copy });
      if (mine && withinWindow && msg.messageType === 'TEXT')
        items.push({ key: 'edit', label: '编辑', icon: Pencil, hint: '↑' });
      if (mine && withinWindow) items.push({ key: 'recall', label: '撤回', icon: Trash2, danger: true, hint: '2min' });
      setMenu({
        x,
        y,
        items,
        onReact: (emoji) => void toggleReaction(msg, emoji),
        onSelect: (key) => {
          if (key === 'reply') {
            setEditing(null);
            setReplyTo(msg);
          } else if (key === 'copy') {
            void navigator.clipboard?.writeText(msg.content || '').catch(() => {});
          } else if (key === 'edit') {
            setReplyTo(null);
            setEditing(msg);
          } else if (key === 'recall') {
            void recallMessage(msg);
          }
        },
      });
    },
    [currentUserId, toggleReaction, recallMessage],
  );

  // --- 会话菜单（置顶 / 免打扰 / 标为已读） ---
  const updatePrefs = useCallback(
    async (conv: ChatConversation, body: { pinned?: boolean; muted?: boolean }) => {
      // 乐观更新，失败回滚到服务端事实。
      setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, ...body } : c)));
      try {
        const res = await chatApi.updateConvPrefs(conv.id, body);
        setConversations((prev) =>
          prev.map((c) => (c.id === conv.id ? { ...c, pinned: res.pinned, muted: res.muted } : c)),
        );
      } catch {
        void refreshConversations();
      }
    },
    [refreshConversations],
  );

  const openConvMenu = useCallback(
    (x: number, y: number, conv: ChatConversation) => {
      setMenu({
        x,
        y,
        items: [
          conv.pinned
            ? { key: 'unpin', label: '取消置顶', icon: PinOff }
            : { key: 'pin', label: '置顶会话', icon: Pin },
          conv.muted
            ? { key: 'unmute', label: '取消免打扰', icon: Bell }
            : { key: 'mute', label: '消息免打扰', icon: BellOff },
          { key: 'read', label: '标为已读', icon: Check },
        ],
        onSelect: (key) => {
          if (key === 'pin' || key === 'unpin') void updatePrefs(conv, { pinned: key === 'pin' });
          else if (key === 'mute' || key === 'unmute') void updatePrefs(conv, { muted: key === 'mute' });
          else if (key === 'read') {
            const last = conv.lastMessage;
            if (last) void chatApi.markRead(conv.id, last.id).catch(() => {});
            setConversations((prev) =>
              prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0, mentionCount: 0 } : c)),
            );
          }
        },
      });
    },
    [updatePrefs],
  );

  // --- 发起会话 ---
  const createConversation = useCallback(
    async (kind: 'u' | 't', id: number) => {
      const conv = kind === 't' ? await chatApi.openTeam(id) : await chatApi.openDirect(id);
      await refreshConversations();
      setTab('chats');
      setMobileView('thread');
      await selectConversation(conv);
    },
    [refreshConversations, selectConversation],
  );

  const openDirect = useCallback(
    (userId: number) => {
      void (async () => {
        try {
          const conv = await chatApi.openDirect(userId);
          await refreshConversations();
          setTab('chats');
          setMobileView('thread');
          await selectConversation(conv);
        } catch {
          /* ignore */
        }
      })();
    },
    [refreshConversations, selectConversation],
  );

  // --- 编辑上一条（↑） ---
  const editLastOwn = useCallback(() => {
    const list = messages.filter(
      (m) =>
        m.senderType === 'USER' &&
        m.senderId === currentUserId &&
        m.messageType === 'TEXT' &&
        !m.recalledAt &&
        !m.pending &&
        m.id > 0 &&
        Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS,
    );
    const last = list[list.length - 1];
    if (last) {
      setReplyTo(null);
      setEditing(last);
    }
  }, [messages, currentUserId]);

  // --- 灯箱 ---
  const lightboxImages = useMemo(
    () =>
      messages
        .filter((m) => m.messageType === 'IMAGE' && !m.recalledAt && !isStickerMeta(m.attachmentMeta))
        .map((m) => ({
          url: sanitizeUrl(m.attachmentUrl ?? '', ''),
          caption: `${m.senderName || ''} · ${new Date(m.createdAt).toLocaleString('zh-CN')}`,
        }))
        .filter((x) => !!x.url),
    [messages],
  );
  const openImage = useCallback(
    (url: string) => {
      const idx = lightboxImages.findIndex((x) => x.url === url);
      if (idx >= 0) setLightboxIdx(idx);
    },
    [lightboxImages],
  );

  // --- 拖拽入帧 ---
  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth.current += 1;
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback(() => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (e.dataTransfer?.files?.length) composerRef.current?.addFiles(Array.from(e.dataTransfer.files));
  }, []);

  // --- 派生 ---
  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter === 'unread' && c.unreadCount === 0) return false;
      if (filter === 'mention' && c.mentionCount === 0) return false;
      if (!q) return true;
      const names = (c.members || []).map((m) => (m.nickname || m.username || '').toLowerCase()).join(' ');
      return (c.title || '').toLowerCase().includes(q) || names.includes(q);
    });
  }, [conversations, searchQuery, filter]);

  const totalUnread = useMemo(
    () => conversations.reduce((s, c) => s + (c.muted ? 0 : c.unreadCount), 0),
    [conversations],
  );
  const unreadConvCount = useMemo(() => conversations.filter((c) => c.unreadCount > 0).length, [conversations]);
  const mentionConvCount = useMemo(() => conversations.filter((c) => c.mentionCount > 0).length, [conversations]);

  const typingConvIds = useMemo(() => {
    const now = Date.now();
    const s = new Set<number>();
    for (const [conv, inner] of typingByConv) {
      for (const [uid, exp] of inner) {
        if (uid !== currentUserId && exp > now) {
          s.add(conv);
          break;
        }
      }
    }
    return s;
  }, [typingByConv, currentUserId]);

  const activePeer = useMemo(
    () =>
      activeConv?.kind === 'DIRECT'
        ? activeConv.members?.find((m) => m.userId !== currentUserId)
        : undefined,
    [activeConv, currentUserId],
  );
  const peerOnline = activePeer ? onlineUserIds.has(activePeer.userId) : false;

  const typingNames = activeConv
    ? Array.from(typingByConv.get(activeConv.id)?.keys() || [])
        .filter((uid) => uid !== currentUserId)
        .map((uid) => {
          const m = activeConv.members?.find((x) => x.userId === uid);
          return m?.nickname || m?.username || '对方';
        })
    : [];

  const drafts = useMemo(() => new Map(draftsRef.current), [draftsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- 加载骨架（零 spinner） ---
  if (auth.status === 'loading') {
    return (
      <div className="mx-auto flex h-[calc(100dvh-7rem)] min-h-[460px] max-w-6xl overflow-hidden rounded-3xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)]">
        <div className="hidden w-80 shrink-0 flex-col gap-2 border-r border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4 md:flex">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-full" style={{ background: 'color-mix(in oklch, var(--ink-primary) 8%, transparent)' }} />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-2/3 animate-pulse rounded" style={{ background: 'color-mix(in oklch, var(--ink-primary) 8%, transparent)' }} />
                <div className="h-2.5 w-1/2 animate-pulse rounded" style={{ background: 'color-mix(in oklch, var(--ink-primary) 6%, transparent)' }} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--ink-muted)]">加载会话…</div>
      </div>
    );
  }

  // --- 未登录引导 ---
  if (auth.status === 'guest') {
    return (
      <div className="mx-auto flex h-[calc(100dvh-7rem)] min-h-[460px] max-w-6xl items-center justify-center rounded-3xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.soft}
          className="flex max-w-sm flex-col items-center px-6 text-center"
        >
          <span
            className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: 'color-mix(in oklch, var(--aurora-1) 14%, transparent)', color: 'var(--aurora-1)' }}
          >
            <MessagesSquare size={28} />
          </span>
          <h2 className="font-display text-[26px] leading-tight text-[var(--ink-primary)]">对话空间</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--ink-secondary)]">
            登录后即可与团队成员、私聊好友和智能体实时对话。
          </p>
          <Link
            href="/agent/login?next=/team-chat"
            className="mt-6 rounded-xl px-6 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'var(--aurora-1)', color: 'var(--bg-void)' }}
          >
            前往登录
          </Link>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex h-[calc(100dvh-7rem)] min-h-[460px] max-w-6xl overflow-hidden rounded-3xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] shadow-[0_24px_64px_-32px_rgba(0,0,0,0.5)]">
      {/* Rail —— 会话 / 联系人 + 未读总徽标（≥md） */}
      <nav
        className="hidden w-16 shrink-0 flex-col items-center gap-1.5 border-r border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] py-3.5 md:flex"
        style={{ background: 'color-mix(in oklch, var(--bg-void) 55%, transparent)' }}
        aria-label="聊天导航"
      >
        <RailButton
          active={tab === 'chats'}
          onClick={() => setTab('chats')}
          label="会话"
          badge={totalUnread}
          mention={mentionConvCount > 0}
        >
          <MessageCircle size={21} />
        </RailButton>
        <RailButton active={tab === 'contacts'} onClick={() => setTab('contacts')} label="联系人">
          <Users size={21} />
        </RailButton>
        <div className="flex-1" />
        <RailButton
          active={false}
          onClick={() => {
            setSoundEnabled(!soundOn);
            setSoundOn(!soundOn);
            if (!soundOn) playDing();
          }}
          label={soundOn ? '关闭提示音' : '开启提示音'}
        >
          {soundOn ? <Volume2 size={19} /> : <VolumeX size={19} />}
        </RailButton>
        {notifPerm !== 'unsupported' && (
          <RailButton
            active={notifPerm === 'granted'}
            onClick={() => {
              if (notifPerm === 'default') void Notification.requestPermission().then(setNotifPerm);
            }}
            label={
              notifPerm === 'granted' ? '桌面通知已开启' : notifPerm === 'denied' ? '桌面通知被浏览器拦截' : '开启桌面通知'
            }
          >
            {notifPerm === 'granted' ? <BellRing size={19} /> : <Bell size={19} />}
          </RailButton>
        )}
      </nav>

      {/* 侧栏：会话列表 / 联系人 */}
      <aside
        className={`${mobileView === 'thread' ? 'hidden' : 'flex'} w-full flex-col bg-[var(--bg-leaf)] md:flex md:w-80 md:shrink-0 md:border-r md:border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]`}
      >
        <header className="flex items-center justify-between px-4 pb-2 pt-4">
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-[22px] leading-none text-[var(--ink-primary)]">
              {tab === 'chats' ? '对话' : '联系人'}
            </h1>
            <span
              className="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
              style={{
                background: connected
                  ? 'color-mix(in oklch, var(--signal-success) 14%, transparent)'
                  : 'color-mix(in oklch, var(--ink-primary) 8%, transparent)',
                color: connected ? 'var(--signal-success)' : 'var(--ink-muted)',
              }}
              title={connected ? '实时已连接' : '重连中（指数退避 1s→15s）'}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${connected ? 'animate-pulse' : ''}`}
                style={{ background: connected ? 'var(--signal-success)' : 'var(--ink-subtle)' }}
              />
              {connected ? '实时' : '重连中'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setNewConvOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] hover:text-[var(--aurora-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
            aria-label="发起会话"
            title="发起会话"
          >
            <MessageSquarePlus size={19} />
          </button>
        </header>

        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-substrate)] px-3 py-2 transition-colors focus-within:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]">
            <Search size={15} className="shrink-0 text-[var(--ink-muted)]" />
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索会话、联系人"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--ink-primary)] outline-none placeholder:text-[var(--ink-subtle)]"
              aria-label="搜索"
            />
            <kbd className="shrink-0 rounded border border-[color-mix(in_oklch,var(--ink-primary)_13%,transparent)] px-1 font-mono text-[9.5px] text-[var(--ink-muted)]">
              ⌘K
            </kbd>
          </div>
        </div>

        {tab === 'chats' ? (
          <>
            <div className="flex gap-1.5 px-3 pb-2" role="tablist" aria-label="会话筛选">
              {(
                [
                  { key: 'all', label: '全部', count: 0 },
                  { key: 'unread', label: '未读', count: unreadConvCount },
                  { key: 'mention', label: '@我', count: mentionConvCount },
                ] as const
              ).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className="flex items-center gap-1 rounded-full px-2.5 py-[3px] font-mono text-[10.5px] tracking-[0.06em] transition-colors"
                  style={
                    filter === f.key
                      ? { color: 'var(--aurora-1)', background: 'color-mix(in oklch, var(--aurora-1) 12%, transparent)' }
                      : { color: 'var(--ink-muted)' }
                  }
                >
                  {f.label}
                  {f.count > 0 && <span className="opacity-75 [font-feature-settings:'tnum'_1]">{f.count}</span>}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ConversationList
                conversations={filteredConversations}
                activeId={activeId}
                onlineUserIds={onlineUserIds}
                typingConvIds={typingConvIds}
                currentUserId={currentUserId}
                drafts={drafts}
                onSelect={handleSelect}
                onContextMenu={openConvMenu}
              />
            </div>
          </>
        ) : (
          <ContactsView
            conversations={conversations}
            agents={agents}
            onlineUserIds={onlineUserIds}
            currentUserId={currentUserId}
            onOpenDirect={openDirect}
            onAgentHint={(a) =>
              pushToast({
                convId: activeId ?? 0,
                title: a.name,
                body: '在群聊的智能体栏「纳入」，或在消息中 @ 它即可对话。',
                fallback: a.name,
              })
            }
          />
        )}
      </aside>

      {/* 主区 */}
      <main
        className={`${mobileView === 'list' ? 'hidden' : 'flex'} relative min-w-0 flex-1 flex-col md:flex`}
        onDragEnter={onDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {activeConv ? (
          <>
            <header className="flex items-center gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 py-2.5 md:px-4">
              <button
                type="button"
                onClick={() => {
                  // 移动端返回列表：清空活动会话，防止隐藏会话被继续 markRead（PR #789 评审 P2）。
                  const draft = composerRef.current?.getText().trim();
                  if (activeIdRef.current != null) {
                    if (draft) draftsRef.current.set(activeIdRef.current, draft);
                    else draftsRef.current.delete(activeIdRef.current);
                    setDraftsVersion((v) => v + 1);
                  }
                  activeIdRef.current = null;
                  setActiveId(null);
                  setMobileView('list');
                }}
                className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] md:hidden"
                aria-label="返回会话列表"
              >
                <ChevronLeft size={20} />
              </button>
              {activeConv.kind === 'DIRECT' ? (
                <Avatar src={activePeer?.avatar} fallback={activePeer?.nickname || activePeer?.username || activeConv.title} size="sm" />
              ) : (
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'color-mix(in oklch, var(--aurora-1) 16%, transparent)', color: 'var(--aurora-1)' }}
                >
                  <Hash size={16} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-[var(--ink-primary)]">
                  {activeConv.title || (activeConv.kind === 'TEAM' ? '团队群聊' : '私聊')}
                </div>
                <div className="flex items-center gap-1.5 text-[12px] text-[var(--ink-muted)]">
                  {typingNames.length > 0 ? (
                    <span style={{ color: 'var(--aurora-1)' }}>{typingNames.join('、')} 正在输入…</span>
                  ) : activeConv.kind === 'DIRECT' ? (
                    <>
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: peerOnline ? 'var(--signal-success)' : 'var(--ink-subtle)' }}
                      />
                      {peerOnline ? '在线' : '离线'}
                    </>
                  ) : (
                    `${activeConv.members?.length ?? 0} 位成员${convAgents.length ? ` · ${convAgents.length} 位智能体在席` : ''}`
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInfoOpen((v) => !v)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                style={
                  infoOpen
                    ? { color: 'var(--aurora-1)', background: 'color-mix(in oklch, var(--aurora-1) 13%, transparent)' }
                    : { color: 'var(--ink-secondary)' }
                }
                aria-label="会话信息"
                title="会话信息"
              >
                <PanelRight size={18} />
              </button>
            </header>

            <AgentBar conversationId={activeConv.id} />
            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <MessageThread
                  key={activeConv.id}
                  messages={messages}
                  currentUserId={currentUserId}
                  typingNames={typingNames}
                  settings={settings}
                  onLoadMore={loadMore}
                  hasMore={hasMore}
                  peerReadCursor={activePeer?.lastReadMessageId ?? undefined}
                  isDirect={activeConv.kind === 'DIRECT'}
                  firstUnreadId={firstUnreadId}
                  onToggleReaction={(m, e) => void toggleReaction(m, e)}
                  onReply={(m) => {
                    setEditing(null);
                    setReplyTo(m);
                  }}
                  onOpenMenu={openMessageMenu}
                  onOpenImage={openImage}
                  onRetry={(m) => void retrySend(m)}
                  onReEdit={(text) => {
                    composerRef.current?.setText(text);
                    composerRef.current?.focus();
                  }}
                />
                <Composer
                  ref={composerRef}
                  members={activeConv.members ?? []}
                  agents={convAgents.length ? convAgents : agents}
                  currentUserId={currentUserId}
                  replyTo={replyTo}
                  editing={editing}
                  onCancelContext={() => {
                    setReplyTo(null);
                    setEditing(null);
                  }}
                  onSend={(text, mentions) => void sendText(text, mentions)}
                  onSendEdit={(msg, text) => void submitEdit(msg, text)}
                  onSendSticker={(slug) => void sendSticker(slug)}
                  onSendImage={sendImage}
                  onSendFile={(f) => void sendFile(f)}
                  onSendVoice={sendVoice}
                  onTyping={(active) => activeId && sendTyping(activeId, active)}
                  onEditLast={editLastOwn}
                />
              </div>
              {infoOpen && (
                <InfoPanel
                  conv={activeConv}
                  agents={convAgents}
                  messages={messages}
                  settings={settings}
                  currentUserId={currentUserId}
                  onClose={() => setInfoOpen(false)}
                  onTogglePinned={(next) => void updatePrefs(activeConv, { pinned: next })}
                  onToggleMuted={(next) => void updatePrefs(activeConv, { muted: next })}
                  onBubbleStyle={(style) => {
                    setSettings((s) => ({ ...s, bubbleStyle: style }));
                    void chatApi.updateSettings({ bubbleStyle: style }).catch(() => {});
                  }}
                  onOpenImage={openImage}
                />
              )}
            </div>

            {/* 拖拽遮罩 —— §5 捕获入口之一 */}
            <AnimatePresence>
              {dragOver && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={transition.instant}
                  className="pointer-events-none absolute inset-2.5 z-40 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed backdrop-blur-[8px]"
                  style={{
                    borderColor: 'color-mix(in oklch, var(--aurora-1) 55%, transparent)',
                    background: 'color-mix(in oklch, var(--aurora-1) 10%, transparent)',
                    color: 'var(--aurora-1)',
                  }}
                >
                  <MessagesSquare size={32} />
                  <span className="text-[15px] font-semibold">松手，发送到「{activeConv.title}」</span>
                  <span className="font-mono text-[10.5px] tracking-[0.1em] text-[color-mix(in_oklch,var(--aurora-1)_70%,var(--ink-secondary))]">
                    支持多图 · 自动压缩至 2560px WebP
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <span
              className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ background: 'color-mix(in oklch, var(--aurora-1) 12%, transparent)', color: 'var(--aurora-1)' }}
            >
              <MessagesSquare size={24} />
            </span>
            <p className="font-display text-[19px] text-[var(--ink-primary)]">开始一段对话</p>
            <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-[var(--ink-muted)]">
              从左侧选择一个会话，或点击右上角发起新的私聊 / 群聊。
            </p>
            <button
              type="button"
              onClick={() => setNewConvOpen(true)}
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl border border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)] px-4 py-2 text-sm font-medium text-[var(--aurora-1)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]"
            >
              <MessageSquarePlus size={16} />
              发起会话
            </button>
          </div>
        )}

        {/* 页内 Toast（提示链 L4）：右上滑入，点击跳转会话 */}
        <div className="pointer-events-none absolute right-3.5 top-3.5 z-50 flex w-[min(316px,calc(100%-28px))] flex-col gap-2" aria-live="polite">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.button
                key={t.id}
                type="button"
                initial={{ opacity: 0, x: 24, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 18 }}
                transition={spring.bouncy}
                onClick={() => {
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                  const conv = conversations.find((c) => c.id === t.convId);
                  if (conv) handleSelect(conv);
                }}
                className="pointer-events-auto flex items-start gap-2.5 rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_13%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_88%,transparent)] p-3 text-left shadow-[0_16px_48px_-12px_rgba(0,0,0,0.6)] backdrop-blur-[40px] backdrop-saturate-[160%]"
              >
                <Avatar src={t.avatar} fallback={t.fallback} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-[var(--ink-primary)]">{t.title}</span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-[var(--ink-secondary)]">{t.body}</span>
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </main>

      <NewConversationModal open={newConvOpen} onClose={() => setNewConvOpen(false)} onCreate={createConversation} />
      <MessageContextMenu state={menu} onClose={() => setMenu(null)} />
      <Lightbox images={lightboxImages} index={lightboxIdx} onNavigate={setLightboxIdx} onClose={() => setLightboxIdx(null)} />
    </div>
  );
}

function RailButton({
  active,
  onClick,
  label,
  badge,
  mention,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
  mention?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="relative flex h-[42px] w-[42px] items-center justify-center rounded-xl transition-colors"
      style={
        active
          ? { color: 'var(--aurora-1)', background: 'color-mix(in oklch, var(--aurora-1) 13%, transparent)' }
          : { color: 'var(--ink-muted)' }
      }
    >
      {children}
      {badge != null && badge > 0 && (
        <span
          className="absolute right-0.5 top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 font-mono text-[10px] font-medium [font-feature-settings:'tnum'_1]"
          style={
            mention
              ? { background: 'var(--signal-danger)', color: '#FFF7F2' }
              : {
                  background: 'var(--aurora-1)',
                  color: 'var(--bg-void)',
                  boxShadow: '0 0 10px color-mix(in oklch, var(--aurora-1) 60%, transparent)',
                }
          }
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

/** 按 clientMsgId / id 去重合并消息，命中则替换（清除 pending），否则追加。 */
function mergeMessage(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const byClient =
    msg.clientMsgId && list.findIndex((m) => m.clientMsgId && m.clientMsgId === msg.clientMsgId);
  if (typeof byClient === 'number' && byClient >= 0) {
    const next = [...list];
    next[byClient] = msg;
    return next;
  }
  if (list.some((m) => m.id === msg.id)) return list;
  return [...list, msg];
}
