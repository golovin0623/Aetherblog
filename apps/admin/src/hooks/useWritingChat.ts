/**
 * useWritingChat —— AI 协同写作对话的真流式状态机
 *
 * 背景:AiWritingWorkspacePage 之前的对话回复是 setTimeout mock。这里接入
 * /api/v1/agent/chat 的 SSE(streamAgentChat,与 AetherHub 灵境同协议),
 * 支持 delta / think 事件、手动停止与失败重试。
 *
 * 状态放在页面层持有(而非面板内部)—— 侧栏/底抽屉由 AnimatePresence 控制,
 * 关闭即卸载,历史不能跟着丢。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { newMessageId, newSessionId, streamAgentChat } from '@/services/agent';

export interface WritingChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /** 展示用文本。用户消息不含注入的文档上下文前缀。 */
  content: string;
  /** 实际发往模型的文本(可能带文档上下文);仅 user 消息使用。 */
  outbound?: string;
  /** reasoning 模型的思考流。 */
  think?: string;
  /** 是否携带了全文上下文(展示徽标用)。 */
  withContext?: boolean;
  pending?: boolean;
  error?: string;
  createdAt: number;
}

export interface WritingChatDocument {
  title: string;
  content: string;
}

export interface WritingChatSendOptions {
  includeContext: boolean;
  document: WritingChatDocument;
}

/** 发给模型的历史**轮数**(user+assistant 为一轮)上限 —— 写作对话是短上下文场景,防 token 失控。 */
const HISTORY_TURN_LIMIT = 6;
/** 注入文档上下文的正文截断长度。与后端单条 8000 字符封顶留出提问余量。 */
const CONTEXT_CONTENT_LIMIT = 6000;
/**
 * 后端 ai-service `_enforce_message_limits` 的硬封顶(单条 8000 / 全量 32000 字符,
 * 超限直接 413)。全文上下文只随**本轮**提问注入,历史轮一律回落到展示文本,
 * 因此正常不会触顶;这里再做一次客户端预算兜底,避免超长正文 + 超长提问击穿。
 */
const BACKEND_TOTAL_CHAR_BUDGET = 30000;

function buildOutboundContent(text: string, opts: WritingChatSendOptions): string {
  if (!opts.includeContext) return text;
  const { title, content } = opts.document;
  const clipped =
    content.length > CONTEXT_CONTENT_LIMIT
      ? `${content.slice(0, CONTEXT_CONTENT_LIMIT)}\n\n(正文过长,已截断)`
      : content;
  return [
    '以下是我正在写的文章,请基于它回答我的问题。',
    `《${title.trim() || '未命名'}》`,
    '---',
    clipped.trim() || '(正文为空)',
    '---',
    text,
  ].join('\n\n');
}

type OutboundMessage = { role: 'user' | 'assistant'; content: string };

/**
 * 把会话历史折算成发往 /agent/chat 的消息数组。
 *
 * 三条硬约束(踩过的坑,勿回退):
 * 1. **全文上下文只随本轮注入。** 历史 user 消息一律回落到展示文本 `content`,
 *    否则每轮都重复携带 6000 字正文,数轮后必然击穿后端 32000 字符总长封顶,
 *    且此后关掉「全文」开关也救不回来(历史里存的仍是胖 outbound),只能清空重来。
 * 2. **按轮配对截断。** 以 (user, assistant) 为单位切,保证首条永远是 user ——
 *    裸 slice 消息数会切出打头的孤儿 assistant,Anthropic / deepseek-reasoner 等
 *    要求严格交替的 provider 会直接 400。
 * 3. **总长预算兜底。** 从旧到新丢弃整轮,直到落进后端封顶以内。
 */
export function buildOutboundMessages(history: WritingChatMessage[]): OutboundMessage[] {
  const usable = history.filter(
    (m) => !m.pending && !(m.role === 'assistant' && !m.content.trim())
  );

  // 找出最后一条 user 消息 —— 只有它使用携带全文上下文的 outbound
  const lastUserIndex = usable.map((m) => m.role).lastIndexOf('user');

  // 按轮分组:每轮以 user 开头,收拢其后的 assistant
  const turns: OutboundMessage[][] = [];
  usable.forEach((message, index) => {
    const content =
      message.role === 'user' && index === lastUserIndex
        ? (message.outbound ?? message.content)
        : message.content;
    if (message.role === 'user') {
      turns.push([{ role: 'user', content }]);
    } else if (turns.length > 0) {
      turns[turns.length - 1].push({ role: 'assistant', content });
    }
    // 首条即 assistant(历史被裁过)的情形直接丢弃,不制造孤儿
  });

  let kept = turns.slice(-HISTORY_TURN_LIMIT);
  const totalChars = (list: OutboundMessage[][]) =>
    list.reduce((sum, turn) => sum + turn.reduce((s, m) => s + m.content.length, 0), 0);
  // 预算兜底:从最旧的轮开始丢,但至少保留本轮
  while (kept.length > 1 && totalChars(kept) > BACKEND_TOTAL_CHAR_BUDGET) {
    kept = kept.slice(1);
  }

  return kept.flat();
}

export interface WritingChatApi {
  messages: WritingChatMessage[];
  isStreaming: boolean;
  send: (text: string, opts: WritingChatSendOptions) => void;
  /** 中断当前流。已产出的部分内容保留。 */
  stop: () => void;
  /** 重发最后一条用户消息(失败重试)。 */
  retry: (opts: WritingChatSendOptions) => void;
  clear: () => void;
}

export function useWritingChat(): WritingChatApi {
  const [messages, setMessages] = useState<WritingChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const sessionIdRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);
  /** 流序号守卫 —— stop 后迟到的事件不能写进新一轮消息。 */
  const streamSeqRef = useRef(0);
  /** 最新消息列表镜像 —— send/retry 需要在 setState 之外拿当前值来启动流。 */
  const messagesRef = useRef<WritingChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  if (!sessionIdRef.current) {
    sessionIdRef.current = newSessionId();
  }

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const patchMessage = useCallback(
    (id: string, patch: (m: WritingChatMessage) => WritingChatMessage) => {
      setMessages((list) => list.map((m) => (m.id === id ? patch(m) : m)));
    },
    []
  );

  const runStream = useCallback(
    (history: WritingChatMessage[], assistantId: string) => {
      const seq = ++streamSeqRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      const settle = () => {
        if (streamSeqRef.current !== seq) return;
        setIsStreaming(false);
      };

      const outboundMessages = buildOutboundMessages(history);

      void streamAgentChat(
        {
          sessionId: sessionIdRef.current,
          mode: 'chat',
          knowledgeContextMode: 'none',
          messages: outboundMessages,
        },
        {
          onDelta: (chunk) => {
            if (streamSeqRef.current !== seq) return;
            patchMessage(assistantId, (m) => ({ ...m, content: m.content + chunk }));
          },
          onThink: (chunk) => {
            if (streamSeqRef.current !== seq) return;
            patchMessage(assistantId, (m) => ({ ...m, think: (m.think ?? '') + chunk }));
          },
          onDone: () => {
            if (streamSeqRef.current !== seq) return;
            patchMessage(assistantId, (m) => ({ ...m, pending: false }));
            settle();
          },
          onError: (message) => {
            if (streamSeqRef.current !== seq) return;
            patchMessage(assistantId, (m) => ({ ...m, pending: false, error: message }));
            settle();
          },
        },
        controller.signal
      ).then(
        () => settle(),
        () => {
          if (streamSeqRef.current !== seq) return;
          patchMessage(assistantId, (m) => ({ ...m, pending: false, error: m.error ?? '流读取失败' }));
          settle();
        }
      );
    },
    [patchMessage]
  );

  const send = useCallback(
    (text: string, opts: WritingChatSendOptions) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const now = Date.now();
      const userMessage: WritingChatMessage = {
        id: newMessageId(),
        role: 'user',
        content: trimmed,
        outbound: buildOutboundContent(trimmed, opts),
        withContext: opts.includeContext,
        createdAt: now,
      };
      const assistantMessage: WritingChatMessage = {
        id: newMessageId(),
        role: 'assistant',
        content: '',
        pending: true,
        createdAt: now,
      };

      const base = messagesRef.current;
      setMessages([...base, userMessage, assistantMessage]);
      runStream([...base, userMessage], assistantMessage.id);
    },
    [isStreaming, runStream]
  );

  const stop = useCallback(() => {
    streamSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setMessages((list) =>
      list.map((m) =>
        m.pending
          ? {
              ...m,
              pending: false,
              error: m.content.trim() || m.think?.trim() ? undefined : '已手动停止',
            }
          : m
      )
    );
  }, []);

  const retry = useCallback(
    (opts: WritingChatSendOptions) => {
      if (isStreaming) return;
      const list = messagesRef.current;
      const lastUserIndex = list.map((m) => m.role).lastIndexOf('user');
      if (lastUserIndex < 0) return;
      const lastUser = list[lastUserIndex];
      const resent: WritingChatMessage = {
        ...lastUser,
        outbound: lastUser.outbound ?? buildOutboundContent(lastUser.content, opts),
      };
      const assistantMessage: WritingChatMessage = {
        id: newMessageId(),
        role: 'assistant',
        content: '',
        pending: true,
        createdAt: Date.now(),
      };
      const kept = [...list.slice(0, lastUserIndex), resent];
      setMessages([...kept, assistantMessage]);
      runStream(kept, assistantMessage.id);
    },
    [isStreaming, runStream]
  );

  const clear = useCallback(() => {
    streamSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setMessages([]);
    sessionIdRef.current = newSessionId();
  }, []);

  return { messages, isStreaming, send, stop, retry, clear };
}
