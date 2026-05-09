'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { spring, duration as motionDuration, ease as motionEase } from '@aetherblog/ui';
import {
  ArrowLeft,
  ChevronDown,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { ThemeToggle } from '@aetherblog/hooks';
import Sidebar from './components/Sidebar';
import MessageBubble from './components/MessageBubble';
import Composer, { type ComposerHandle } from './components/Composer';
import ModeSwitch, { AVAILABLE_MODES } from './components/ModeSwitch';
import ModelPicker from './components/ModelPicker';
import WorkspaceSkeleton from './components/WorkspaceSkeleton';
import { useAgentAuth } from '../lib/agentAuth';
import {
  AgentMessage,
  AgentMode,
  AgentSession,
  deriveSessionTitle,
  loadSessions,
  newMessageId,
  newSessionId,
  saveSessions,
} from '../lib/agentSessions';
import type { StreamAnimationMode } from '../lib/smooth';

/** 显示模式：bubble = 彩色卡片承载；engraved = 文字浮印纸面（版书）。 */
type DisplayMode = 'bubble' | 'engraved';
import { streamAgentChat } from '../lib/agentChatStream';
import {
  type AgentArticle,
  type AgentTag,
  type SlashCommand,
} from '../lib/agentResources';

interface Props {
  siteTitle: string;
}

const PROMPT_SUGGESTIONS = [
  '总结这篇文章的核心观点',
  '帮我把这段写得更短',
  '为这个标题生成 5 个备选',
  '把这段话翻译成英文',
];

// 模式名的中文显示映射（顶栏 caption 等用户可见位置使用）。
// ModeSwitch 内部 segmented 仍用工程字面 Chat / Cowork / Code + SOON 徽标，
// 此映射只服务于"灵境 · X"形态的副标。
const MODE_LABEL: Record<AgentMode, string> = {
  chat: '对话',
  cowork: '协作',
  code: '编排',
};

/**
 * /agent/workspace —— Agent 工作台主界面
 *
 * 结构：
 *   ┌─ Sidebar ─┬───────────── Section ─────────────────────────┐
 *   │ wordmark  │ TopBar  back · 标题 · ModeSwitch · theme · me  │
 *   │ +新对话   │                                                │
 *   │ 搜索      │ Thread (max-w-3xl, scrollable)                 │
 *   │ 会话分组   │   user / assistant bubbles                    │
 *   │ ────────  │ ───────────────────────────────────────────── │
 *   │ user/logout │ Composer (max-w-3xl, sticky bottom)          │
 *   └───────────┴────────────────────────────────────────────────┘
 *
 * 全屏 100dvh，把博客全局 BlogHeader 压住（已在 BlogHeader 里 path 守卫）。
 * 移动端 (< md)：sidebar 改 fixed drawer，topbar 出现 hamburger。
 *
 * 鉴权：useAgentAuth 期间显示 WorkspaceSkeleton（与最终布局严格同形），
 * guest → /agent/login。零 flash 是这次改版的关键诉求。
 */
export default function WorkspaceClient({ siteTitle }: Props) {
  const router = useRouter();
  const { state, logout } = useAgentAuth();

  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // 桌面端 sidebar collapse —— 与移动端 drawer 互不影响
  const [desktopSidebarHidden, setDesktopSidebarHidden] = useState(false);
  // 当前 draft 引用的文章 / 标签 —— 仅当 draft 仍在编辑时存活；提交后转移到
  // chat 请求并清空。换会话或显式移除时也清空。
  const [pendingArticles, setPendingArticles] = useState<AgentArticle[]>([]);
  const [pendingTags, setPendingTags] = useState<AgentTag[]>([]);
  // sessionModelOverride 三态：
  //   · null              —— 未触达；ModelPicker.value 与 send payload 落到
  //                         activeSession 存档值（或全 null 让后端走默认路由）。
  //   · { modelId, providerCode } 含 null/null —— 用户主动选"自动选择"。
  //   · { modelId: 'X', providerCode: 'Y' }   —— 用户主动选了具体模型。
  // 使用 { ... } | null 而非 nullable 字段是为了区分"未操作"与"主动选自动"
  // —— 后者的两个 null 值是真实意图，不能被 ?? 当作 missing 兜底回 session。
  // 切换 activeSession 时清空 override（用户进入新会话视为新意图起点）。
  const [sessionModelOverride, setSessionModelOverride] = useState<{
    modelId: string | null;
    providerCode: string | null;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // ---- 渲染偏好（显示模式 / 流式吐字模式 / 字体大小），localStorage 持久化 ----
  const [displayMode, setDisplayMode] = useState<DisplayMode>('bubble');
  const [streamAnimation, setStreamAnimation] = useState<StreamAnimationMode>('smooth');
  const [fontSize, setFontSize] = useState<number>(14.5);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dm = window.localStorage.getItem('aetherblog.agent.displayMode');
    if (dm === 'bubble' || dm === 'engraved') setDisplayMode(dm);
    const sa = window.localStorage.getItem('aetherblog.agent.streamAnimation');
    if (sa === 'none' || sa === 'fade' || sa === 'smooth') setStreamAnimation(sa);
    const fs = Number(window.localStorage.getItem('aetherblog.agent.fontSize'));
    if (Number.isFinite(fs) && fs >= 12 && fs <= 18) setFontSize(fs);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('aetherblog.agent.displayMode', displayMode);
  }, [displayMode]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('aetherblog.agent.streamAnimation', streamAnimation);
  }, [streamAnimation]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('aetherblog.agent.fontSize', String(fontSize));
  }, [fontSize]);

  // ---- 鉴权门禁 ----
  // guest 状态时立刻 replace 走，不渲染工作台主体（仍显示 skeleton 避免空白闪现）。
  const userId = state.status === 'authed' ? state.user.id : null;
  useEffect(() => {
    if (state.status === 'guest') {
      const next = encodeURIComponent('/agent/workspace');
      router.replace(`/agent/login?next=${next}`);
    }
  }, [state.status, router]);

  // ---- 已登录 → 拉本地会话 ----
  useEffect(() => {
    if (userId == null) return;
    const list = loadSessions(userId);
    setSessions(list);
    setActiveId(list.length > 0 ? list[0].id : null);
  }, [userId]);

  // ---- 持久化 ----
  useEffect(() => {
    if (userId == null) return;
    saveSessions(userId, sessions);
  }, [sessions, userId]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  // 切到不同会话时清空 override —— 进入新会话视为新意图起点，不该被前一个
  // 会话的 picker 选择残留污染。仅依赖 id：会话内 modelId 变化（如自己改名
  // 或 handleModelChange 更新）不重置 override，避免覆盖即时态。
  useEffect(() => {
    setSessionModelOverride(null);
  }, [activeSession?.id]);

  // ---- 会话操作 ----
  // 把 streaming 状态收尾成"已中断"。被两条路径复用：
  //   1. 用户按 composer 的"停止"按钮（handleAbort）
  //   2. 用户切到另一个会话（handleSelect）时若有 streaming 消息（codex
  //      review #575：fetch 在 AbortError 上 silent return → assistant
  //      bubble 永远停在 pending:true → 持久化成幻影）。
  // 必须捕获当前 activeId 作为 sessId —— 调用者在 setActiveId(newId) 之前
  // 必须先调本函数，闭包此时仍指向"被切走"的旧会话，能正确 patch。
  const finalizeStreamingMessage = useCallback(
    (reason: string) => {
      abortRef.current?.abort();
      abortRef.current = null;
      if (streamingMsgIdRef.current && activeId) {
        const targetId = streamingMsgIdRef.current;
        const sessId = activeId;
        setSessions((list) =>
          list.map((s) =>
            s.id === sessId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === targetId
                      ? {
                          ...m,
                          pending: false,
                          error: m.error || reason,
                          finishedAt: Date.now(),
                        }
                      : m,
                  ),
                }
              : s,
          ),
        );
      }
      streamingMsgIdRef.current = null;
      setBusy(false);
    },
    [activeId],
  );

  const handleCreate = useCallback(() => {
    // 防重复创建：如果列表里已经有空会话（messages.length === 0），直接切到
    // 该会话而不再 push 一条 —— 否则用户连续多次点"+ 新建"会堆出多条空记录。
    // 切过去的同时把当前 override 应用到该会话存档（与下面新建路径同款）。
    const empty = sessions.find((s) => s.messages.length === 0);
    if (empty) {
      if (sessionModelOverride) {
        setSessions((list) =>
          list.map((s) =>
            s.id === empty.id
              ? {
                  ...s,
                  modelId: sessionModelOverride.modelId,
                  providerCode: sessionModelOverride.providerCode,
                  updatedAt: Date.now(),
                }
              : s,
          ),
        );
      }
      setActiveId(empty.id);
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }

    const now = Date.now();
    // 新会话继承当前 override —— 用户在 EmptyState（或上一个会话）选过模型
    // 后点"+ 新建会话"，应该把 pending 选择带进新会话，而不是被清空回默认。
    // 与 handleSend 内联新建分支语义一致：override 是"用户最近的主动选择"，
    // 新会话是它的应用对象。useEffect 随后会因 activeSession.id 变化清空
    // override，但此时 modelId/providerCode 已固化在 session 存档里。
    const sess: AgentSession = {
      id: newSessionId(),
      title: '新对话',
      mode: 'chat',
      createdAt: now,
      updatedAt: now,
      messages: [],
      modelId: sessionModelOverride ? sessionModelOverride.modelId : null,
      providerCode: sessionModelOverride ? sessionModelOverride.providerCode : null,
    };
    setSessions((list) => [sess, ...list]);
    setActiveId(sess.id);
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [sessions, sessionModelOverride]);

  const handleSelect = useCallback(
    (id: string) => {
      // 切会话时若还有 streaming 消息，先按"停止"语义收尾旧会话。
      // 必须先 finalize 后 setActiveId —— finalize 闭包里的 activeId 还指
      // 着"被切走"的旧会话，这样才能 patch 对消息。
      if (streamingMsgIdRef.current) {
        finalizeStreamingMessage('已中断');
      }
      setActiveId(id);
    },
    [finalizeStreamingMessage],
  );

  const handleRename = useCallback((id: string, title: string) => {
    setSessions((list) =>
      list.map((s) => (s.id === id ? { ...s, title, updatedAt: Date.now() } : s)),
    );
  }, []);

  const handleDelete = useCallback((id: string) => {
    setSessions((list) => {
      const next = list.filter((s) => s.id !== id);
      // 如果删的是当前活跃会话，自动切到剩余第一个
      setActiveId((curr) => (curr === id ? (next[0]?.id ?? null) : curr));
      return next;
    });
  }, []);

  const handleModeChange = useCallback(
    (mode: AgentMode) => {
      if (!activeId) return;
      // 防御：只接受当前已上线的 mode；锁定的 cowork/code 即便绕过 ModeSwitch
      // 直接 dispatch 也会被这里挡掉。定位由 docs/agent/README.md 锁定。
      if (!AVAILABLE_MODES.has(mode)) return;
      setSessions((list) =>
        list.map((s) => (s.id === activeId ? { ...s, mode, updatedAt: Date.now() } : s)),
      );
    },
    [activeId],
  );

  const handleModelChange = useCallback(
    (modelId: string | null, providerCode: string | null) => {
      // 用户在 EmptyState（无活跃会话）也能切换模型 —— 选择被存到 override，
      // 等真正发送时由 handleSend 写入新会话。否则 ModelPicker 在空态下会
      // 完全失效（用户最常见的"打开就选模型"场景）。
      setSessionModelOverride({ modelId, providerCode });
      if (!activeId) return;
      setSessions((list) =>
        list.map((s) =>
          s.id === activeId
            ? { ...s, modelId, providerCode, updatedAt: Date.now() }
            : s,
        ),
      );
    },
    [activeId],
  );

  // ---- 发送消息 ----
  // 流式更新的两个层次：
  //
  //  1) 服务端 → "目标"内容（acc）：每个 SSE delta 立刻追加到 acc。
  //  2) "目标"内容 → "屏幕"内容（displayed）：rAF 每帧推进 N chars 朝 acc 追赶。
  //
  // 这一层平滑（display catch-up）是核心：服务端的 chunk 大小经常忽大忽小
  // （thinking 段 2 chars/chunk，正文 30~120 chars/chunk）。如果直接 setState
  // 把 acc 当 content 写回，文本会"卡顿地涌出"——和 ChatGPT/Claude/Codex 看到
  // 的"匀速打字机"感差距很大。
  //
  // stride 计算 (computeStride) 在 lag 大时加速，lag 小时变慢，做到既能赶上
  // 模型的真实速率，又能保持稳定的视觉节奏。
  // 拆分 send 流程的实际执行体：把"text 作为字符串入参"暴露出来，让
  // handleSend / handleRetry / handleResubmitEdited 都能复用同一份 streaming 逻辑。
  // handleSend 之外的调用方（重试 / 编辑后重发）已自行 setDraft('')，所以这里
  // 不再清空 draft —— 否则会破坏"用户编辑中按钮无意触发清空 textarea"的体感。
  const sendText = useCallback(async (text: string) => {
    if (!text || busy || state.status !== 'authed') return;

    let session = activeSession;
    if (!session) {
      const now = Date.now();
      // 新会话继承用户在 EmptyState 选过的模型 override —— 这一步配合
      // handleModelChange 的"无 activeId 也保存 override"才闭环：用户在空态
      // 选 gpt-5.5 → 输入 → 发送，新会话从一开始就带上 gpt-5.5。
      // 没有 override 时（用户没动过模型）落到 null，让后端走默认路由。
      session = {
        id: newSessionId(),
        title: deriveSessionTitle(text),
        mode: 'chat',
        createdAt: now,
        updatedAt: now,
        messages: [],
        modelId: sessionModelOverride ? sessionModelOverride.modelId : null,
        providerCode: sessionModelOverride ? sessionModelOverride.providerCode : null,
      };
      setSessions((list) => [session as AgentSession, ...list]);
      setActiveId(session.id);
    }

    const sessId = session.id;
    const startTs = Date.now();
    const userMsg: AgentMessage = {
      id: newMessageId(),
      role: 'user',
      content: text,
      createdAt: startTs,
    };
    const assistantMsg: AgentMessage = {
      id: newMessageId(),
      role: 'assistant',
      content: '',
      createdAt: startTs,
      pending: true,
      startedAt: startTs,
    };
    const targetMessageId = assistantMsg.id; // 闭包内 pin 住，rAF 不读 ref（避免被新对话串台）
    streamingMsgIdRef.current = targetMessageId;

    setSessions((list) =>
      list.map((s) =>
        s.id === sessId
          ? {
              ...s,
              title: s.messages.length === 0 ? deriveSessionTitle(text) : s.title,
              updatedAt: Date.now(),
              messages: [...s.messages, userMsg, assistantMsg],
            }
          : s,
      ),
    );
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const history = [...session.messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // === 流式累加 + rAF 平滑显示 ===
    let acc = '';                                // server 累加
    let displayed = '';                          // UI 实际显示
    let thinkAcc = '';
    let firstTokenAt: number | null = null;
    let streamDone = false;                      // server 已发 done/error
    let finalPatch: Partial<AgentMessage> | null = null;
    let pendingMisc: Partial<AgentMessage> = {}; // think / sources / firstTokenAt 待写
    let rafId = 0;

    // stride —— 当 lag 越大越激进追赶；流结束后再加速一档让收尾感更利落。
    const computeStride = (lag: number, finishing: boolean): number => {
      if (finishing) return Math.max(8, Math.ceil(lag / 5));
      if (lag > 600) return Math.ceil(lag / 12);
      if (lag > 200) return Math.ceil(lag / 18);
      if (lag > 60) return 5;
      if (lag > 20) return 3;
      return 2;
    };

    const tick = () => {
      rafId = 0;

      // 推进 displayed
      if (displayed.length < acc.length) {
        const lag = acc.length - displayed.length;
        const stride = computeStride(lag, streamDone);
        const nextLen = Math.min(displayed.length + stride, acc.length);
        displayed = acc.slice(0, nextLen);
      }

      // 组装本帧 patch
      const patch: Partial<AgentMessage> = { content: displayed };
      if (Object.keys(pendingMisc).length > 0) {
        Object.assign(patch, pendingMisc);
        pendingMisc = {};
      }

      // 仅当目标消息仍在 pending 才写入 —— 防止 abort 已写过 pending:false 后
      // 被这里覆盖回 pending=true 状态。
      setSessions((list) =>
        list.map((s) =>
          s.id === sessId
            ? {
                ...s,
                updatedAt: Date.now(),
                messages: s.messages.map((m) =>
                  m.id === targetMessageId && m.pending
                    ? { ...m, ...patch }
                    : m,
                ),
              }
            : s,
        ),
      );

      // 决定下一步
      if (displayed.length < acc.length) {
        rafId = requestAnimationFrame(tick);
      } else if (streamDone && finalPatch) {
        // 显示已追平 + 流已结束 → 应用终态（content 用 acc 兜底，确保完整）
        const fp = finalPatch;
        finalPatch = null;
        setSessions((list) =>
          list.map((s) =>
            s.id === sessId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === targetMessageId && m.pending
                      ? { ...m, ...fp, content: acc }
                      : m,
                  ),
                }
              : s,
          ),
        );
      }
      // else: displayed 已追平、流还没结束 → 等待下一个 onDelta 重新唤醒
    };

    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(tick);
    };

    // 把当前 draft 关联的引用一并送给后端。复制本地后立即清空 pending 区，
    // 避免下一条消息再次"携带"上一次的引用。
    const articleIds = pendingArticles.map((a) => a.id);
    const tagSlugs = pendingTags.map((t) => t.slug);
    setPendingArticles([]);
    setPendingTags([]);

    // 防御：始终落到已上线 mode（cowork/code 占位 prompt 在后端虽存在，但
    // 它们只是 placeholder，不该误传出去让用户以为 Cowork 已经在跑了）。
    const effectiveMode: AgentMode = AVAILABLE_MODES.has(session.mode) ? session.mode : 'chat';

    await streamAgentChat(
      {
        sessionId: sessId,
        mode: effectiveMode,
        messages: history,
        // 三元而非 ??：override = { modelId: null, ... } 表示用户主动选了
        // "自动选择"，应该原样发送（让后端走默认路由）。?? 会把 null 当 missing
        // 然后回退到 session.modelId（旧值），导致用户看到的"已切换"被静默忽略。
        modelId: sessionModelOverride
          ? sessionModelOverride.modelId
          : (session.modelId ?? null),
        providerCode: sessionModelOverride
          ? sessionModelOverride.providerCode
          : (session.providerCode ?? null),
        articleIds: articleIds.length ? articleIds : null,
        tagSlugs: tagSlugs.length ? tagSlugs : null,
      },
      {
        onDelta: (chunk) => {
          acc += chunk;
          if (firstTokenAt == null) {
            firstTokenAt = Date.now();
            pendingMisc.firstTokenAt = firstTokenAt;
          }
          schedule();
        },
        onThink: (chunk) => {
          thinkAcc += chunk;
          pendingMisc.think = thinkAcc;
          schedule();
        },
        onSources: (sources) => {
          pendingMisc.sources = sources;
          schedule();
        },
        onDone: () => {
          streamDone = true;
          finalPatch = { pending: false, finishedAt: Date.now() };
          schedule();
        },
        onError: (msg) => {
          // error 立即 flush 给用户看，不再等显示追平
          streamDone = true;
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
          displayed = acc;
          setSessions((list) =>
            list.map((s) =>
              s.id === sessId
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === targetMessageId && m.pending
                        ? {
                            ...m,
                            content: acc,
                            think: thinkAcc || m.think,
                            firstTokenAt: firstTokenAt ?? m.firstTokenAt,
                            pending: false,
                            error: msg,
                            finishedAt: Date.now(),
                          }
                        : m,
                    ),
                  }
                : s,
            ),
          );
        },
      },
      controller.signal,
    );

    // 注意：不在这里 cancel rAF —— stream 已结束但 displayed 可能还在追赶，
    // 让 tick 自然把剩余 chars 喷出来后自己结束（最多 ~300ms）。busy 状态可以
    // 立即解除，让用户感到响应已"完成"，bubble 仍在视觉上完成最后的打字尾巴。
    if (streamingMsgIdRef.current === targetMessageId) {
      streamingMsgIdRef.current = null;
    }
    setBusy(false);
  }, [busy, state, activeSession, pendingArticles, pendingTags, sessionModelOverride]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await sendText(text);
  }, [draft, sendText]);

  const handleAbort = useCallback(() => {
    finalizeStreamingMessage('已中断');
  }, [finalizeStreamingMessage]);

  // 用户消息「编辑」：把 messageId 之后（含自身）的所有消息从会话里截断，
  // 把该消息内容回填到 composer，让用户改完后正常 Enter 发送。竞品（ChatGPT
  // / Claude）一致行为：编辑后是"从此处分叉一条新对话"，原 assistant 回复随
  // user msg 一起被丢弃。
  const handleEditUserMessage = useCallback(
    (message: AgentMessage) => {
      if (busy) return;
      if (message.role !== 'user') return;
      setSessions((list) =>
        list.map((s) => {
          if (s.id !== activeId) return s;
          const idx = s.messages.findIndex((m) => m.id === message.id);
          if (idx < 0) return s;
          return { ...s, messages: s.messages.slice(0, idx), updatedAt: Date.now() };
        }),
      );
      setDraft(message.content);
      requestAnimationFrame(() => composerRef.current?.focus());
    },
    [busy, activeId],
  );

  // assistant 消息「重试」：找到该消息上一条 user msg，把 assistant（含自身）
  // 之后所有消息截断，立刻用 user 内容重新发起 streaming。错误态 / 完成态都
  // 走这一条路径。注意必须先把 streaming setSessions 落库再 sendText —— 否则
  // sendText 内 history 还会带上"被截"的旧 assistant 错误消息。
  const handleRetryAssistantMessage = useCallback(
    (message: AgentMessage) => {
      if (busy) return;
      if (message.role !== 'assistant') return;
      const sess = sessions.find((s) => s.id === activeId);
      if (!sess) return;
      const idx = sess.messages.findIndex((m) => m.id === message.id);
      if (idx <= 0) return;
      const prior = sess.messages[idx - 1];
      if (prior.role !== 'user') return;
      // 截断到上一条 user 之前（不含 user 本身）—— sendText 会重新把它 push 回去
      setSessions((list) =>
        list.map((s) =>
          s.id === sess.id
            ? { ...s, messages: s.messages.slice(0, idx - 1), updatedAt: Date.now() }
            : s,
        ),
      );
      void sendText(prior.content);
    },
    [busy, sessions, activeId, sendText],
  );

  const handleSuggestion = useCallback((text: string) => {
    setDraft(text);
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  // ---- @ / # / / picker handlers ----
  const handlePickArticle = useCallback(
    (article: AgentArticle) => {
      // toggle: 已选过则取消引用；否则加入 + 在 textarea 末尾追加 "@<title>"
      setPendingArticles((curr) => {
        if (curr.some((a) => a.id === article.id)) {
          return curr.filter((a) => a.id !== article.id);
        }
        return [...curr, article];
      });
      // 仅在新增时把可视 token 插到 textarea
      setPendingArticles((curr) => {
        const wasSelected = curr.some((a) => a.id === article.id);
        if (wasSelected) {
          const sep = draft && !draft.endsWith(' ') ? ' ' : '';
          composerRef.current?.insert(`${sep}@${article.title} `);
        }
        return curr;
      });
    },
    [draft],
  );

  const handlePickTag = useCallback((tag: AgentTag) => {
    setPendingTags((curr) => {
      if (curr.some((t) => t.slug === tag.slug)) {
        return curr.filter((t) => t.slug !== tag.slug);
      }
      return [...curr, tag];
    });
    setPendingTags((curr) => {
      const wasSelected = curr.some((t) => t.slug === tag.slug);
      if (wasSelected) {
        composerRef.current?.insert(`#${tag.name} `);
      }
      return curr;
    });
  }, []);

  const handleRemoveArticle = useCallback(
    (id: number) => setPendingArticles((curr) => curr.filter((a) => a.id !== id)),
    [],
  );
  const handleRemoveTag = useCallback(
    (slug: string) => setPendingTags((curr) => curr.filter((t) => t.slug !== slug)),
    [],
  );

  // ---- 斜杠命令 ----
  // /clear 与 /regen 是本地命令，不走 LLM；/summarize /explain /translate 把模板
  // 插入 composer 让用户补全后再发送。
  const handleSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.kind === 'remote' && cmd.template) {
        // 直接覆盖 draft —— 用户可继续编辑后按 Enter 发送
        setDraft(cmd.template);
        requestAnimationFrame(() => composerRef.current?.focus());
        return;
      }
      // local 命令
      if (cmd.command === '/clear') {
        if (!activeId) return;
        if (!confirm('确认清空当前会话所有消息？此操作不可撤销。')) return;
        setSessions((list) =>
          list.map((s) => (s.id === activeId ? { ...s, messages: [], updatedAt: Date.now() } : s)),
        );
        return;
      }
      if (cmd.command === '/regen') {
        // 删掉最后一条 assistant，把上一条 user 重新塞回 draft 让用户决定要不要重发
        if (!activeId) return;
        setSessions((list) =>
          list.map((s) => {
            if (s.id !== activeId) return s;
            const msgs = [...s.messages];
            if (msgs.length === 0) return s;
            const last = msgs[msgs.length - 1];
            if (last.role === 'assistant') msgs.pop();
            // 同时把它对应的 user 提取出来回到 draft
            if (msgs.length > 0 && msgs[msgs.length - 1].role === 'user') {
              const u = msgs.pop();
              if (u) setDraft(u.content);
            }
            return { ...s, messages: msgs, updatedAt: Date.now() };
          }),
        );
        requestAnimationFrame(() => composerRef.current?.focus());
        return;
      }
    },
    [activeId],
  );

  // 切换会话时清空 pending 引用，避免引用串台到另一个会话
  useEffect(() => {
    setPendingArticles([]);
    setPendingTags([]);
  }, [activeId]);

  // 智能滚动 ——
  //   · 用户在底部时，新消息 / 流式增量自动跟随；
  //   · 用户向上滚阅读时停止跟随，浮出 "↓ 最新" 按钮；
  //   · 点这个按钮平滑滚回底部并重新粘底。
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const lastMessageContent = activeSession?.messages.at(-1)?.content ?? '';
  const lastMessageCount = activeSession?.messages.length ?? 0;

  // 监听 thread 滚动，决定是否仍 "粘底"
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distance < 48;
      stickToBottomRef.current = atBottom;
      setShowJumpToBottom(!atBottom);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeId]);

  // 切会话：无条件锁回底部
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    el.scrollTop = el.scrollHeight;
  }, [activeId]);

  // 内容变化时若仍粘底则跟随；否则保留用户视野
  useEffect(() => {
    const el = threadRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lastMessageCount, lastMessageContent]);

  const handleJumpToBottom = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
  }, []);

  // ---- 加载/未登录态 → skeleton ----
  if (state.status !== 'authed') {
    return (
      <WorkspaceSkeleton
        showSidebar
        label={state.status === 'loading' ? '正在确认登录状态…' : '即将跳转到登录…'}
      />
    );
  }

  return (
    <div className="h-screen [height:100dvh] min-h-[600px] bg-[var(--bg-substrate)] flex overflow-hidden">
      <Sidebar
        user={state.user}
        sessions={sessions}
        activeId={activeId}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
        desktopHidden={desktopSidebarHidden}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onRename={handleRename}
        onDelete={handleDelete}
        onLogout={async () => {
          await logout();
          router.replace('/agent');
        }}
      />

      {/* 主区 */}
      <section className="flex-1 flex flex-col min-w-0 relative">
        {/* 顶栏 —— workspace 自己的 chrome（与博客 BlogHeader 互斥） */}
        <header
          className="flex items-center justify-between gap-2 px-3 sm:px-5 h-14 border-b border-[var(--ink-subtle)]/12 bg-[var(--bg-substrate)]/85 backdrop-blur-md sticky top-0 z-30"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="打开侧栏"
              className="md:hidden inline-flex items-center justify-center w-10 h-10 -ml-1 rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] active:scale-90 transition-all"
            >
              <Menu className="w-[18px] h-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => setDesktopSidebarHidden((v) => !v)}
              aria-label={desktopSidebarHidden ? '展开侧栏' : '收起侧栏'}
              title={desktopSidebarHidden ? '展开侧栏' : '收起侧栏'}
              className="hidden md:inline-flex items-center justify-center w-9 h-9 rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] active:scale-90 transition-all"
            >
              {desktopSidebarHidden ? (
                <PanelLeftOpen className="w-[18px] h-[18px]" />
              ) : (
                <PanelLeftClose className="w-[18px] h-[18px]" />
              )}
            </button>
            <Link
              href="/agent"
              className="hidden lg:inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              {siteTitle.toUpperCase()}
            </Link>
            <div className="hidden lg:block w-px h-4 bg-[var(--ink-subtle)]/25 mx-1" />
            <div className="min-w-0 flex flex-col">
              <span
                className="text-[var(--ink-primary)] text-[14px] font-medium truncate max-w-[58vw] sm:max-w-[24rem]"
                title={activeSession?.title || ''}
              >
                {activeSession?.title || '尚未选择会话'}
              </span>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]">
                灵境 · {MODE_LABEL[activeSession && AVAILABLE_MODES.has(activeSession.mode) ? activeSession.mode : 'chat']}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* ModeSwitch 仅桌面显示 —— 移动端单手操作下三档 segmented 占用过多
                横向空间，且 cowork/code 暂未上线（点击只是教育性 InfoPopover），
                让出空间给"标题 + 新建"两件套更符合移动端高频动作分布。 */}
            <div className="hidden sm:inline-flex">
              <ModeSwitch
                value={activeSession?.mode || 'chat'}
                onChange={handleModeChange}
              />
            </div>
            {/* 移动端最高频操作：一键新建会话。Sidebar drawer 内也有"新对话"
                按钮，但顶栏直达更适合"边看边开新话题"的连续使用场景。 */}
            <button
              type="button"
              onClick={handleCreate}
              aria-label="新建会话"
              title="新建会话"
              className="sm:hidden inline-flex items-center justify-center w-10 h-10 -mr-1 rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--aurora-1)] transition-all active:scale-90"
            >
              <Plus className="w-[18px] h-[18px]" />
            </button>
            <div className="hidden sm:flex items-center gap-1 pl-1 ml-1 border-l border-[var(--ink-subtle)]/15">
              <RenderingPreferencesButton
                displayMode={displayMode}
                onSetDisplayMode={setDisplayMode}
                streamAnimation={streamAnimation}
                onSetStreamAnimation={setStreamAnimation}
                fontSize={fontSize}
                onSetFontSize={setFontSize}
              />
              <ThemeToggle size="sm" />
            </div>
            {/* 移动端：把渲染偏好挂在 + 旁边，避免顶栏拥挤 */}
            <div className="sm:hidden inline-flex">
              <RenderingPreferencesButton
                displayMode={displayMode}
                onSetDisplayMode={setDisplayMode}
                streamAnimation={streamAnimation}
                onSetStreamAnimation={setStreamAnimation}
                fontSize={fontSize}
                onSetFontSize={setFontSize}
              />
            </div>
          </div>
        </header>

        {/* 移动端控制条：把"当前模式 / 模型选择 / 主题"集中到顶栏下方一行，
            减少顶部认知负担。原顶栏 ModeSwitch 在 mobile 已隐藏，控制条以
            只读 caption 形式展示当前模式（cowork/code 暂未上线，移动端没有
            真实切换需求）；ModelPicker 走 activeSession ?? override 兜底，
            与 composer 内的 ModelPicker 共享同一控制语义。 */}
        <div className="sm:hidden px-3 pt-2 pb-1.5 border-b border-[var(--ink-subtle)]/10 bg-[var(--bg-substrate)]/88 backdrop-blur-md">
          <div className="surface-leaf rounded-xl border border-[var(--ink-subtle)]/15 px-2.5 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                模式
              </span>
              <span className="text-[12px] text-[var(--ink-primary)] truncate">
                {MODE_LABEL[activeSession && AVAILABLE_MODES.has(activeSession.mode) ? activeSession.mode : 'chat']}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <ModelPicker
                value={
                  sessionModelOverride
                    ? sessionModelOverride
                    : {
                        modelId: activeSession?.modelId ?? null,
                        providerCode: activeSession?.providerCode ?? null,
                      }
                }
                onChange={handleModelChange}
                enabled={state.status === 'authed'}
                placement="bottom-end"
                compact
              />
              <ThemeToggle size="sm" />
            </div>
          </div>
        </div>

        {/* 对话流 */}
        <div className="relative flex-1 min-h-0">
          <div
            ref={threadRef}
            className="agent-thumb-scroll absolute inset-0 overflow-y-auto overscroll-contain"
          >
            {!activeSession || activeSession.messages.length === 0 ? (
              <EmptyState siteTitle={siteTitle} onPick={handleSuggestion} />
            ) : (
              <div className="px-3 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-7">
                {activeSession.messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    busy={busy}
                    displayMode={displayMode}
                    streamAnimation={streamAnimation}
                    fontSize={fontSize}
                    onEdit={handleEditUserMessage}
                    onRetry={handleRetryAssistantMessage}
                  />
                ))}
                {/* 留出一点尾部空间，避免最后一条贴在 composer 上 */}
                <div className="h-2" aria-hidden="true" />
              </div>
            )}
          </div>

          {/* 浮出的"↓ 最新"按钮 —— 仅在用户向上滚开时显示 */}
          <AnimatePresence>
            {showJumpToBottom && (
              <motion.button
                key="jump-to-bottom"
                type="button"
                onClick={handleJumpToBottom}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="absolute left-1/2 -translate-x-1/2 bottom-3 inline-flex items-center gap-1.5 px-3 h-8 rounded-full surface-overlay border border-[var(--ink-subtle)]/22 text-[12px] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:border-[var(--aurora-1)]/45 transition-colors shadow-[0_8px_22px_-10px_rgba(0,0,0,0.25)]"
                aria-label="滚动到最新消息"
              >
                <ChevronDown className="w-3.5 h-3.5" />
                最新
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* 输入栏（centered，max-w-3xl） —— ModelPicker 内嵌左侧。
            上方加一条从透明到 bg-substrate 的渐变蒙版，让滚动文本"溶入"
            composer 区域，避免最后一行字硬切在 composer 上沿。 */}
        <div className="relative px-3 sm:px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-5 pt-1 max-w-3xl w-full mx-auto">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-6 left-0 right-0 h-6"
            style={{
              background:
                'linear-gradient(to bottom, color-mix(in oklch, var(--bg-substrate) 0%, transparent), var(--bg-substrate))',
            }}
          />
          <Composer
            ref={composerRef}
            value={draft}
            onChange={setDraft}
            onSubmit={handleSend}
            onAbort={handleAbort}
            busy={busy}
            leadingSlot={
              // 移动端 ModelPicker 已经在顶栏下方控制条暴露，composer 内不再
              // 重复渲染（避免触控区域内同一控件出现两次造成歧义 + 节省横向
              // 空间给主行的 @ # / + 发送按钮）。桌面端没有独立控制条，
              // composer 仍承载 ModelPicker。
              // value 三元：override 存在时优先采用（含"自动选择"的 null/null
              // 真值），否则回到 activeSession 存档。EmptyState 下两条路径都
              // 落到正确显示，且用户主动选"自动"不会被会话存档值覆盖。
              <div className="hidden sm:block">
                <ModelPicker
                  value={
                    sessionModelOverride
                      ? sessionModelOverride
                      : {
                          modelId: activeSession?.modelId ?? null,
                          providerCode: activeSession?.providerCode ?? null,
                        }
                  }
                  onChange={handleModelChange}
                  enabled={state.status === 'authed'}
                  placement="top-start"
                  compact
                />
              </div>
            }
            selectedArticles={pendingArticles}
            selectedTags={pendingTags}
            onPickArticle={handlePickArticle}
            onPickTag={handlePickTag}
            onSlashCommand={handleSlashCommand}
            onRemoveArticle={handleRemoveArticle}
            onRemoveTag={handleRemoveTag}
          />
          <p className="mt-1.5 text-center font-mono text-[9.5px] uppercase tracking-[0.24em] text-[var(--ink-muted)]/80">
            灵境 可能出错 · 关键决定请二次核对
          </p>
        </div>
      </section>
    </div>
  );
}

// ============================================================================
// EmptyState —— 居中标题 + prompt suggestion grid
// ============================================================================

function EmptyState({
  siteTitle,
  onPick,
}: {
  siteTitle: string;
  onPick: (text: string) => void;
}) {
  // 标题用 framer-motion 做 stagger 入场 —— 与 /design §S1_Manifesto 同款节奏
  const fade = {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
  };
  const ease = [0.16, 1, 0.3, 1] as const;

  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={{ animate: { transition: { staggerChildren: 0.08 } } }}
      className="h-full min-h-[60vh] flex flex-col items-center justify-center text-center max-w-2xl mx-auto px-4 py-10"
    >
      {/* 中心 aurora 光晕（配合下面的 sparkle icon 形成签名时刻） */}
      <motion.div
        variants={fade}
        transition={{ duration: 0.6, ease }}
        className="relative w-14 h-14 mb-6"
      >
        <div
          className="absolute -inset-3 rounded-full blur-2xl"
          style={{
            background:
              'radial-gradient(closest-side, color-mix(in oklch, var(--aurora-1) 35%, transparent), transparent)',
            animation: 'breath-soft 4.8s ease-in-out infinite',
          }}
          aria-hidden="true"
        />
        <div className="relative w-14 h-14 rounded-2xl bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] text-[var(--aurora-1)] flex items-center justify-center border border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)]">
          <Sparkles className="w-6 h-6" />
        </div>
      </motion.div>

      <motion.p
        variants={fade}
        transition={{ duration: 0.6, ease }}
        className="font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--aurora-1)]/85 mb-4"
      >
        {siteTitle.toUpperCase()} · 灵境
      </motion.p>

      <motion.h2
        variants={fade}
        transition={{ duration: 0.7, ease }}
        className="font-display text-[clamp(1.6rem,4.5vw,2.6rem)] leading-[1.08] text-[var(--ink-primary)] tracking-[-0.02em]"
        style={{
          textWrap: 'balance' as unknown as 'inherit',
          animation: 'breath-soft 4.8s cubic-bezier(0.5, 0, 0.25, 1) infinite',
        }}
      >
        要在 <span className="aurora-text">{siteTitle}</span> 中构建什么？
      </motion.h2>

      <motion.p
        variants={fade}
        transition={{ duration: 0.6, ease, delay: 0.05 }}
        className="mt-3 font-editorial italic text-[var(--ink-secondary)] text-base sm:text-lg max-w-md"
      >
        @ 引用文章 · # 圈定标签 · / 调用命令
      </motion.p>

      <motion.ul
        variants={{ animate: { transition: { staggerChildren: 0.05, delayChildren: 0.15 } } }}
        className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left w-full"
      >
        {PROMPT_SUGGESTIONS.map((p) => (
          <motion.li key={p} variants={fade} transition={{ duration: 0.5, ease }}>
            <button
              type="button"
              onClick={() => onPick(p)}
              data-interactive
              className="group/sug w-full surface-leaf rounded-xl border border-[var(--ink-subtle)]/15 px-4 py-3 text-[13px] text-[var(--ink-secondary)] hover:border-[var(--aurora-1)]/45 hover:text-[var(--ink-primary)] active:scale-[0.985] transition-all text-left flex items-center justify-between gap-2"
            >
              <span>{p}</span>
              <span
                aria-hidden="true"
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] opacity-0 group-hover/sug:opacity-100 group-hover/sug:translate-x-0 -translate-x-1 transition-all"
              >
                ↵
              </span>
            </button>
          </motion.li>
        ))}
      </motion.ul>
    </motion.div>
  );
}

/**
 * RenderingPreferencesButton —— 顶栏挂的"渲染偏好"小弹层。
 * 包含「过渡动画」三段（无 / 淡入 / 平滑）+「字体大小」12-18px 滑块。
 * localStorage 持久化由父组件负责。
 */
function RenderingPreferencesButton({
  displayMode,
  onSetDisplayMode,
  streamAnimation,
  onSetStreamAnimation,
  fontSize,
  onSetFontSize,
}: {
  displayMode: DisplayMode;
  onSetDisplayMode: (m: DisplayMode) => void;
  streamAnimation: StreamAnimationMode;
  onSetStreamAnimation: (m: StreamAnimationMode) => void;
  fontSize: number;
  onSetFontSize: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="渲染偏好"
        title="渲染偏好"
        aria-expanded={open}
        whileTap={{ scale: 0.92 }}
        transition={spring.precise}
        className={`relative inline-flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
          open
            ? 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]'
            : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)]'
        }`}
      >
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={spring.precise}
          className="inline-flex"
        >
          <SlidersHorizontal className="w-[18px] h-[18px]" />
        </motion.span>
        <AnimatePresence>
          {open && (
            <motion.span
              key="ring"
              aria-hidden
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.15 }}
              transition={{ duration: motionDuration.quick, ease: motionEase.out }}
              className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-[color-mix(in_oklch,var(--aurora-1)_38%,transparent)]"
            />
          )}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            variants={panelVariants}
            initial="closed"
            animate="open"
            exit="closed"
            style={{ transformOrigin: 'top right' }}
            role="dialog"
            aria-label="渲染偏好"
            className="absolute right-0 top-full mt-2 w-[280px] rounded-xl border border-[var(--ink-subtle)]/22 bg-[var(--bg-leaf)] shadow-[0_24px_48px_-16px_rgba(0,0,0,0.25)] backdrop-blur-2xl z-40 p-3"
          >
            {/* 显示模式 */}
            <motion.div variants={sectionVariants} className="mb-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-medium text-[var(--ink-primary)]">显示模式</span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                  LAYOUT
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: 'bubble', label: '气泡', hint: '彩色卡片承载' },
                    { value: 'engraved', label: '版书', hint: '文字浮印纸面' },
                  ] as const
                ).map((opt) => {
                  const active = opt.value === displayMode;
                  return (
                    <motion.button
                      key={opt.value}
                      type="button"
                      onClick={() => onSetDisplayMode(opt.value)}
                      aria-pressed={active}
                      whileTap={{ scale: 0.96 }}
                      transition={spring.precise}
                      className={`relative flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)]'
                          : 'border-[var(--ink-subtle)]/15 bg-[var(--bg-raised)]/60 hover:border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)]'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="layout-pill"
                          aria-hidden
                          className="absolute inset-0 -z-0 rounded-lg bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]"
                          transition={spring.soft}
                        />
                      )}
                      <span
                        className={`relative text-[12.5px] font-medium transition-colors ${
                          active ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-primary)]'
                        }`}
                      >
                        {opt.label}
                      </span>
                      <span className="relative text-[10.5px] text-[var(--ink-muted)]">{opt.hint}</span>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>

            {/* 过渡动画 */}
            <motion.div variants={sectionVariants} className="mb-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-medium text-[var(--ink-primary)]">过渡动画</span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                  STREAM
                </span>
              </div>
              <div
                role="radiogroup"
                className="relative grid grid-cols-3 gap-1 rounded-lg border border-[var(--ink-subtle)]/15 bg-[var(--bg-raised)]/60 p-1"
              >
                {(
                  [
                    { value: 'none', label: '无' },
                    { value: 'fade', label: '淡入' },
                    { value: 'smooth', label: '平滑' },
                  ] as const
                ).map((opt) => {
                  const active = opt.value === streamAnimation;
                  return (
                    <motion.button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => onSetStreamAnimation(opt.value)}
                      whileTap={{ scale: 0.94 }}
                      transition={spring.precise}
                      className={`relative h-7 rounded-md text-[12px] transition-colors ${
                        active
                          ? 'text-[var(--aurora-1)]'
                          : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="stream-pill"
                          aria-hidden
                          className="absolute inset-0 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] shadow-[0_2px_6px_-3px_color-mix(in_oklch,var(--aurora-1)_50%,transparent)]"
                          transition={spring.soft}
                        />
                      )}
                      <span className="relative">{opt.label}</span>
                    </motion.button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10.5px] leading-snug text-[var(--ink-muted)]">
                节流模型 SSE 颗粒，平滑越好阅读节奏越稳。
              </p>
            </motion.div>

            {/* 字体大小 */}
            <motion.div variants={sectionVariants}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-medium text-[var(--ink-primary)]">字体大小</span>
                <motion.span
                  key={fontSize}
                  initial={{ opacity: 0, y: -3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: motionDuration.instant, ease: motionEase.out }}
                  className="font-mono text-[10.5px] tabular-nums text-[var(--ink-muted)]"
                >
                  {fontSize}px
                </motion.span>
              </div>
              <input
                type="range"
                min={12}
                max={18}
                step={0.5}
                value={fontSize}
                onChange={(e) => onSetFontSize(Number(e.target.value))}
                aria-label="字体大小"
                className="w-full accent-[var(--aurora-1)]"
              />
              <div className="mt-0.5 flex justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                <span>A</span>
                <span>标准</span>
                <span>A</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const panelVariants = {
  closed: {
    opacity: 0,
    y: -10,
    scale: 0.9,
    transition: {
      ...spring.precise,
      when: 'afterChildren',
      staggerChildren: 0.025,
      staggerDirection: -1,
    },
  },
  open: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      ...spring.soft,
      when: 'beforeChildren',
      delayChildren: 0.05,
      staggerChildren: 0.055,
    },
  },
} as const;

const sectionVariants = {
  closed: { opacity: 0, y: 8 },
  open: { opacity: 1, y: 0, transition: spring.soft },
} as const;
