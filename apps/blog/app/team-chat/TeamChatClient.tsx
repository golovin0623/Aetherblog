'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ChevronLeft, Hash, MessageSquarePlus, MessagesSquare, Search } from 'lucide-react';
import { Avatar, spring } from '@aetherblog/ui';
import { useAgentAuth } from '../agent/lib/agentAuth';
import { chatApi } from './lib/chatApi';
import { newClientId } from './lib/ids';
import { useChatSocket } from './lib/useChatSocket';
import type { ChatConversation, ChatEvent, ChatMessage, ChatSettings } from './lib/types';
import ConversationList from './components/ConversationList';
import MessageThread from './components/MessageThread';
import Composer from './components/Composer';
import AgentBar from './components/AgentBar';
import NewConversationModal from './components/NewConversationModal';

const DEFAULT_SETTINGS: ChatSettings = { themeSkin: 'aurora', bubbleStyle: 'rounded' };

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

  // UI 态：搜索过滤、移动端单栏视图、发起会话弹层。
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list');
  const [newConvOpen, setNewConvOpen] = useState(false);

  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );

  // --- 下行事件处理 ---
  const handleEvent = useCallback((ev: ChatEvent) => {
    switch (ev.type) {
      case 'message': {
        const msg = ev.payload as ChatMessage;
        if (msg.conversationId === activeIdRef.current) {
          setMessages((prev) => mergeMessage(prev, msg));
          if (msg.senderId !== currentUserId) {
            void chatApi.markRead(msg.conversationId, msg.id).catch(() => {});
          }
        }
        // 刷新会话列表的预览与未读。
        void refreshConversations();
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
    // eslint-disable-next-line React-hooks/exhaustive-deps
  }, [currentUserId]);

  const { connected, sendTyping } = useChatSocket({
    onEvent: handleEvent,
    enabled: auth.status === 'authed',
  });

  // --- 初始化 ---
  const refreshConversations = useCallback(async () => {
    try {
      const list = await chatApi.listConversations();
      setConversations(list);
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    if (auth.status !== 'authed') return;
    void refreshConversations();
    void chatApi.getSettings().then(setSettings).catch(() => {});
  }, [auth.status, refreshConversations]);

  // 周期性清理过期的 typing 标记。
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

  // --- 选择会话 ---
  const selectConversation = useCallback(async (conv: ChatConversation) => {
    activeIdRef.current = conv.id;
    setActiveId(conv.id);
    setMessages([]);
    try {
      const history = await chatApi.getHistory(conv.id);
      // 防竞态：用户在历史返回前切到了别的会话 → 丢弃这份陈旧响应，不覆盖当前会话。
      if (activeIdRef.current !== conv.id) return;
      setMessages(history);
      setHasMore(history.length >= 30);
      const last = history[history.length - 1];
      if (last) {
        await chatApi.markRead(conv.id, last.id).catch(() => {});
      }
      setConversations((prev) =>
        prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c)),
      );
    } catch {
      /* 忽略 */
    }
  }, []);

  // 移动端：选中会话即切到消息视图。
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
      // 防竞态：加载更多返回前已切走 → 不把 A 的旧消息插进 B，也不改错 hasMore。
      if (activeIdRef.current !== convId) return;
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length >= 30);
    } catch {
      /* 忽略 */
    }
  }, [activeId, messages]);

  // --- 发送 ---
  const sendText = useCallback(
    async (text: string) => {
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
        createdAt: new Date().toISOString(),
        pending: true,
      };
      const convId = activeId;
      setMessages((prev) => [...prev, optimistic]);
      try {
        const saved = await chatApi.sendMessage(convId, {
          messageType: 'TEXT',
          content: text,
          clientMsgId,
        });
        // 防竞态：发送返回前已切到别的会话 → 不要把 A 的消息并进 B。
        if (activeIdRef.current !== convId) return;
        setMessages((prev) => mergeMessage(prev, saved));
      } catch {
        if (activeIdRef.current !== convId) return;
        setMessages((prev) =>
          prev.map((m) => (m.clientMsgId === clientMsgId ? { ...m, pending: false, content: `${text} (发送失败)` } : m)),
        );
      }
    },
    [activeId, currentUserId],
  );

  const uploadAndSend = useCallback(
    async (file: File) => {
      if (!activeId) return;
      const convId = activeId;
      try {
        const att = await chatApi.uploadAttachment(file);
        const type =
          att.fileType === 'IMAGE' ? 'IMAGE' : att.fileType === 'AUDIO' ? 'VOICE' : 'FILE';
        const saved = await chatApi.sendMessage(convId, {
          messageType: type,
          attachmentUrl: att.url,
          attachmentName: att.name,
          attachmentMime: att.mime,
          attachmentSize: att.size,
          attachmentMeta: att.width ? { width: att.width, height: att.height } : undefined,
          clientMsgId: newClientId(),
        });
        // 防竞态：上传 + 发送返回前已切走 → 不并进当前会话。
        if (activeIdRef.current !== convId) return;
        setMessages((prev) => mergeMessage(prev, saved));
      } catch {
        /* 忽略 */
      }
    },
    [activeId],
  );

  // --- 发起会话（按 user / team 数字 ID 打开；抛错由弹层就地展示） ---
  const createConversation = useCallback(
    async (kind: 'u' | 't', id: number) => {
      const conv = kind === 't' ? await chatApi.openTeam(id) : await chatApi.openDirect(id);
      await refreshConversations();
      setMobileView('thread');
      await selectConversation(conv);
    },
    [refreshConversations, selectConversation],
  );

  // 派生：搜索过滤后的会话、正在输入的会话集合、活动会话副标题。
  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const title = (c.title || '').toLowerCase();
      const names = (c.members || [])
        .map((m) => (m.nickname || m.username || '').toLowerCase())
        .join(' ');
      return title.includes(q) || names.includes(q);
    });
  }, [conversations, searchQuery]);

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
    <div className="mx-auto flex h-[calc(100dvh-7rem)] min-h-[460px] max-w-6xl overflow-hidden rounded-3xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] shadow-[0_24px_64px_-32px_rgba(0,0,0,0.5)]">
      {/* 侧栏 */}
      <aside
        className={`${mobileView === 'thread' ? 'hidden' : 'flex'} w-full flex-col bg-[var(--bg-leaf)] md:flex md:w-80 md:shrink-0 md:border-r md:border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]`}
      >
        <header className="flex items-center justify-between px-4 pb-2 pt-4">
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-[22px] leading-none text-[var(--ink-primary)]">对话</h1>
            <span
              className="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
              style={{
                background: connected
                  ? 'color-mix(in oklch, var(--signal-success) 14%, transparent)'
                  : 'color-mix(in oklch, var(--ink-primary) 8%, transparent)',
                color: connected ? 'var(--signal-success)' : 'var(--ink-muted)',
              }}
              title={connected ? '实时已连接' : '连接中…'}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${connected ? 'animate-pulse' : ''}`}
                style={{ background: connected ? 'var(--signal-success)' : 'var(--ink-subtle)' }}
              />
              {connected ? '实时' : '连接中'}
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
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索会话"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--ink-primary)] outline-none placeholder:text-[var(--ink-subtle)]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <ConversationList
            conversations={filteredConversations}
            activeId={activeId}
            onlineUserIds={onlineUserIds}
            typingConvIds={typingConvIds}
            currentUserId={currentUserId}
            onSelect={handleSelect}
          />
        </div>
      </aside>

      {/* 主区 */}
      <main className={`${mobileView === 'list' ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col md:flex`}>
        {activeConv ? (
          <>
            <header className="flex items-center gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 py-2.5 md:px-4">
              <button
                type="button"
                onClick={() => {
                  // 移动端返回列表：清空活动会话。否则 activeIdRef 仍指向该会话，
                  // WebSocket message 处理器会把隐藏的会话当「当前」继续 markRead，
                  // 误清未读 / 读回执（PR #789 评审 P2）。桌面端此按钮 md:hidden 不触发。
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
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--ink-primary)]">
                  {activeConv.title || (activeConv.kind === 'TEAM' ? '团队群聊' : '私聊')}
                </div>
                <div className="flex items-center gap-1.5 text-[12px] text-[var(--ink-muted)]">
                  {activeConv.kind === 'DIRECT' ? (
                    <>
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: peerOnline ? 'var(--signal-success)' : 'var(--ink-subtle)' }}
                      />
                      {peerOnline ? '在线' : '离线'}
                    </>
                  ) : (
                    `${activeConv.members?.length ?? 0} 位成员`
                  )}
                </div>
              </div>
            </header>

            <AgentBar conversationId={activeConv.id} />
            <MessageThread
              key={activeConv.id}
              messages={messages}
              currentUserId={currentUserId}
              typingNames={typingNames}
              settings={settings}
              onLoadMore={loadMore}
              hasMore={hasMore}
            />
            <Composer
              onSend={sendText}
              onUpload={uploadAndSend}
              onTyping={(active) => activeId && sendTyping(activeId, active)}
            />
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
      </main>

      <NewConversationModal open={newConvOpen} onClose={() => setNewConvOpen(false)} onCreate={createConversation} />
    </div>
  );
}

/** 按 clientMsgId / id 去重合并消息，命中则替换（清除 pending），否则按时间插入。 */
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
