'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ConfirmModal, spring, duration as motionDuration, ease as motionEase } from '@aetherblog/ui';
import {
  ChevronDown,
  CornerDownLeft,
  Feather,
  FileText,
  Languages,
  Lightbulb,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
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

type SendOptions = {
  articles?: AgentArticle[];
  tags?: AgentTag[];
  session?: AgentSession | null;
  baseMessages?: AgentMessage[];
};

// 空态建议卡 —— icon + 分类眉标 + 文案，四张卡分别用 aurora-1..4 点色
// （只取既有 token 组合，不发明新色）。点击把文案填入 composer。
const PROMPT_SUGGESTIONS: ReadonlyArray<{
  icon: typeof FileText;
  category: string;
  text: string;
  aurora: 1 | 2 | 3 | 4;
}> = [
  { icon: FileText, category: 'Summarize', text: '总结这篇文章的核心观点', aurora: 1 },
  { icon: Feather, category: 'Refine', text: '帮我把这段写得更短', aurora: 2 },
  { icon: Lightbulb, category: 'Ideate', text: '为这个标题生成 5 个备选', aurora: 3 },
  { icon: Languages, category: 'Translate', text: '把这段话翻译成英文', aurora: 4 },
];

// 时段问候 —— EmptyState 仅在客户端鉴权完成后渲染（之前一直是 skeleton），
// 不经过 SSR/hydration，按本地时间取值安全。
function timeGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return '早上好';
  if (h >= 11 && h < 14) return '中午好';
  if (h >= 14 && h < 18) return '下午好';
  if (h >= 18 && h < 23) return '晚上好';
  return '夜深了';
}

// 转义正则元字符,确保用文章/标签名做 RegExp 子模式时安全。
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 从 draft 中清掉残留的 mention token(此前版本 handlePick* 会把 @title/#tag
// 注入 textarea,移除胶囊后这些文字会变孤儿)。当前版本不再注入,本函数只为
// 兼容旧草稿。匹配 "@title" / "#tag" 前后的可选空白,并把多重空白塌缩。
function stripMentionToken(draft: string, prefix: '@' | '#', label: string): string {
  if (!draft) return draft;
  const pattern = new RegExp(`\\s*${escapeRegExp(prefix)}${escapeRegExp(label)}\\s*`, 'g');
  return draft.replace(pattern, ' ').replace(/[ \t]{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
}

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
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearTargetSessionId, setClearTargetSessionId] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // 桌面端 sidebar collapse —— 与移动端 drawer 互不影响
  const [desktopSidebarHidden, setDesktopSidebarHidden] = useState(false);
  // 当前会话显式引用的文章 / 标签。发送后继续保留，供追问和重试复用；
  // 手动移除、清空会话或切换会话时再同步到对应会话上下文。
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
  // 当前 streaming 消息的服务端累加快照（含尚未画到屏幕的 buffer 尾巴）。
  // 用户按"停止"/切会话时，finalize 用它兜底 content —— 否则消息定格在最后
  // 一个已绘制帧，把服务端已送达但还在追帧的几百字符悄悄丢掉。
  const streamAccRef = useRef<{ msgId: string; content: string; think: string } | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  // 稳定的内容容器(空态/对话态都包在它里),供 ResizeObserver 锚定跟随。
  const contentRef = useRef<HTMLDivElement>(null);

  // ---- 渲染偏好（显示模式 / 流式吐字模式 / 字体大小），localStorage 持久化 ----
  const [displayMode, setDisplayMode] = useState<DisplayMode>('bubble');
  const [streamAnimation, setStreamAnimation] = useState<StreamAnimationMode>('smooth');
  const [fontSize, setFontSize] = useState<number>(14.5);
  // sendText 的 rAF tick 实时读这个 ref —— 用户流式中切"过渡动画"档位立即生效，
  // 又不必把 streamAnimation 放进 sendText 依赖（避免重建进行中的闭包）。
  const streamAnimationRef = useRef<StreamAnimationMode>(streamAnimation);
  useEffect(() => {
    streamAnimationRef.current = streamAnimation;
  }, [streamAnimation]);
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

  // ---- 持久化（防抖） ----
  // 流式期间 sessions 每帧都在变（rAF 推进 displayed），直接在 effect 里
  // saveSessions 等于 ~60 次/秒全量 JSON.stringify + 写盘 —— 长会话下这是
  // 主线程卡顿的大头。改为 600ms 尾随防抖；页面隐藏 / 卸载 / 组件销毁时
  // 立即 flush，保证不丢最后一段。
  const sessionsRef = useRef<AgentSession[]>(sessions);
  const persistTimerRef = useRef<number | null>(null);
  useEffect(() => {
    sessionsRef.current = sessions;
    if (userId == null) return;
    if (persistTimerRef.current != null) return; // 已有待写任务，尾随合并
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      saveSessions(userId, sessionsRef.current);
    }, 600);
  }, [sessions, userId]);
  useEffect(() => {
    if (userId == null) return;
    const flush = () => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      saveSessions(userId, sessionsRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [userId]);

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
        // 服务端累加快照兜底 —— 把还没追帧画出来的 buffer 尾巴一并落库，
        // 中断不丢已生成内容（对齐 ChatGPT「停止仍保留全部已出字」行为）。
        const snap = streamAccRef.current?.msgId === targetId ? streamAccRef.current : null;
        setSessions((list) =>
          list.map((s) =>
            s.id === sessId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === targetId
                      ? {
                          ...m,
                          content: snap && snap.content.length > m.content.length ? snap.content : m.content,
                          think: snap && snap.think.length > (m.think?.length ?? 0) ? snap.think : m.think,
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
      streamAccRef.current = null;
      setBusy(false);
    },
    [activeId],
  );

  const handleCreate = useCallback(() => {
    // 新建（=切换会话）前先把进行中的流按"停止"语义收尾 —— 与 handleSelect
    // 同款纪律。侧栏"新对话"按钮和 ⌘⇧O 快捷键都走这里；不收尾的话 activeId
    // 切走后原 assistant 消息永远停在 pending:true 被持久化成幻影，且在新
    // 会话里按"停止"时 finalize 闭包的 activeId 已指向新会话，patch 错对象。
    if (streamingMsgIdRef.current) {
      finalizeStreamingMessage('已中断');
    }
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
  }, [sessions, sessionModelOverride, finalizeStreamingMessage]);

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

  const handleDelete = useCallback(
    (id: string) => {
      // 删的是正在 streaming 的活跃会话 → 先按"停止"语义收尾，释放
      // AbortController / busy，避免幽灵流继续往已删除的会话里写 patch。
      if (id === activeId && streamingMsgIdRef.current) {
        finalizeStreamingMessage('已中断');
      }
      setSessions((list) => list.filter((s) => s.id !== id));
      // 如果删的是当前活跃会话，自动切到剩余第一个。setActiveId 不能嵌在
      // setSessions updater 里调用 —— updater 必须保持纯函数（StrictMode
      // 会双调用，副作用跟着跑两遍）。
      setActiveId((curr) => {
        if (curr !== id) return curr;
        const next = sessionsRef.current.filter((s) => s.id !== id);
        return next[0]?.id ?? null;
      });
    },
    [activeId, finalizeStreamingMessage],
  );

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
  // 流式更新由 WorkspaceClient 这一层统一推进：服务端 SSE chunk 先累加到
  // raw acc/thinkAcc，再通过 rAF 追帧写入 message.content。MessageBubble 直接
  // 渲染屏幕态，避免双重 typewriter 互相拖慢；think 段单独作为副面板流式展示。
  // 拆分 send 流程的实际执行体：把"text 作为字符串入参"暴露出来，让
  // handleSend / handleRetry / handleResubmitEdited 都能复用同一份 streaming 逻辑。
  // handleSend 之外的调用方（重试 / 编辑后重发）已自行 setDraft('')，所以这里
  // 不再清空 draft —— 否则会破坏"用户编辑中按钮无意触发清空 textarea"的体感。
  //
  // baseMessages：调用方显式指定的历史基线。重试路径必须传 —— 它先 setSessions
  // 截断再同步调 sendText，此刻无论闭包还是 sessionsRef 都还是截断前的旧快照
  // （ref 在 effect 里同步，要等下一次 commit）；不传的话 history 会把"刚被
  // 截掉的旧 assistant 回复 + user 消息"重复发给模型，重试结果必然串台。
  //
  // 会话经 sessionsRef 按 activeId 查而非闭包 activeSession —— 流式期间
  // sessions 每帧都变，依赖 activeSession 会让本回调（连同下游 handleSend /
  // handleRetry）每帧重建，把 MessageBubble 的 memo 击穿成全量重渲。
  const sendText = useCallback(async (text: string, options?: SendOptions) => {
    if (!text || busy || state.status !== 'authed') return;

    const requestArticles = options?.articles ?? pendingArticles;
    const requestTags = options?.tags ?? pendingTags;
    let session = options?.session ?? sessionsRef.current.find((s) => s.id === activeId) ?? null;
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
        contextArticles: requestArticles,
        contextTags: requestTags,
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
      contextArticles: requestArticles.length ? requestArticles : undefined,
      contextTags: requestTags.length ? requestTags : undefined,
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
    streamAccRef.current = { msgId: targetMessageId, content: '', think: '' };

    setSessions((list) =>
      list.map((s) =>
        s.id === sessId
          ? {
              ...s,
              title: s.messages.length === 0 ? deriveSessionTitle(text) : s.title,
              contextArticles: requestArticles,
              contextTags: requestTags,
              updatedAt: Date.now(),
              messages: [...s.messages, userMsg, assistantMsg],
            }
          : s,
      ),
    );
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const history = [...(options?.baseMessages ?? session.messages), userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // === 流式累加 + rAF 平滑显示 ===
    // 这是吐字平滑的唯一管线 —— MessageBubble 直接渲染 message.content，不再
    // 二次节流。历史版本在这里追帧之外，bubble 内又叠了一层 useSmoothStream
    // （固定 45 chars/s），两个 typewriter 互相竞争：实际可见速率被钉死在
    // 45 chars/s，长回答 lag 滚雪球，流结束瞬间整段瞬移 —— 这正是"卡顿 +
    // 内容跳变"的根因。单管线后速率自适应、终态平滑收尾。
    let acc = '';                                // server 累加
    let displayed = '';                          // UI 实际显示
    let thinkAcc = '';
    let firstTokenAt: number | null = null;
    let streamDone = false;                      // server 已发 done/error
    let finalPatch: Partial<AgentMessage> | null = null;
    let pendingMisc: Partial<AgentMessage> = {}; // think / sources / firstTokenAt 待写
    let rafId = 0;
    let lastPaintAt = 0;                         // 长文降帧用的上次提交时间

    // stride —— 当 lag 越大越激进追赶；流结束后再加速一档让收尾感更利落。
    const computeStride = (lag: number, finishing: boolean): number => {
      if (finishing) return Math.max(8, Math.ceil(lag / 5));
      if (lag > 600) return Math.ceil(lag / 12);
      if (lag > 200) return Math.ceil(lag / 18);
      if (lag > 60) return 5;
      if (lag > 20) return 3;
      return 2;
    };

    // 长内容降帧：每帧 setState 都会让 StreamMarkdown 全量重 parse（remark 是
    // O(文档长度)），60fps × 长文档 = 主线程被 parse 吃满。按长度把提交频率
    // 降到 ~30/20fps —— 阅读节奏无感知，CPU 直接砍半以上。
    const minPaintInterval = (len: number): number => {
      if (len > 6000) return 48; // ~20fps
      if (len > 2500) return 32; // ~30fps
      return 0;                  // 短文档全帧率
    };

    const tick = () => {
      rafId = 0;

      // 降帧窗口内先跳过本帧（继续排队），stride 的 lag 自适应会自动补上进度
      const nowTs = performance.now();
      const interval = minPaintInterval(acc.length);
      if (interval > 0 && nowTs - lastPaintAt < interval && displayed.length < acc.length) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastPaintAt = nowTs;

      // 推进 displayed —— '无动画'档直接对齐，其余按 stride 匀速追赶
      if (displayed.length < acc.length) {
        if (streamAnimationRef.current === 'none') {
          displayed = acc;
        } else {
          const lag = acc.length - displayed.length;
          const stride = computeStride(lag, streamDone);
          const nextLen = Math.min(displayed.length + stride, acc.length);
          displayed = acc.slice(0, nextLen);
        }
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

    // 会话级引用上下文会持续保留：用户选中文章后，后续追问与重试默认仍带上
    // 同一批素材；只有手动移除 chip 或切换会话才改变上下文。
    const articleIds = requestArticles.map((a) => a.id);
    const tagSlugs = requestTags.map((t) => t.slug);

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
          if (streamAccRef.current?.msgId === targetMessageId) {
            streamAccRef.current.content = acc;
          }
          if (firstTokenAt == null) {
            firstTokenAt = Date.now();
            pendingMisc.firstTokenAt = firstTokenAt;
          }
          schedule();
        },
        onThink: (chunk) => {
          thinkAcc += chunk;
          if (streamAccRef.current?.msgId === targetMessageId) {
            streamAccRef.current.think = thinkAcc;
          }
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
          // 空回复兜底：流正常结束但一个正文 token 都没有 —— 不能留一张空白
          // 气泡让用户干瞪眼，标记成可重试的错误态（retry 按钮随之出现）。
          if (!acc.trim()) {
            finalPatch.error = '模型未返回内容，请重试';
          }
          schedule();
        },
        onError: (msg) => {
          // error 立即 flush 给用户看，不再等下一帧合并。
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
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

    if (streamingMsgIdRef.current === targetMessageId) {
      streamingMsgIdRef.current = null;
    }
    if (streamAccRef.current?.msgId === targetMessageId) {
      streamAccRef.current = null;
    }
    setBusy(false);
  }, [busy, state, activeId, pendingArticles, pendingTags, sessionModelOverride]);

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
      const nextArticles = message.contextArticles ?? activeSession?.contextArticles ?? [];
      const nextTags = message.contextTags ?? activeSession?.contextTags ?? [];
      setPendingArticles(nextArticles);
      setPendingTags(nextTags);
      setDraft(message.content);
      requestAnimationFrame(() => composerRef.current?.focus());
    },
    [busy, activeId, activeSession?.contextArticles, activeSession?.contextTags],
  );

  // assistant 消息「重试」：找到该消息上一条 user msg，把 assistant（含自身）
  // 之后所有消息截断，立刻用 user 内容重新发起 streaming。错误态 / 完成态都
  // 走这一条路径。截断后的基线必须显式传给 sendText（baseMessages）——
  // sendText 闭包里的 activeSession 仍是截断前的旧快照，靠它组 history 会把
  // 被截掉的旧回复重复发给模型。
  const handleRetryAssistantMessage = useCallback(
    (message: AgentMessage) => {
      if (busy) return;
      if (message.role !== 'assistant') return;
      // 经 sessionsRef 查会话：直接依赖 sessions 会让本回调在流式期间每帧
      // 重建（onRetry 引用变化击穿所有 MessageBubble 的 memo）。点击时 ref
      // 必然已同步（effect 在上一次 commit 后跑完）。
      const sess = sessionsRef.current.find((s) => s.id === activeId);
      if (!sess) return;
      const idx = sess.messages.findIndex((m) => m.id === message.id);
      if (idx <= 0) return;
      const prior = sess.messages[idx - 1];
      if (prior.role !== 'user') return;
      const retryArticles = prior.contextArticles ?? sess.contextArticles ?? [];
      const retryTags = prior.contextTags ?? sess.contextTags ?? [];
      // 截断到上一条 user 之前（不含 user 本身）—— sendText 会重新把它 push 回去。
      const base = sess.messages.slice(0, idx - 1);
      const retrySession: AgentSession = {
        ...sess,
        contextArticles: retryArticles,
        contextTags: retryTags,
        messages: base,
        updatedAt: Date.now(),
      };
      setPendingArticles(retryArticles);
      setPendingTags(retryTags);
      setSessions((list) =>
        list.map((s) =>
          s.id === sess.id
            ? retrySession
            : s,
        ),
      );
      void sendText(prior.content, {
        articles: retryArticles,
        tags: retryTags,
        session: retrySession,
        baseMessages: base,
      });
    },
    [busy, activeId, sendText],
  );

  const handleSuggestion = useCallback((text: string) => {
    setDraft(text);
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  const persistActiveContext = useCallback(
    (articles: AgentArticle[], tags: AgentTag[]) => {
      if (!activeId) return;
      setSessions((list) =>
        list.map((s) =>
          s.id === activeId
            ? { ...s, contextArticles: articles, contextTags: tags, updatedAt: Date.now() }
            : s,
        ),
      );
    },
    [activeId],
  );

  // ---- @ / # / / picker handlers ----
  // 引用 token 与 textarea 文本解耦 —— ChatGPT / Codex 风格:已选项以独立胶囊
  // 在 composer 上方呈现,textarea 内只放纯用户输入。这样移除胶囊不会留下脏文本,
  // 也避免胶囊与文本"双份"显示导致歧义。这些 chip 是会话级显式上下文:
  // 发送、重试、追问都会复用，直到用户手动移除。
  const handlePickArticle = useCallback((article: AgentArticle) => {
    const next = pendingArticles.some((a) => a.id === article.id)
      ? pendingArticles.filter((a) => a.id !== article.id)
      : [...pendingArticles, article];
    setPendingArticles(next);
    persistActiveContext(next, pendingTags);
  }, [pendingArticles, pendingTags, persistActiveContext]);

  const handlePickTag = useCallback((tag: AgentTag) => {
    const next = pendingTags.some((t) => t.slug === tag.slug)
      ? pendingTags.filter((t) => t.slug !== tag.slug)
      : [...pendingTags, tag];
    setPendingTags(next);
    persistActiveContext(pendingArticles, next);
  }, [pendingArticles, pendingTags, persistActiveContext]);

  // remove handler 同时清理 draft 中可能残留的旧 "@title" / "#tag" 文本 ——
  // 兼容此前版本 insert 到 textarea 的会话草稿。
  const handleRemoveArticle = useCallback(
    (id: number) => {
      const target = pendingArticles.find((a) => a.id === id);
      if (target) {
        setDraft((d) => stripMentionToken(d, '@', target.title));
      }
      const next = pendingArticles.filter((a) => a.id !== id);
      setPendingArticles(next);
      persistActiveContext(next, pendingTags);
    },
    [pendingArticles, pendingTags, persistActiveContext],
  );
  const handleRemoveTag = useCallback(
    (slug: string) => {
      const target = pendingTags.find((t) => t.slug === slug);
      if (target) {
        setDraft((d) => stripMentionToken(d, '#', target.name));
      }
      const next = pendingTags.filter((t) => t.slug !== slug);
      setPendingTags(next);
      persistActiveContext(pendingArticles, next);
    },
    [pendingArticles, pendingTags, persistActiveContext],
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
        setClearTargetSessionId(activeId);
        setClearConfirmOpen(true);
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
              if (u) {
                const nextArticles = u.contextArticles ?? s.contextArticles ?? [];
                const nextTags = u.contextTags ?? s.contextTags ?? [];
                setPendingArticles(nextArticles);
                setPendingTags(nextTags);
                setDraft(u.content);
                return {
                  ...s,
                  contextArticles: nextArticles,
                  contextTags: nextTags,
                  messages: msgs,
                  updatedAt: Date.now(),
                };
              }
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

  const closeClearConfirm = useCallback(() => {
    setClearConfirmOpen(false);
    setClearTargetSessionId(null);
  }, []);

  const handleConfirmClear = useCallback(() => {
    if (!clearTargetSessionId) {
      closeClearConfirm();
      return;
    }
    // 清的是正在 streaming 的会话 → 先收尾，否则 abort 不会发生，幽灵流
    // 继续往已清空的消息列表里找 target patch（找不到但 busy 一直挂着）。
    if (clearTargetSessionId === activeId && streamingMsgIdRef.current) {
      finalizeStreamingMessage('已中断');
    }
    setSessions((list) =>
      list.map((s) =>
        s.id === clearTargetSessionId
          ? {
              ...s,
              messages: [],
              contextArticles: [],
              contextTags: [],
              updatedAt: Date.now(),
            }
          : s,
      ),
    );
    if (activeId === clearTargetSessionId) {
      setPendingArticles([]);
      setPendingTags([]);
    }
    closeClearConfirm();
  }, [activeId, clearTargetSessionId, closeClearConfirm, finalizeStreamingMessage]);

  // 切换会话时恢复该会话自己的显式上下文，避免引用串台或刷新后丢失。
  useEffect(() => {
    setPendingArticles(activeSession?.contextArticles ?? []);
    setPendingTags(activeSession?.contextTags ?? []);
  }, [activeSession?.id, activeSession?.contextArticles, activeSession?.contextTags]);

  // 智能滚动 —— 对齐 ChatGPT / Claude / Codex 的"流式跟随"心智模型：
  //   · 用户在底部 → 新消息 / 流式增量自动跟随；
  //   · 用户一旦主动上滑（滚轮 / 触摸）→ **立即、彻底**脱离跟随,不再被后续
  //     增量拽回底部 —— 这正是"边输出边上滑查看会反复跳动"的根因:旧实现要等
  //     scroll 事件越过距离阈值才松手,而流式每帧都在写 scrollTop,二者赛跑,
  //     用户每滑一点就被下一个 token 拽回。改成"手势即松手"后,意图先于增量,
  //     抖动消失；
  //   · 回到底部附近 → 自动重新粘底；浮出的 "↓ 最新" 可一键平滑回底。
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  // 滚动监听:双阈值迟滞(hysteresis)判定粘底,避免临界处因一帧增量在
  // "粘底 / 脱离"间反复横跳 —— 关键是给手势 release() 留出生效窗口:
  //   · 仅在极贴底(<16px)时才重新自动粘底;
  //   · 仅在彻底离底(>=64px)时才自动脱离;
  //   · 16–64px 的微调滚动不主动改粘底状态。
  // 旧的单阈值(distance < 64 直接赋值)会把刚被 release() 的小幅上滑(如 30px)
  // 又判回粘底,使手势脱离在小幅滚动时失效、用户被后续 token 拽回底部。
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distance < 16) {
        stickToBottomRef.current = true;
      } else if (distance >= 64) {
        stickToBottomRef.current = false;
      }
      setShowJumpToBottom(distance >= 64);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeId]);

  // 用户"想回看历史"的手势意图 → 立刻松手(早于 scroll 事件与增量的赛跑)。
  // 这是消除流式中反复跳动的关键一招。
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const release = () => {
      if (!stickToBottomRef.current) return;
      // 没有可上滑的空间(内容未溢出 / 已在顶部)就别脱离粘底 —— 否则短对话里
      // 一次无效的上滑手势会让 ResizeObserver 停止跟随,新回答被卡在视野之外、
      // 还误浮出"↓ 最新"。仅当确有向上滚动余量(scrollTop > 0)时才松手。
      if (el.scrollTop <= 0) return;
      stickToBottomRef.current = false;
      setShowJumpToBottom(true);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) release(); // 向上滚(含触控板亚像素 -0.x 的慢速滚动)
    };
    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y - touchY > 4) release(); // 手指下移 = 内容上滚 = 回看
      touchY = y;
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [activeId]);

  // 切会话：无条件锁回底部。
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    el.scrollTop = el.scrollHeight;
  }, [activeId]);

  // 跟随内容高度变化 —— ResizeObserver 在「布局完成后」触发,且浏览器每帧最多
  // 回调一次(自动去重)。这比"每个流式增量 setState 后手写 scrollTop"更稳、更省:
  //   · 流式增量、Shiki 异步高亮改变代码块高度、StreamMarkdown→完整渲染切换、
  //     思考面板展开 —— 这些「事后高度变化」都会触发它,粘底时精确重锚到真实底部,
  //     根除上下滑动时的「定位卡顿 / 乱窜」;
  //   · 仅在粘底时才写 scrollTop,用户上滑回看时高度变化绝不动其视野。
  useEffect(() => {
    const content = contentRef.current;
    const el = threadRef.current;
    if (!content || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [activeId]);

  const handleJumpToBottom = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
  }, []);

  // 快捷键：⌘/Ctrl + Shift + O 新建对话 —— 对齐 ChatGPT 的肌肉记忆，键盘党
  // 不必摸鼠标去点侧栏。e.key 在 Shift 按下时是大写 'O'，两种都接。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        handleCreate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleCreate]);

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
            <motion.button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="打开侧栏"
              whileTap={{ scale: 0.9 }}
              transition={spring.precise}
              className="md:hidden inline-flex items-center justify-center w-10 h-10 -ml-1 rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] transition-colors"
            >
              <Menu className="w-[18px] h-[18px]" />
            </motion.button>
            <motion.button
              type="button"
              onClick={() => setDesktopSidebarHidden((v) => !v)}
              aria-label={desktopSidebarHidden ? '展开侧栏' : '收起侧栏'}
              title={desktopSidebarHidden ? '展开侧栏' : '收起侧栏'}
              whileTap={{ scale: 0.9 }}
              transition={spring.precise}
              className="hidden md:inline-flex items-center justify-center w-9 h-9 rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] transition-colors"
            >
              {desktopSidebarHidden ? (
                <PanelLeftOpen className="w-[18px] h-[18px]" />
              ) : (
                <PanelLeftClose className="w-[18px] h-[18px]" />
              )}
            </motion.button>
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="max-w-[48vw] truncate text-[14px] font-medium leading-none text-[var(--ink-primary)] sm:max-w-[24rem]"
                title={activeSession?.title || ''}
              >
                {activeSession?.title || '尚未选择会话'}
              </span>
              {/* 生成态徽标 —— 用户上滑回看历史时，顶栏仍能感知"流还在跑"。
                  AnimatePresence 让它出入场都柔和，不抖动标题。 */}
              <AnimatePresence>
                {busy && (
                  <motion.span
                    key="streaming-badge"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] px-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--aurora-1)]"
                  >
                    <span className="agent-thinking-live-dot" aria-hidden="true" />
                    生成中
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* 顶栏右侧 —— 仅保留主题 + 渲染偏好两枚等距图标按钮。
              会话模式(Chat/Cowork/Code)整体收进渲染偏好面板：Chat 是唯一已上线
              模式，常驻一枚"Chat"胶囊只是噪声；移除后顶栏回到 Codex 式的克制。 */}
          <div className="flex items-center gap-0.5 sm:gap-1">
            <ThemeToggle size="sm" />
            <RenderingPreferencesButton
                mode={activeSession?.mode || 'chat'}
                onModeChange={handleModeChange}
                displayMode={displayMode}
                onSetDisplayMode={setDisplayMode}
                streamAnimation={streamAnimation}
                onSetStreamAnimation={setStreamAnimation}
                fontSize={fontSize}
                onSetFontSize={setFontSize}
              />
          </div>
          {/* 底缘极光发丝线（§05 Header）—— 中心一缕极光，向两端渐隐为中性 hairline，
              叠在 border-b 之上,给顶栏一个克制的"光源"签名而不喧宾夺主。 */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
            style={{
              background:
                'linear-gradient(90deg, transparent, color-mix(in oklch, var(--aurora-1) 28%, transparent) 50%, transparent)',
            }}
          />
        </header>

        {/* 对话流 */}
        <div className="relative flex-1 min-h-0">
          <div
            ref={threadRef}
            className="agent-thumb-scroll absolute inset-0 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {/* 稳定容器 —— 不随空态/对话态切换而换节点,ResizeObserver 始终能观察到它,
                因此 Shiki 异步高亮、流式增量、思考面板展开等"事后高度变化"都能被捕获并
                在粘底时精确重锚,消除卡顿 / 乱窜。min-h-full 保证空态仍能垂直居中。 */}
            <div ref={contentRef} className="min-h-full">
              {!activeSession || activeSession.messages.length === 0 ? (
                <EmptyState
                  siteTitle={siteTitle}
                  nickname={state.user.nickname || state.user.username}
                  onPick={handleSuggestion}
                />
              ) : (
                <div className="px-3 sm:px-6 py-6 sm:py-8">
                  <div className="mx-auto w-full max-w-[820px] space-y-6 sm:space-y-7">
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
                </div>
              )}
            </div>
          </div>

          {/* 浮出的滚动到底部按钮 —— 仅在用户向上滚开时显示 */}
          <AnimatePresence>
            {showJumpToBottom && (
              <motion.div
                key="jump-to-bottom"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"
              >
                <button
                  type="button"
                  onClick={handleJumpToBottom}
                  className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full surface-overlay border border-[var(--ink-subtle)]/22 text-[var(--ink-secondary)] shadow-[0_8px_22px_-10px_rgba(0,0,0,0.25)] transition-colors hover:border-[var(--aurora-1)]/45 hover:text-[var(--ink-primary)]"
                  aria-label="滚动到最新消息"
                  title="滚动到最新消息"
                >
                  <ChevronDown className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 输入栏（centered，max-w-[820px]） —— ModelPicker 内嵌左侧。
            上方加一条从透明到 bg-substrate 的渐变蒙版，让滚动文本"溶入"
            composer 区域，避免最后一行字硬切在 composer 上沿。 */}
        <div className="relative px-3 sm:px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-5 pt-1">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-6 left-0 right-0 h-6"
            style={{
              background:
                'linear-gradient(to bottom, color-mix(in oklch, var(--bg-substrate) 0%, transparent), var(--bg-substrate))',
            }}
          />
          <div className="mx-auto w-full max-w-[820px]">
            <Composer
              ref={composerRef}
              value={draft}
              onChange={setDraft}
              onSubmit={handleSend}
              onAbort={handleAbort}
              busy={busy}
              leadingSlot={
                // 移动端旧的"顶栏下方控制条"已移除,模型选择改为在 composer 左下角
                // 暴露 —— 与桌面端共用同一入口,前后端一致语义。
                // value 三元:override 存在时优先采用(含"自动选择"的 null/null
                // 真值),否则回到 activeSession 存档。EmptyState 下两条路径都
                // 落到正确显示,且用户主动选"自动"不会被会话存档值覆盖。
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
              }
              selectedArticles={pendingArticles}
              selectedTags={pendingTags}
              onPickArticle={handlePickArticle}
              onPickTag={handlePickTag}
              onSlashCommand={handleSlashCommand}
              onRemoveArticle={handleRemoveArticle}
              onRemoveTag={handleRemoveTag}
            />
          </div>
        </div>
      </section>
      <ConfirmModal
        isOpen={clearConfirmOpen}
        title="清空当前会话？"
        message="这会移除当前会话中的所有消息，但保留会话本身。此操作不可撤销。"
        confirmText="清空"
        cancelText="取消"
        variant="warning"
        zIndex={1000}
        onConfirm={handleConfirmClear}
        onCancel={closeClearConfirm}
      />
    </div>
  );
}

// ============================================================================
// EmptyState —— 居中标题 + prompt suggestion grid
// ============================================================================

function EmptyState({
  siteTitle,
  nickname,
  onPick,
}: {
  siteTitle: string;
  /** 已登录用户昵称 —— 时段问候人格化（"晚上好，{name}"）。 */
  nickname: string;
  onPick: (text: string) => void;
}) {
  // 标题用 framer-motion 做 stagger 入场 —— 与 /design §S1_Manifesto 同款节奏
  const fade = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
  };
  const ease = [0.16, 1, 0.3, 1] as const;

  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={{ animate: { transition: { staggerChildren: 0.07 } } }}
      className="mx-auto flex h-full min-h-[60vh] max-w-2xl flex-col items-center justify-center px-5 py-12 text-center"
    >
      {/* 签名标记 —— 一枚克制的呼吸光点。不再是发光的紫色方块:边框走 ink hairline,
          仅内部图标与一层低透明度光晕保留极光,让"光"成为点睛而非主色。 */}
      <motion.div
        variants={fade}
        transition={{ duration: 0.6, ease }}
        className="relative mb-7 grid h-12 w-12 place-items-center"
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full opacity-55 blur-xl"
          style={{
            background:
              'radial-gradient(closest-side, color-mix(in oklch, var(--aurora-1) 24%, transparent), transparent)',
            animation: 'breath-soft 4.8s ease-in-out infinite',
          }}
        />
        <span className="relative grid h-12 w-12 place-items-center rounded-2xl border border-[var(--ink-subtle)]/22 bg-[var(--bg-leaf)] text-[var(--aurora-1)] shadow-[0_1px_0_inset_color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
          <Sparkles className="h-5 w-5" strokeWidth={1.6} />
        </span>
      </motion.div>

      <motion.p
        variants={fade}
        transition={{ duration: 0.6, ease }}
        className="mb-4 font-mono text-[10px] uppercase tracking-[0.34em] text-[var(--ink-muted)]"
      >
        灵境 · {siteTitle}
      </motion.p>

      <motion.h2
        variants={fade}
        transition={{ duration: 0.7, ease }}
        className="font-display text-[clamp(1.7rem,4.6vw,2.7rem)] leading-[1.1] tracking-[-0.02em] text-[var(--ink-primary)]"
        style={{ textWrap: 'balance' as unknown as 'inherit' }}
      >
        {timeGreeting()}，{nickname}
      </motion.h2>

      <motion.p
        variants={fade}
        transition={{ duration: 0.6, ease, delay: 0.05 }}
        className="mt-3.5 max-w-md font-editorial text-[15px] italic leading-relaxed text-[var(--ink-secondary)] sm:text-base"
      >
        随手发问，或以 @ 引用文章 · # 圈定标签 · / 调用命令。
      </motion.p>

      <motion.ul
        variants={{ animate: { transition: { staggerChildren: 0.05, delayChildren: 0.18 } } }}
        className="mt-9 grid w-full grid-cols-1 gap-2.5 text-left sm:grid-cols-2"
      >
        {PROMPT_SUGGESTIONS.map((p) => {
          const Icon = p.icon;
          const auroraVar = `var(--aurora-${p.aurora})`;
          return (
            <motion.li key={p.text} variants={fade} transition={{ duration: 0.5, ease }}>
              <button
                type="button"
                onClick={() => onPick(p.text)}
                data-interactive
                className="group/sug surface-leaf flex w-full items-center gap-3 rounded-2xl border border-[var(--ink-subtle)]/14 px-4 py-3.5 text-left transition-[transform,color,border-color] duration-quick ease-aether hover:-translate-y-px active:translate-y-0 active:scale-[0.99]"
              >
                <span
                  aria-hidden="true"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform duration-quick ease-aether group-hover/sug:scale-105"
                  style={{
                    color: auroraVar,
                    background: `color-mix(in oklch, ${auroraVar} 11%, transparent)`,
                    boxShadow: `0 1px 0 inset color-mix(in oklch, ${auroraVar} 16%, transparent)`,
                  }}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[9px] uppercase tracking-[0.26em] text-[var(--ink-muted)]">
                    {p.category}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] leading-snug text-[var(--ink-secondary)] transition-colors duration-quick ease-aether group-hover/sug:text-[var(--ink-primary)]">
                    {p.text}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="grid h-6 w-6 shrink-0 -translate-x-1 place-items-center rounded-lg text-[var(--ink-muted)] opacity-0 transition-all duration-quick ease-aether group-hover/sug:translate-x-0 group-hover/sug:opacity-100"
                  style={{ color: auroraVar }}
                >
                  <CornerDownLeft className="h-3.5 w-3.5" />
                </span>
              </button>
            </motion.li>
          );
        })}
      </motion.ul>
    </motion.div>
  );
}

/**
 * RenderingPreferencesButton —— 顶栏挂的"渲染偏好"小弹层。
 * 包含「会话模式」segmented + 「显示模式」+「过渡动画」+「字体大小」。
 * localStorage 持久化由父组件负责。
 */
function RenderingPreferencesButton({
  mode,
  onModeChange,
  displayMode,
  onSetDisplayMode,
  streamAnimation,
  onSetStreamAnimation,
  fontSize,
  onSetFontSize,
}: {
  mode: AgentMode;
  onModeChange: (m: AgentMode) => void;
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
            {/* 会话模式 (Chat / Cowork / Code) */}
            <motion.div variants={sectionVariants} className="mb-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-medium text-[var(--ink-primary)]">会话模式</span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                  MODE
                </span>
              </div>
              <ModeSwitch value={mode} onChange={onModeChange} variant="grid" />
            </motion.div>

            {/* 显示模式 */}
            <motion.div variants={sectionVariants} className="mb-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-medium text-[var(--ink-primary)]">显示模式</span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                  LAYOUT
                </span>
              </div>
              <AgentSegmentedControl
                ariaLabel="显示模式"
                value={displayMode}
                options={[
                  { value: 'bubble', label: '气泡', title: '彩色卡片承载' },
                  { value: 'engraved', label: '版书', title: '文字浮印纸面' },
                ]}
                onChange={(v) => onSetDisplayMode(v as DisplayMode)}
              />
            </motion.div>

            {/* 过渡动画 */}
            <motion.div variants={sectionVariants} className="mb-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-medium text-[var(--ink-primary)]">过渡动画</span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                  STREAM
                </span>
              </div>
              <AgentSegmentedControl
                ariaLabel="过渡动画"
                value={streamAnimation}
                options={[
                  { value: 'none', label: '无' },
                  { value: 'fade', label: '淡入' },
                  { value: 'smooth', label: '平滑' },
                ]}
                onChange={(v) => onSetStreamAnimation(v as StreamAnimationMode)}
              />
              <p className="mt-1.5 text-[10.5px] leading-snug text-[var(--ink-muted)]">
                节流模型 SSE 颗粒，平滑越好阅读节奏越稳。
              </p>
            </motion.div>

            {/* 字体大小 */}
            <motion.div variants={sectionVariants}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-medium text-[var(--ink-primary)]">字体大小</span>
                <span className="font-mono text-[10.5px] tnum text-[var(--ink-muted)]">
                  {fontSize}px
                </span>
              </div>
              <input
                type="range"
                min={12}
                max={18}
                step={0.5}
                value={fontSize}
                onChange={(e) => onSetFontSize(Number(e.target.value))}
                aria-label="字体大小"
                className="agent-range w-full"
                style={
                  {
                    '--agent-range-progress': `${(fontSize - 12) / (18 - 12)}`,
                  } as CSSProperties
                }
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

function AgentSegmentedControl({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string; title?: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const activeIndex = Math.max(0, options.findIndex((opt) => opt.value === value));

  // 颜色全部走 Codex token（ink / bg），:root.light 自动翻转 —— 不写 dark: 变体、
  // 不发明新色（设计系统硬规则 §3.4 #1/#5）。滑块用 --bg-raised 实色卡 + 中性
  // 阴影，两主题下都与 surface 体系一致。
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="relative flex items-center rounded-[14px] bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-[3px] shadow-[inset_0_1px_2px_color-mix(in_oklch,var(--ink-primary)_10%,transparent)]"
    >
      <div
        className="absolute bottom-[3px] top-[3px] rounded-[11px] bg-[var(--bg-raised)] shadow-[0_3px_8px_rgba(0,0,0,0.16),0_1px_1px_rgba(0,0,0,0.10),inset_0_0_0_0.5px_color-mix(in_oklch,var(--ink-primary)_10%,transparent)] transition-[transform] duration-[400ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)] motion-reduce:transition-none"
        style={{
          left: 3,
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
          willChange: 'transform',
        }}
        aria-hidden
      />

      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={`relative z-10 flex h-9 flex-1 items-center justify-center rounded-[11px] text-[12.5px] font-semibold tracking-normal transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)] focus-visible:ring-offset-[var(--bg-leaf)] ${
              active
                ? 'text-[var(--ink-primary)]'
                : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
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
