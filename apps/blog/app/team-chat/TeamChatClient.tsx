'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAgentAuth } from '../agent/lib/agentAuth';
import { chatApi } from './lib/chatApi';
import { useChatSocket } from './lib/useChatSocket';
import type { ChatConversation, ChatEvent, ChatMessage, ChatSettings } from './lib/types';
import ConversationList from './components/ConversationList';
import MessageThread from './components/MessageThread';
import Composer from './components/Composer';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      /* ignore */
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
    setActiveId(conv.id);
    setMessages([]);
    try {
      const history = await chatApi.getHistory(conv.id);
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
      /* ignore */
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!activeId || messages.length === 0) return;
    const oldest = messages[0];
    try {
      const older = await chatApi.getHistory(activeId, oldest.id);
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length >= 30);
    } catch {
      /* ignore */
    }
  }, [activeId, messages]);

  // --- 发送 ---
  const sendText = useCallback(
    async (text: string) => {
      if (!activeId) return;
      const clientMsgId = crypto.randomUUID();
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
      setMessages((prev) => [...prev, optimistic]);
      try {
        const saved = await chatApi.sendMessage(activeId, {
          messageType: 'TEXT',
          content: text,
          clientMsgId,
        });
        setMessages((prev) => mergeMessage(prev, saved));
      } catch {
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
      try {
        const att = await chatApi.uploadAttachment(file);
        const type =
          att.fileType === 'IMAGE' ? 'IMAGE' : att.fileType === 'AUDIO' ? 'VOICE' : 'FILE';
        const saved = await chatApi.sendMessage(activeId, {
          messageType: type,
          attachmentUrl: att.url,
          attachmentName: att.name,
          attachmentMime: att.mime,
          attachmentSize: att.size,
          attachmentMeta: att.width ? { width: att.width, height: att.height } : undefined,
          clientMsgId: crypto.randomUUID(),
        });
        setMessages((prev) => mergeMessage(prev, saved));
      } catch {
        /* ignore */
      }
    },
    [activeId],
  );

  // --- 新会话（MVP：按 team / user 数字 ID 打开） ---
  const startConversation = useCallback(async () => {
    const raw = window.prompt('打开会话：输入 "u:用户ID" 私聊，或 "t:团队ID" 群聊');
    if (!raw) return;
    const [kind, idStr] = raw.split(':');
    const id = Number(idStr);
    if (!id) return;
    try {
      const conv =
        kind === 't' ? await chatApi.openTeam(id) : await chatApi.openDirect(id);
      await refreshConversations();
      await selectConversation(conv);
    } catch (e) {
      window.alert((e as Error).message);
    }
  }, [refreshConversations, selectConversation]);

  if (auth.status === 'loading') {
    return <div className="p-10 text-center text-[var(--ink-muted)]">加载中…</div>;
  }
  if (auth.status === 'guest') {
    return (
      <div className="p-10 text-center">
        <p className="mb-4 text-[var(--ink-secondary)]">请先登录后使用团队聊天。</p>
        <Link href="/agent/login" className="text-[var(--aurora-1)] underline">
          前往登录
        </Link>
      </div>
    );
  }

  const typingNames = activeConv
    ? Array.from(typingByConv.get(activeConv.id)?.keys() || [])
        .filter((uid) => uid !== currentUserId)
        .map((uid) => {
          const m = activeConv.members?.find((x) => x.userId === uid);
          return m?.nickname || m?.username || '对方';
        })
    : [];

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-6xl overflow-hidden rounded-2xl border border-[var(--ink-subtle)] bg-[var(--bg-substrate)]">
      {/* 侧栏 */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--ink-subtle)]">
        <header className="flex items-center justify-between px-4 py-3">
          <span className="font-display text-lg text-[var(--ink-primary)]">团队聊天</span>
          <span
            className={`h-2 w-2 rounded-full ${connected ? 'bg-[var(--signal-success)]' : 'bg-[var(--ink-subtle)]'}`}
            title={connected ? '实时已连接' : '连接中…'}
          />
        </header>
        <button
          type="button"
          onClick={startConversation}
          className="mx-4 mb-2 rounded-xl border border-[var(--ink-subtle)] py-2 text-sm text-[var(--ink-secondary)] transition hover:bg-[var(--bg-leaf)]"
        >
          ＋ 发起会话
        </button>
        <div className="flex-1 overflow-y-auto">
          <ConversationList
            conversations={conversations}
            activeId={activeId}
            onlineUserIds={onlineUserIds}
            currentUserId={currentUserId}
            onSelect={selectConversation}
          />
        </div>
      </aside>

      {/* 主区 */}
      <main className="flex min-w-0 flex-1 flex-col">
        {activeConv ? (
          <>
            <header className="border-b border-[var(--ink-subtle)] px-4 py-3">
              <span className="font-medium text-[var(--ink-primary)]">{activeConv.title}</span>
            </header>
            <MessageThread
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
          <div className="flex flex-1 items-center justify-center text-[var(--ink-muted)]">
            选择左侧会话，或点击「发起会话」开始聊天
          </div>
        )}
      </main>
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
