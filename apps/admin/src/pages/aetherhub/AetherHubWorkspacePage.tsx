import React, {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  ElementType,
  KeyboardEvent,
  ReactNode,
  RefObject,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  AtSign,
  BookOpen,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Copy,
  FileText,
  LayoutGrid,
  Loader2,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  SlashSquare,
  Sparkles,
  Square,
  Sun,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { AetherMark } from '@aetherblog/ui';
import { MarkdownPreview } from '@aetherblog/editor';
import { formatDate } from '@aetherblog/utils';
import { useAuthStore } from '@/stores';
import { useTheme } from '@/hooks';
import { getMediaUrl } from '@/services/mediaService';
import { cn } from '@/lib/utils';
import {
  type AgentArticle,
  type AgentMessage,
  type AgentSession,
  type ChatStreamRequest,
  type SlashCommand,
  type StreamAnimationMode,
  SLASH_COMMANDS,
  ARTICLE_PAGE_SIZE,
  createEmptySession,
  deriveSessionTitle,
  filterSlashCommands,
  groupSessionsByRecency,
  loadSessions,
  modelLabel,
  newMessageId,
  normalizeCjkInlineMarkdown,
  saveSessions,
  streamAgentChat,
  useAgentModels,
  useArticleSearch,
  useSmoothStream,
} from '@/services/agent';

const promptChips = [
  '总结 AetherBlog 项目的整体结构',
  '帮我修复最近的构建错误',
  '生成部署检查清单',
  '解释 pgvector 半自动调优策略',
];

type DisplayMode = 'bubble' | 'engraved';

interface CurrentUser {
  id: string;
  nickname: string;
  initial: string;
  avatarUrl: string | null;
}

function pickGreeting(hour: number): string {
  if (hour >= 5 && hour < 11) return '早上好';
  if (hour >= 11 && hour < 13) return '中午好';
  if (hour >= 13 && hour < 18) return '下午好';
  return '晚上好';
}

export default function AetherHubWorkspacePage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const currentUser = useMemo<CurrentUser>(() => {
    const nickname = user?.nickname?.trim() || '管理员';
    return {
      id: user?.id ?? 'anon',
      nickname,
      initial: Array.from(nickname)[0]?.toUpperCase() ?? 'A',
      avatarUrl: user?.avatar ? getMediaUrl(user.avatar) : null,
    };
  }, [user?.id, user?.nickname, user?.avatar]);

  // ----- 会话状态：localStorage 持久化，每个 user 独立 namespace。 -----
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const list = loadSessions(currentUser.id);
    if (list.length === 0) {
      const fresh = createEmptySession('chat');
      setSessions([fresh]);
      setActiveId(fresh.id);
    } else {
      setSessions(list);
      setActiveId(list.sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
    }
    setHydrated(true);
  }, [currentUser.id]);

  useEffect(() => {
    if (!hydrated) return;
    saveSessions(currentUser.id, sessions);
  }, [hydrated, currentUser.id, sessions]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  // ----- Greeting tick：跨过整点时切换 -----
  const [greeting, setGreeting] = useState(() => pickGreeting(new Date().getHours()));
  useEffect(() => {
    const id = window.setInterval(
      () => setGreeting(pickGreeting(new Date().getHours())),
      60_000,
    );
    return () => window.clearInterval(id);
  }, []);

  // ----- 模型清单 -----
  const modelsState = useAgentModels(true);

  // ----- Composer 状态 -----
  const [composer, setComposer] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // @ 选中的文章（每条会话独立维护，简化起见放当前会话级别 state，切换会话时清空）
  const [selectedArticles, setSelectedArticles] = useState<AgentArticle[]>([]);
  useEffect(() => {
    setSelectedArticles([]);
  }, [activeId]);

  // ----- 右侧上下文面板：收起 / 展开 -----
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // ----- 显示模式：bubble（气泡） vs engraved（版书）-----
  // 版书模式下，user/agent 标识行变成居中浮动分隔线，正文以"凸起浮印"质感渲染。
  const [displayMode, setDisplayMode] = useState<DisplayMode>('bubble');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('aetherblog.admin.aetherhub.displayMode');
    if (stored === 'engraved' || stored === 'bubble') setDisplayMode(stored);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('aetherblog.admin.aetherhub.displayMode', displayMode);
  }, [displayMode]);

  // ----- 流式吐字动画：none / fade / smooth -----
  const [streamAnimation, setStreamAnimation] = useState<StreamAnimationMode>('smooth');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('aetherblog.admin.aetherhub.streamAnimation');
    if (stored === 'none' || stored === 'fade' || stored === 'smooth') setStreamAnimation(stored);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('aetherblog.admin.aetherhub.streamAnimation', streamAnimation);
  }, [streamAnimation]);

  // ----- 字体大小：13-17px，默认 14.5（与文章详情正文同档） -----
  const [fontSize, setFontSize] = useState<number>(14.5);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('aetherblog.admin.aetherhub.fontSize');
    if (stored) {
      const n = Number(stored);
      if (Number.isFinite(n) && n >= 12 && n <= 20) setFontSize(n);
    }
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('aetherblog.admin.aetherhub.fontSize', String(fontSize));
  }, [fontSize]);

  const updateSession = useCallback(
    (id: string, updater: (s: AgentSession) => AgentSession) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
    },
    [],
  );

  const handleNewSession = useCallback(() => {
    if (streaming) {
      toast.info('请先停止当前回答再新建对话');
      return;
    }
    const fresh = createEmptySession('chat');
    setSessions((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
    setComposer('');
  }, [streaming]);

  const handleSelectSession = useCallback(
    (id: string) => {
      if (streaming) {
        toast.info('正在生成回答，请稍候或先停止');
        return;
      }
      setActiveId(id);
    },
    [streaming],
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (next.length === 0) {
          const fresh = createEmptySession('chat');
          setActiveId(fresh.id);
          return [fresh];
        }
        if (id === activeId) {
          setActiveId(next.sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
        }
        return next;
      });
      toast.success('对话已删除');
    },
    [activeId],
  );

  const handleSetModel = useCallback(
    (modelId: string | null, providerCode: string | null) => {
      if (!activeSession) return;
      updateSession(activeSession.id, (s) => ({
        ...s,
        modelId,
        providerCode,
        updatedAt: Date.now(),
      }));
    },
    [activeSession, updateSession],
  );

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    // 关键修复：abort 走 AbortError 分支不会触发 onDone/onError，pending 永远不会被
    // 清掉，导致 ThinkingMeta 的 100ms tick 一直滚（你看到的 "正在生成 · 1413s"）。
    // 这里手动把"还在 pending 的 assistant 消息"全部落定到完成态。
    setSessions((prev) =>
      prev.map((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.role === 'assistant' && m.pending
            ? {
                ...m,
                pending: false,
                finishedAt: Date.now(),
                error: m.content ? undefined : '已停止生成',
              }
            : m,
        ),
      })),
    );
  }, []);

  const handleSend = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || streaming || !activeSession) return;

      const now = Date.now();
      const userMsg: AgentMessage = {
        id: newMessageId(),
        role: 'user',
        content: text,
        createdAt: now,
      };
      const assistantId = newMessageId();
      const assistantMsg: AgentMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: now,
        startedAt: now,
        pending: true,
      };

      const isFirstMessage = activeSession.messages.length === 0;
      const sessionId = activeSession.id;
      const modelId = activeSession.modelId ?? null;
      const providerCode = activeSession.providerCode ?? null;
      const historyForRequest = [...activeSession.messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      updateSession(sessionId, (s) => ({
        ...s,
        messages: [...s.messages, userMsg, assistantMsg],
        title: isFirstMessage ? deriveSessionTitle(text) : s.title,
        updatedAt: now,
      }));
      setComposer('');
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const patchAssistant = (patch: Partial<AgentMessage>) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id !== sessionId
              ? s
              : {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantId ? { ...m, ...patch } : m,
                  ),
                  updatedAt: Date.now(),
                },
          ),
        );
      };

      const req: ChatStreamRequest = {
        sessionId,
        mode: 'chat',
        messages: historyForRequest,
        modelId,
        providerCode,
        articleIds: selectedArticles.length > 0 ? selectedArticles.map((a) => a.id) : null,
      };

      try {
        await streamAgentChat(
          req,
          {
            onDelta: (chunk) => {
              setSessions((prev) =>
                prev.map((s) =>
                  s.id !== sessionId
                    ? s
                    : {
                        ...s,
                        messages: s.messages.map((m) => {
                          if (m.id !== assistantId) return m;
                          return {
                            ...m,
                            content: m.content + chunk,
                            firstTokenAt: m.firstTokenAt ?? Date.now(),
                          };
                        }),
                        updatedAt: Date.now(),
                      },
                ),
              );
            },
            onThink: (chunk) => {
              setSessions((prev) =>
                prev.map((s) =>
                  s.id !== sessionId
                    ? s
                    : {
                        ...s,
                        messages: s.messages.map((m) =>
                          m.id === assistantId
                            ? { ...m, think: (m.think ?? '') + chunk }
                            : m,
                        ),
                      },
                ),
              );
            },
            onSources: (sources) => patchAssistant({ sources }),
            onDone: () =>
              patchAssistant({ pending: false, finishedAt: Date.now() }),
            onError: (message) =>
              patchAssistant({ pending: false, error: message, finishedAt: Date.now() }),
          },
          controller.signal,
        );
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          patchAssistant({
            pending: false,
            error: err instanceof Error ? err.message : '请求失败',
            finishedAt: Date.now(),
          });
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setStreaming(false);
      }
    },
    [streaming, activeSession, updateSession, selectedArticles],
  );

  // ----- 斜杠命令 -----
  const handleSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.kind === 'remote') {
        setComposer(cmd.template ?? cmd.command);
        return;
      }
      switch (cmd.command) {
        case '/clear':
          if (!activeSession) return;
          if (streaming) {
            toast.info('请先停止当前回答');
            return;
          }
          updateSession(activeSession.id, (s) => ({
            ...s,
            messages: [],
            title: '新对话',
            updatedAt: Date.now(),
          }));
          setSelectedArticles([]);
          toast.success('已清空当前对话');
          return;
        case '/new':
          handleNewSession();
          return;
        case '/regen': {
          if (!activeSession || streaming) return;
          const msgs = activeSession.messages;
          const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
          if (!lastUser) {
            toast.info('当前对话没有可重发的用户消息');
            return;
          }
          // 把最后一条 user 之后的消息全部砍掉，再重新发
          const trimmed = msgs.slice(0, msgs.findIndex((m) => m.id === lastUser.id) + 1).slice(0, -1);
          updateSession(activeSession.id, (s) => ({
            ...s,
            messages: trimmed,
            updatedAt: Date.now(),
          }));
          // 让下一帧再触发 send，确保 trimmed state 落地
          window.setTimeout(() => handleSend(lastUser.content), 30);
          return;
        }
        default:
          toast.info(`命令 ${cmd.command} 暂未实现`);
      }
    },
    [activeSession, streaming, updateSession, handleNewSession, handleSend],
  );

  return (
    <div className="aetherhub-workspace fixed inset-0 flex flex-col overflow-hidden bg-[var(--bg-void)] text-[var(--ink-primary)]">
      <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-[var(--bg-void)]">
        <div className="aurora-layer opacity-70" data-animated="true" aria-hidden="true" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'var(--hub-canvas-overlay)' }}
          aria-hidden="true"
        />

        <div
          className={cn(
            'relative z-10 grid h-full min-h-0 w-full grid-cols-1 overflow-hidden',
            'lg:grid-cols-[320px_minmax(0,1fr)]',
            panelCollapsed
              ? 'xl:grid-cols-[320px_minmax(0,1fr)]'
              : 'xl:grid-cols-[320px_minmax(0,1fr)_320px]',
          )}
        >
          <WorkspaceSidebar
            currentUser={currentUser}
            sessions={sessions}
            activeId={activeId}
            streaming={streaming}
            onBack={() => navigate('/dashboard')}
            onNewSession={handleNewSession}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
          />

          <section className="flex h-full min-h-0 min-w-0 flex-col border-x border-[var(--hub-border)]">
            <TopBar
              currentUser={currentUser}
              activeSession={activeSession}
              modelsState={modelsState}
              streaming={streaming}
              displayMode={displayMode}
              onSetDisplayMode={setDisplayMode}
              onSetModel={handleSetModel}
              onBack={() => navigate('/dashboard')}
              onNewSession={handleNewSession}
            />

            <WorkspaceCanvas
              greeting={greeting}
              nickname={currentUser.nickname}
              currentUser={currentUser}
              activeSession={activeSession}
              modelsState={modelsState}
              streaming={streaming}
              composer={composer}
              displayMode={displayMode}
              streamAnimation={streamAnimation}
              fontSize={fontSize}
              onComposerChange={setComposer}
              onSend={handleSend}
              onAbort={handleAbort}
              onSetModel={handleSetModel}
              onPickPrompt={(text) => setComposer(text)}
              selectedArticles={selectedArticles}
              onPickArticle={(article) =>
                setSelectedArticles((prev) =>
                  prev.find((a) => a.id === article.id) ? prev : [...prev, article],
                )
              }
              onRemoveArticle={(id) =>
                setSelectedArticles((prev) => prev.filter((a) => a.id !== id))
              }
              onSlashCommand={handleSlashCommand}
            />
          </section>

          <ContextPanel
            session={activeSession}
            modelsState={modelsState}
            collapsed={panelCollapsed}
            displayMode={displayMode}
            onSetDisplayMode={setDisplayMode}
            streamAnimation={streamAnimation}
            onSetStreamAnimation={setStreamAnimation}
            fontSize={fontSize}
            onSetFontSize={setFontSize}
            onToggleCollapsed={() => setPanelCollapsed((v) => !v)}
            onDeleteSession={() => activeSession && handleDeleteSession(activeSession.id)}
            onClearMessages={() => {
              if (!activeSession) return;
              if (streaming) {
                toast.info('请先停止当前回答');
                return;
              }
              updateSession(activeSession.id, (s) => ({
                ...s,
                messages: [],
                title: '新对话',
                updatedAt: Date.now(),
              }));
              toast.success('已清空当前对话');
            }}
          />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// 侧栏 —— 会话列表 + 新建按钮 + 用户信息
// =============================================================================

function WorkspaceSidebar({
  currentUser,
  sessions,
  activeId,
  streaming,
  onBack,
  onNewSession,
  onSelectSession,
  onDeleteSession,
}: {
  currentUser: CurrentUser;
  sessions: AgentSession[];
  activeId: string | null;
  streaming: boolean;
  onBack: () => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}) {
  const groups = useMemo(() => groupSessionsByRecency(sessions), [sessions]);
  const navigate = useNavigate();

  return (
    <aside className="hidden h-full min-h-0 flex-col border-r border-[var(--hub-border)] bg-[var(--hub-panel)] px-5 py-4 backdrop-blur-2xl lg:flex">
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回管理后台"
          className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
        >
          <LayoutGrid className="h-4 w-4" />
          <span className="text-sm">控制台</span>
        </button>
        <span className="font-display text-sm tracking-[0.16em] text-[var(--ink-muted)]">
          AetherHub
        </span>
      </div>

      <button
        type="button"
        onClick={onNewSession}
        disabled={streaming}
        className={cn(
          'mb-4 flex h-11 w-full items-center justify-between rounded-xl px-4 text-[var(--hub-on-accent)] shadow-[var(--hub-accent-shadow)] transition-transform [background:var(--hub-gradient)] active:scale-[0.99]',
          streaming && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className="inline-flex items-center gap-3 text-sm font-medium">
          <Plus className="h-4 w-4" />
          新建对话
        </span>
        <span className="rounded-md bg-white/16 px-1.5 py-0.5 font-mono text-[11px]">⌘ K</span>
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {sessions.length === 0 && (
          <div className="px-2 py-6 text-center text-[var(--fs-caption)] text-[var(--ink-muted)]">
            暂无会话，从上方「新建对话」开始
          </div>
        )}
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="mb-1 px-2 text-[var(--fs-caption)] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  onSelect={() => onSelectSession(session.id)}
                  onDelete={() => onDeleteSession(session.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--hub-border)] pt-4">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="mb-3 flex h-9 w-full items-center gap-3 rounded-lg px-2 text-sm text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
        >
          <Settings className="h-4 w-4" />
          其他设置
        </button>
        <div className="flex items-center gap-3">
          {currentUser.avatarUrl ? (
            <img
              src={currentUser.avatarUrl}
              alt={currentUser.nickname}
              className="h-10 w-10 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-[var(--hub-on-accent)] [background:var(--hub-gradient)]">
              {currentUser.initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[var(--ink-primary)]">
              {currentUser.nickname}
            </div>
            <div className="mt-0.5 inline-flex rounded-md bg-[var(--hub-control)] px-1.5 py-0.5 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              在线
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: AgentSession;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div
      className={cn(
        'group relative flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm transition-colors',
        active
          ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
          : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0 truncate">{session.title || '新对话'}</span>
        <span className="shrink-0 text-[var(--fs-caption)] tnum text-[var(--ink-muted)]">
          {formatRelativeShort(session.updatedAt)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirmDelete) onDelete();
          else setConfirmDelete(true);
        }}
        onBlur={() => setConfirmDelete(false)}
        title={confirmDelete ? '再次点击确认删除' : '删除对话'}
        aria-label="删除对话"
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--ink-muted)] transition-all hover:bg-[var(--hub-control-hover)]',
          confirmDelete
            ? 'text-[var(--signal-danger)] opacity-100'
            : 'opacity-0 group-hover:opacity-100 hover:text-[var(--signal-danger)]',
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// =============================================================================
// 顶栏 —— 会话标题 + 模型选择 + 用户头像
// =============================================================================

function TopBar({
  currentUser,
  activeSession,
  modelsState,
  streaming,
  displayMode,
  onSetDisplayMode,
  onSetModel,
  onBack,
  onNewSession,
}: {
  currentUser: CurrentUser;
  activeSession: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  streaming: boolean;
  displayMode: DisplayMode;
  onSetDisplayMode: (mode: DisplayMode) => void;
  onSetModel: (modelId: string | null, providerCode: string | null) => void;
  onBack: () => void;
  onNewSession: () => void;
}) {
  const { isDark, toggleThemeWithAnimation } = useTheme();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--hub-border)] bg-[var(--hub-panel)] px-3 backdrop-blur-2xl md:h-[60px] md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] lg:hidden"
          aria-label="返回管理后台"
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center md:h-9 md:w-9">
          <AetherMark size={28} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-[var(--ink-primary)] md:text-sm">
            {activeSession?.title || 'AetherHub'}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[var(--ink-muted)]">
            {streaming ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-[var(--aurora-1)]" />
                <span className="text-[var(--aurora-1)]">正在生成</span>
              </>
            ) : (
              <>
                <span className="grid h-2 w-2 place-items-center rounded-full bg-[color-mix(in_oklch,var(--signal-success)_22%,transparent)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--signal-success)]" />
                </span>
                就绪
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
        {/* 桌面端：模型选择器在 TopBar；移动端：只在 Composer 出现，避免挤标题 */}
        <div className="hidden md:block">
          <ModelPickerButton
            activeSession={activeSession}
            modelsState={modelsState}
            disabled={streaming}
            onSetModel={onSetModel}
          />
        </div>
        <button
          type="button"
          onClick={() => onSetDisplayMode(displayMode === 'bubble' ? 'engraved' : 'bubble')}
          aria-label={displayMode === 'bubble' ? '切换到版书模式' : '切换到气泡模式'}
          title={displayMode === 'bubble' ? '切换到版书模式' : '切换到气泡模式'}
          className="grid h-9 w-9 place-items-center rounded-lg text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
        >
          {displayMode === 'bubble' ? <BookOpen className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={(e) => toggleThemeWithAnimation(e.clientX, e.clientY)}
          aria-label={isDark ? '切换到亮色模式' : '切换到暗色模式'}
          title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
          className="grid h-9 w-9 place-items-center rounded-lg text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onNewSession}
          disabled={streaming}
          aria-label="新建对话"
          title="新建对话"
          className={cn(
            'grid h-9 w-9 place-items-center rounded-lg text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] md:hidden',
            streaming && 'cursor-not-allowed opacity-60',
          )}
        >
          <Plus className="h-4 w-4" />
        </button>
        {currentUser.avatarUrl ? (
          <img
            src={currentUser.avatarUrl}
            alt={currentUser.nickname}
            className="h-8 w-8 rounded-full object-cover md:h-9 md:w-9"
          />
        ) : (
          <div
            className="grid h-8 w-8 place-items-center rounded-full bg-[var(--aurora-1)] text-[12px] font-semibold text-[var(--hub-on-accent)] md:h-9 md:w-9 md:text-sm"
            aria-label={currentUser.nickname}
          >
            {currentUser.initial}
          </div>
        )}
      </div>
    </header>
  );
}

// =============================================================================
// 模型选择
// =============================================================================

function ModelPickerButton({
  activeSession,
  modelsState,
  disabled,
  onSetModel,
  placement = 'bottom',
  align = 'end',
}: {
  activeSession: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  disabled: boolean;
  onSetModel: (modelId: string | null, providerCode: string | null) => void;
  placement?: 'top' | 'bottom';
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const items = modelsState.status === 'ready' ? modelsState.items : [];
  const grouped = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const key = item.providerCode;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [items]);

  const currentLabel = useMemo(() => {
    if (!activeSession?.modelId) return '自动路由';
    const found = items.find(
      (m) => m.modelId === activeSession.modelId && m.providerCode === activeSession.providerCode,
    );
    return found ? modelLabel(found) : activeSession.modelId;
  }, [activeSession?.modelId, activeSession?.providerCode, items]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'inline-flex h-9 max-w-[220px] items-center gap-2 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-control)] px-3 text-sm text-[var(--ink-primary)] transition-colors hover:bg-[var(--hub-control-hover)]',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <Bot className="h-4 w-4 shrink-0 text-[var(--ink-secondary)]" />
        <span className="truncate">{currentLabel}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-[var(--ink-muted)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className={cn(
            'absolute z-30 w-[min(320px,calc(100vw-2rem))] max-h-[min(420px,60vh)] overflow-y-auto rounded-xl border border-[var(--hub-border)] bg-[var(--hub-panel-strong)] p-2 shadow-[var(--hub-card-shadow)] backdrop-blur-2xl',
            placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          <button
            type="button"
            onClick={() => {
              onSetModel(null, null);
              setOpen(false);
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
              !activeSession?.modelId
                ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
                : 'text-[var(--ink-primary)] hover:bg-[var(--hub-control-hover)]',
            )}
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">自动路由</div>
              <div className="text-[var(--fs-caption)] text-[var(--ink-muted)]">
                按任务路由策略自动选模型
              </div>
            </div>
            {!activeSession?.modelId && <Check className="h-4 w-4 shrink-0" />}
          </button>

          {modelsState.status === 'loading' && (
            <div className="px-3 py-4 text-center text-[var(--fs-caption)] text-[var(--ink-muted)]">
              <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
              加载模型清单…
            </div>
          )}

          {modelsState.status === 'error' && (
            <div className="px-3 py-3 text-[var(--fs-caption)] text-[var(--signal-danger)]">
              加载失败：{modelsState.message}
            </div>
          )}

          {modelsState.status === 'ready' && grouped.length === 0 && (
            <div className="px-3 py-3 text-[var(--fs-caption)] text-[var(--ink-muted)]">
              没有已启用的模型，去 AI 配置页添加
            </div>
          )}

          {grouped.map(([providerCode, list]) => (
            <div key={providerCode} className="mt-2">
              <div className="px-3 pb-1 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                {list[0]?.providerName || providerCode}
              </div>
              {list.map((m) => {
                const selected =
                  activeSession?.modelId === m.modelId &&
                  activeSession?.providerCode === m.providerCode;
                return (
                  <button
                    key={`${m.providerCode}:${m.modelId}`}
                    type="button"
                    onClick={() => {
                      onSetModel(m.modelId, m.providerCode);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                      selected
                        ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
                        : 'text-[var(--ink-primary)] hover:bg-[var(--hub-control-hover)]',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{modelLabel(m)}</span>
                        {m.isDefault && (
                          <span className="shrink-0 rounded-md bg-[var(--hub-control)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                            默认
                          </span>
                        )}
                      </div>
                      {m.contextWindow && (
                        <div className="text-[var(--fs-caption)] tnum text-[var(--ink-muted)]">
                          上下文 {Math.round(m.contextWindow / 1000)}K
                        </div>
                      )}
                    </div>
                    {selected && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// 主区 —— 空态欢迎 / 消息流 + 输入框
// =============================================================================

function WorkspaceCanvas({
  greeting,
  nickname,
  currentUser,
  activeSession,
  modelsState,
  streaming,
  composer,
  displayMode,
  streamAnimation,
  fontSize,
  onComposerChange,
  onSend,
  onAbort,
  onSetModel,
  onPickPrompt,
  selectedArticles,
  onPickArticle,
  onRemoveArticle,
  onSlashCommand,
}: {
  greeting: string;
  nickname: string;
  currentUser: CurrentUser;
  activeSession: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  streaming: boolean;
  composer: string;
  displayMode: DisplayMode;
  streamAnimation: StreamAnimationMode;
  fontSize: number;
  onComposerChange: (value: string) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  onSetModel: (modelId: string | null, providerCode: string | null) => void;
  onPickPrompt: (text: string) => void;
  selectedArticles: AgentArticle[];
  onPickArticle: (article: AgentArticle) => void;
  onRemoveArticle: (id: number) => void;
  onSlashCommand: (cmd: SlashCommand) => void;
}) {
  const isEmpty = !activeSession || activeSession.messages.length === 0;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 用户主动滚动到非底部 → 暂停自动跟随；滚回底部 80px 内 → 恢复跟随
  const [stickToBottom, setStickToBottom] = useState(true);
  const lastSessionIdRef = useRef<string | null | undefined>(undefined);

  const messages = activeSession?.messages ?? [];

  // 切换会话时重置为"贴底"，并立即跳到底部
  useEffect(() => {
    if (lastSessionIdRef.current !== activeSession?.id) {
      lastSessionIdRef.current = activeSession?.id;
      setStickToBottom(true);
    }
  }, [activeSession?.id]);

  // 监听用户滚动 —— 距底部 < 80px 视为"想跟随"，> 80px 视为"主动往上看"
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    let raf = 0;
    const onScroll = () => {
      // 节流：合并同帧多次 scroll 事件
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!node.isConnected) return;
        const distFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
        setStickToBottom((prev) => {
          const next = distFromBottom < 80;
          return prev === next ? prev : next;
        });
      });
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      node.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // 仅当 stickToBottom=true 才 auto-scroll，且走 rAF 等布局稳定后再设
  // scrollTop —— 之前 useLayoutEffect 同步设置 scrollHeight 在 streaming
  // 高频 reflow 下会读到陈旧值（content 已增但 layout 未完），导致内容被
  // 顶到视口外。
  useEffect(() => {
    if (!stickToBottom) return;
    const node = scrollRef.current;
    if (!node) return;
    const id = requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [messages, streaming, stickToBottom]);

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setStickToBottom(true);
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, []);

  return (
    <main className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 md:px-8 md:pt-12">
        <div className="mx-auto w-full max-w-[820px]">
          {isEmpty ? (
            <EmptyState
              greeting={greeting}
              nickname={nickname}
              onPickPrompt={onPickPrompt}
            />
          ) : (
            <div
              className={cn(
                'flex flex-col pb-6',
                displayMode === 'engraved' ? 'gap-2' : 'gap-6',
              )}
            >
              {messages.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  displayMode={displayMode}
                  streamAnimation={streamAnimation}
                  fontSize={fontSize}
                  currentUser={currentUser}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 用户滚到上方阅读时，浮一个"跳到最新"按钮；点完恢复 stickToBottom */}
      <AnimatePresence>
        {!isEmpty && !stickToBottom && (
          <motion.button
            type="button"
            onClick={scrollToBottom}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--hub-border)] bg-[var(--hub-panel-strong)] px-3 py-1.5 text-[12px] text-[var(--ink-secondary)] shadow-[var(--hub-card-shadow)] backdrop-blur-2xl transition-colors hover:text-[var(--ink-primary)]"
            aria-label="滚动到最新"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            跳到最新
          </motion.button>
        )}
      </AnimatePresence>

      <Composer
        value={composer}
        onChange={onComposerChange}
        onSend={onSend}
        onAbort={onAbort}
        streaming={streaming}
        modelsState={modelsState}
        activeSession={activeSession}
        onSetModel={onSetModel}
        selectedArticles={selectedArticles}
        onPickArticle={onPickArticle}
        onRemoveArticle={onRemoveArticle}
        onSlashCommand={onSlashCommand}
      />
    </main>
  );
}

function EmptyState({
  greeting,
  nickname,
  onPickPrompt,
}: {
  greeting: string;
  nickname: string;
  onPickPrompt: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center pt-4 pb-8 text-center md:pt-12">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--hub-active)] text-[var(--hub-accent)]">
        <Sparkles className="h-7 w-7" />
      </div>
      <h1 className="font-display text-[clamp(1.85rem,8vw,3.25rem)] leading-tight text-[var(--ink-primary)] md:leading-none">
        {greeting}，{nickname}
      </h1>
      <p className="mt-3 text-sm text-[var(--ink-secondary)] md:text-[var(--fs-lede)]">
        有什么可以帮你构建的？输入问题或点选下方建议开始。
      </p>

      <div className="mt-8 grid w-full grid-cols-1 gap-2 sm:grid-cols-2 md:gap-3">
        {promptChips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onPickPrompt(chip)}
            className="surface-leaf rounded-xl px-4 py-3 text-left text-sm text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)]"
            data-interactive
          >
            <span className="line-clamp-2">{chip}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({
  message,
  displayMode,
  streamAnimation,
  fontSize,
  currentUser,
}: {
  message: AgentMessage;
  displayMode: DisplayMode;
  streamAnimation: StreamAnimationMode;
  fontSize: number;
  currentUser: CurrentUser;
}) {
  const { isDark } = useTheme();
  const isUser = message.role === 'user';
  const showTypingDots = !isUser && !!message.pending && !message.content && !message.error;
  const isStreaming = !isUser && !!message.pending && !!message.content;
  const thinkStreaming = !!message.pending && !message.firstTokenAt;

  const header =
    displayMode === 'engraved' ? (
      <EngravedHeader message={message} isUser={isUser} currentUser={currentUser} />
    ) : (
      <BubbleHeader message={message} isUser={isUser} currentUser={currentUser} />
    );

  const body = isUser ? (
    <UserContent message={message} displayMode={displayMode} fontSize={fontSize} />
  ) : showTypingDots ? (
    <AssistantSurface displayMode={displayMode} isStreaming={false} hasError={false}>
      <TypingDots />
    </AssistantSurface>
  ) : (
    <AssistantContent
      message={message}
      displayMode={displayMode}
      streamAnimation={streamAnimation}
      fontSize={fontSize}
      isDark={isDark}
      isStreaming={isStreaming}
      thinkStreaming={thinkStreaming}
    />
  );

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="group/msg relative mx-auto flex w-full max-w-3xl flex-col"
      aria-label={isUser ? '用户消息' : 'Agent 回复'}
    >
      {header}
      <div className={cn(displayMode === 'bubble' && (isUser ? 'flex justify-end' : 'flex justify-start'))}>
        {body}
      </div>
      {message.sources && message.sources.length > 0 && (
        <div className="mt-3 max-w-full">
          <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            § Sources
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {message.sources.map((s) => (
              <li key={s.slug + s.title}>
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--hub-border)] bg-[var(--hub-control)] px-2.5 py-1 text-[11.5px] text-[var(--ink-secondary)]">
                  {s.title || s.slug}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.article>
  );
}

function BubbleHeader({
  message,
  isUser,
  currentUser,
}: {
  message: AgentMessage;
  isUser: boolean;
  currentUser: CurrentUser;
}) {
  return (
    <div
      className={cn(
        'mb-2 flex items-center gap-2',
        isUser ? 'flex-row-reverse self-end' : 'self-start',
      )}
    >
      <Avatar isUser={isUser} currentUser={currentUser} size={28} />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
        {isUser ? 'YOU' : 'AGENT'}
      </span>
      <span aria-hidden="true" className="text-[10.5px] text-[var(--ink-muted)]">
        ·
      </span>
      <span className="tnum font-mono text-[10.5px] text-[var(--ink-muted)]">
        {formatDate(new Date(message.createdAt), 'HH:mm')}
      </span>
      {!isUser && <ThinkingMeta message={message} />}
    </div>
  );
}

function EngravedHeader({
  message,
  isUser,
  currentUser,
}: {
  message: AgentMessage;
  isUser: boolean;
  currentUser: CurrentUser;
}) {
  return (
    <div className="my-6 flex items-center gap-3 px-1" aria-label={isUser ? 'YOU' : 'AGENT'}>
      <span
        className="h-px flex-1 bg-gradient-to-r from-transparent to-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]"
        aria-hidden="true"
      />
      <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--ink-muted)]">
        <Avatar isUser={isUser} currentUser={currentUser} size={20} />
        {isUser ? 'YOU' : 'AGENT'}
        <span aria-hidden="true">·</span>
        <span className="tnum normal-case tracking-[0.14em]">
          {formatDate(new Date(message.createdAt), 'HH:mm')}
        </span>
        {!isUser && <ThinkingMeta message={message} />}
      </span>
      <span
        className="h-px flex-1 bg-gradient-to-l from-transparent to-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]"
        aria-hidden="true"
      />
    </div>
  );
}

function Avatar({
  isUser,
  currentUser,
  size,
}: {
  isUser: boolean;
  currentUser: CurrentUser;
  size: number;
}) {
  if (isUser && currentUser.avatarUrl) {
    return (
      <img
        src={currentUser.avatarUrl}
        alt={currentUser.nickname}
        className="rounded-full object-cover"
        style={{ height: size, width: size }}
      />
    );
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        isUser
          ? 'border border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-primary)]'
          : 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]',
      )}
      style={{ height: size, width: size }}
      aria-hidden="true"
    >
      {isUser ? (
        <UserIcon style={{ width: size * 0.5, height: size * 0.5 }} />
      ) : (
        <Sparkles style={{ width: size * 0.55, height: size * 0.55 }} />
      )}
    </span>
  );
}

function UserContent({
  message,
  displayMode,
  fontSize,
}: {
  message: AgentMessage;
  displayMode: DisplayMode;
  fontSize: number;
}) {
  if (displayMode === 'engraved') {
    return (
      <div
        className="hub-engraved-text mx-auto max-w-full whitespace-pre-wrap leading-[1.85] text-[var(--ink-primary)]"
        style={{ fontSize: `${fontSize + 1}px` }}
      >
        {message.content}
      </div>
    );
  }
  return (
    <div
      className="inline-block max-w-[85%] rounded-2xl border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] px-4 py-3 leading-relaxed text-[var(--ink-primary)] whitespace-pre-wrap break-words"
      style={{ fontSize: `${fontSize}px` }}
    >
      {message.content}
    </div>
  );
}

function AssistantSurface({
  children,
  displayMode,
  isStreaming,
  hasError,
}: {
  children: ReactNode;
  displayMode: DisplayMode;
  isStreaming: boolean;
  hasError: boolean;
}) {
  if (displayMode === 'engraved') {
    return (
      <div
        className={cn(
          'hub-engraved-text mx-auto max-w-full text-[15.5px] leading-[1.85] text-[var(--ink-primary)]',
          isStreaming && 'hub-engraved-streaming',
        )}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn(
        'inline-block max-w-full break-words rounded-2xl px-4 py-3 text-[14.5px] leading-relaxed',
        hasError
          ? 'whitespace-pre-wrap border border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] text-[var(--ink-primary)]'
          : isStreaming
            ? 'surface-leaf hub-bubble-pending border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] text-[var(--ink-primary)]'
            : 'surface-leaf border border-[var(--hub-border)] text-[var(--ink-primary)]',
      )}
    >
      {children}
    </div>
  );
}

function AssistantContent({
  message,
  displayMode,
  streamAnimation,
  fontSize,
  isDark,
  isStreaming,
  thinkStreaming,
}: {
  message: AgentMessage;
  displayMode: DisplayMode;
  streamAnimation: StreamAnimationMode;
  fontSize: number;
  isDark: boolean;
  isStreaming: boolean;
  thinkStreaming: boolean;
}) {
  // 节流后的内容 —— 流式中按用户选择的速率匀速吐字；完成态立即同步到完整文本。
  const smoothed = useSmoothStream(message.content, !!message.pending, streamAnimation);
  // CJK 友好预处理 —— 修正 `**xx：**汉字` 这类中文标点 + bold 闭合失败的盲点。
  const renderableContent = useMemo(
    () => normalizeCjkInlineMarkdown(smoothed),
    [smoothed],
  );

  return (
    <div className="w-full">
      {message.think && (
        <div className={cn(displayMode === 'engraved' && 'mx-auto mb-3 max-w-full')}>
          <ThinkingBlock think={message.think} streaming={thinkStreaming} />
        </div>
      )}
      <AssistantSurface
        displayMode={displayMode}
        isStreaming={isStreaming}
        hasError={!!message.error}
      >
        {message.error && !message.content ? (
          <div className="font-mono text-[11px] tracking-[0.06em] text-[var(--signal-danger)]">
            ERROR · {message.error}
          </div>
        ) : (
          <>
            <div
              className={cn(
                'hub-stream-fade',
                streamAnimation === 'fade' && 'hub-stream-fade--fade',
                streamAnimation === 'smooth' && 'hub-stream-fade--smooth',
              )}
              style={{ fontSize: `${fontSize}px` }}
            >
              <MarkdownPreview
                content={renderableContent}
                theme={isDark ? 'dark' : 'light'}
                className={cn(
                  'leading-relaxed',
                  displayMode === 'engraved' && 'hub-engraved-md',
                )}
                style={{ fontSize: `${fontSize}px` }}
              />
            </div>
            {message.pending && (
              <span
                className="hub-caret text-[var(--aurora-1)]"
                aria-hidden="true"
                style={{ marginTop: '-1.05em' }}
              />
            )}
            {message.error && (
              <div className="mt-3 font-mono text-[11px] tracking-[0.06em] text-[var(--signal-danger)]">
                ERROR · {message.error}
              </div>
            )}
          </>
        )}
      </AssistantSurface>
    </div>
  );
}

/**
 * ThinkingBlock —— Codex 级思考块
 * 收起态：单行 pill（左侧呼吸光带 + Brain + "正在思考"/"已深度思考" + 字数 + tail 摘要）
 * 展开态：可滚动 think 文本框，流式中自动 stick-to-bottom
 */
function ThinkingBlock({ think, streaming }: { think: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !streaming) return;
    const el = previewRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, streaming, think]);

  const charCount = think.length;
  const tail = useMemo(() => {
    const trimmed = think.replace(/\s+$/, '');
    if (trimmed.length <= 36) return trimmed;
    return `…${trimmed.slice(-36)}`;
  }, [think]);

  return (
    <div className="relative mb-2.5 max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'group/think relative flex w-full items-center gap-2 overflow-hidden rounded-xl border px-3 py-2 text-left transition-colors',
          streaming
            ? 'border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_6%,transparent)]'
            : 'border-[var(--hub-border)] bg-[var(--hub-control)] hover:border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)]',
        )}
      >
        {streaming && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 bottom-0 w-[1.5px] bg-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)]"
          >
            <span className="hub-think-shimmer" />
          </span>
        )}
        <Brain
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            streaming ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-muted)]',
          )}
        />
        <span
          className={cn(
            'shrink-0 font-mono text-[10.5px] uppercase tracking-[0.22em]',
            streaming ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-muted)]',
          )}
        >
          {streaming ? '正在思考' : '已深度思考'}
        </span>
        <span aria-hidden="true" className="font-mono text-[10px] text-[var(--ink-muted)]">
          ·
        </span>
        <span className="shrink-0 font-mono text-[10.5px] tnum text-[var(--ink-muted)]">
          {charCount} chars
        </span>
        {!open && tail && (
          <span className="ml-1.5 hidden min-w-0 truncate text-[12px] italic text-[var(--ink-muted)] opacity-85 sm:inline">
            {tail}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[var(--ink-muted)]">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="think-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div
              ref={previewRef}
              className="mt-2 max-h-[260px] overflow-y-auto rounded-xl border border-[var(--hub-border)] bg-[var(--hub-control)] p-3"
            >
              <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
                {think}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * ThinkingMeta —— inline 状态行：
 *   pending && !firstToken → "正在思考 · X.Xs" + 呼吸点
 *   pending && firstToken  → "正在生成 · X.Xs"
 *   !pending && finishedAt → "已深度思考 · X.Xs"
 *   error                  → "已中断 · X.Xs"
 */
function ThinkingMeta({ message }: { message: AgentMessage }) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!message.pending) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [message.pending]);

  if (!message.startedAt) return null;
  const isStreaming = !!message.pending;
  const endTs = isStreaming ? now : (message.finishedAt ?? message.startedAt);
  const elapsed = Math.max(0, endTs - message.startedAt) / 1000;
  const elapsedStr = `${elapsed.toFixed(1)}s`;

  let label: string;
  if (isStreaming && !message.firstTokenAt) label = '正在思考';
  else if (isStreaming) label = '正在生成';
  else if (message.error) label = '已中断';
  else label = '已深度思考';

  return (
    <>
      <span aria-hidden="true">·</span>
      <span
        className={cn(
          'inline-flex items-center gap-1',
          isStreaming && 'text-[var(--aurora-1)]',
        )}
      >
        {isStreaming && (
          <span
            aria-hidden="true"
            className="hub-breath-dot inline-block h-1 w-1 rounded-full bg-current"
          />
        )}
        {label}
        <span aria-hidden="true">·</span>
        <span className="tnum">{elapsedStr}</span>
      </span>
    </>
  );
}

/**
 * TypingDots —— 三点 typing 指示器（漂浮 + 缩放 + 透明度复合呼吸）
 */
function TypingDots() {
  return (
    <span className="relative inline-flex items-center gap-1.5 px-0.5 py-1 text-[var(--aurora-1)]">
      <span
        aria-hidden="true"
        className="absolute -inset-3 rounded-full opacity-60 blur-md"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in oklch, var(--aurora-1) 30%, transparent), transparent)',
        }}
      />
      <span className="hub-dot relative" />
      <span className="hub-dot relative" style={{ animationDelay: '0.16s' }} />
      <span className="hub-dot relative" style={{ animationDelay: '0.32s' }} />
    </span>
  );
}

// =============================================================================
// Composer —— 输入框 + 发送 / 停止
// =============================================================================

function Composer({
  value,
  onChange,
  onSend,
  onAbort,
  streaming,
  activeSession,
  modelsState,
  onSetModel,
  selectedArticles,
  onPickArticle,
  onRemoveArticle,
  onSlashCommand,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
  activeSession: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  onSetModel: (modelId: string | null, providerCode: string | null) => void;
  selectedArticles: AgentArticle[];
  onPickArticle: (article: AgentArticle) => void;
  onRemoveArticle: (id: number) => void;
  onSlashCommand: (cmd: SlashCommand) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const atBtnRef = useRef<HTMLButtonElement | null>(null);
  const slashBtnRef = useRef<HTMLButtonElement | null>(null);
  const [picker, setPicker] = useState<'article' | 'slash' | null>(null);
  const [focused, setFocused] = useState(false);

  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);

  useEffect(() => {
    autosize();
  }, [autosize, value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!streaming) onSend(value);
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const togglePicker = (k: 'article' | 'slash') => {
    setPicker((cur) => (cur === k ? null : k));
  };

  return (
    <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 md:px-8 md:pb-4 md:pt-3">
      <div className="relative mx-auto w-full max-w-[820px]">
        {/* mentions chips —— @ 选中的文章 */}
        {selectedArticles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5" aria-label="已引用文章">
            {selectedArticles.map((a) => (
              <span
                key={`art-${a.id}`}
                className="inline-flex max-w-[18rem] items-center gap-1 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] px-2 py-1 text-[11.5px] text-[var(--aurora-1)]"
              >
                <AtSign className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate" title={a.title}>
                  {a.title}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveArticle(a.id)}
                  className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full hover:bg-[color-mix(in_oklch,var(--aurora-1)_25%,transparent)]"
                  aria-label={`移除引用 ${a.title}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div
          className={cn(
            'rounded-3xl bg-[var(--hub-panel-strong)] p-3 transition-[box-shadow,border-color] duration-300 md:p-4',
            'border',
            focused
              ? 'border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)] shadow-[0_10px_32px_-12px_color-mix(in_oklch,var(--aurora-1)_38%,transparent),0_0_0_4px_color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
              : 'border-[var(--hub-border)] shadow-[0_4px_18px_-12px_rgba(0,0,0,0.25)]',
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            disabled={streaming}
            placeholder="提问、创建或开始任务。@ 引用文章 · / 调用命令"
            spellCheck={false}
            autoComplete="off"
            className={cn(
              'block w-full resize-none bg-transparent px-1 py-1.5 text-[15px] leading-[1.55] text-[var(--ink-primary)]',
              'placeholder:text-[var(--ink-muted)] placeholder:opacity-70',
              'border-0 outline-none focus:border-0 focus:outline-none focus:ring-0',
              'disabled:opacity-60 md:text-[var(--fs-body)]',
            )}
            style={{ boxShadow: 'none' }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <ModelPickerButton
                activeSession={activeSession}
                modelsState={modelsState}
                disabled={streaming}
                onSetModel={onSetModel}
                placement="top"
                align="start"
              />
              <span
                aria-hidden="true"
                className="mx-1 hidden h-4 w-px bg-[var(--hub-border)] sm:inline-block"
              />
              <ToolButton
                ref={atBtnRef}
                title="引用文章 (@)"
                active={picker === 'article'}
                onClick={() => togglePicker('article')}
              >
                <AtSign className="h-3.5 w-3.5" />
              </ToolButton>
              <ToolButton
                ref={slashBtnRef}
                title="斜杠命令 (/)"
                active={picker === 'slash'}
                onClick={() => togglePicker('slash')}
              >
                <SlashSquare className="h-3.5 w-3.5" />
              </ToolButton>
              <span className="ml-1.5 hidden truncate font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] lg:inline">
                Enter 发送 · Shift+Enter 换行
              </span>
            </div>

            {streaming ? (
              <button
                type="button"
                onClick={onAbort}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[color-mix(in_oklch,var(--signal-danger)_28%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_18%,transparent)] px-3 text-[12px] font-medium text-[var(--signal-danger)] transition-colors hover:bg-[color-mix(in_oklch,var(--signal-danger)_24%,transparent)] active:scale-95"
                aria-label="停止生成"
                title="停止生成"
              >
                <Square className="h-3 w-3 fill-current" />
                停止
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSend(value)}
                disabled={!value.trim()}
                className={cn(
                  'grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[var(--hub-on-accent)] shadow-[var(--hub-accent-shadow)] transition-transform [background:var(--hub-gradient)] active:scale-95 md:h-11 md:w-11',
                  !value.trim() && 'cursor-not-allowed opacity-50',
                )}
                aria-label="发送"
                title="发送（Enter）"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            )}
          </div>

          <ArticlePicker
            open={picker === 'article'}
            anchorRef={atBtnRef}
            selectedIds={new Set(selectedArticles.map((a) => a.id))}
            onClose={() => setPicker(null)}
            onPick={(a) => onPickArticle(a)}
          />
          <SlashPicker
            open={picker === 'slash'}
            anchorRef={slashBtnRef}
            onClose={() => setPicker(null)}
            onPick={(cmd) => {
              setPicker(null);
              onSlashCommand(cmd);
            }}
          />
        </div>
      </div>
    </div>
  );
}

const ToolButton = forwardRef<
  HTMLButtonElement,
  {
    children: ReactNode;
    title: string;
    active?: boolean;
    onClick?: () => void;
  }
>(function ToolButton({ children, title, active, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 active:scale-95',
        active
          ? 'bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)] ring-1 ring-[color-mix(in_oklch,var(--aurora-1)_35%,transparent)]'
          : 'text-[var(--ink-muted)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--aurora-1)]',
      )}
    >
      {children}
    </button>
  );
});

// =============================================================================
// PickerPopover —— 通用弹层
// =============================================================================

function PickerPopover({
  open,
  onClose,
  anchorRef,
  ariaLabel,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={wrapRef}
          role="dialog"
          aria-modal="false"
          aria-label={ariaLabel}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            'absolute bottom-full left-0 z-40 mb-2 overflow-hidden rounded-xl border border-[var(--hub-border)] bg-[var(--hub-panel-strong)] shadow-[0_24px_48px_-16px_rgba(0,0,0,0.35)] backdrop-blur-2xl',
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// =============================================================================
// ArticlePicker —— @ 选文章
// =============================================================================

function ArticlePicker({
  open,
  onClose,
  anchorRef,
  selectedIds,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  selectedIds: Set<number>;
  onPick: (article: AgentArticle) => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, total, loading, error } = useArticleSearch(
    query,
    open,
    page,
    ARTICLE_PAGE_SIZE,
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setPage(1);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const isSearching = query.trim().length > 0;
  const totalPages = isSearching ? 1 : Math.max(1, Math.ceil(total / ARTICLE_PAGE_SIZE));
  const canPrev = !isSearching && page > 1 && !loading;
  const canNext = !isSearching && page < totalPages && !loading;

  const showInitialLoading = loading && items.length === 0;
  const showEmpty = !loading && !error && items.length === 0;

  return (
    <PickerPopover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel="引用文章"
      className="w-[360px]"
    >
      <div className="border-b border-[var(--hub-border)] p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文章…"
            className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-control)] py-2 pl-8 pr-2 text-[12.5px] text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] focus:outline-none focus:ring-1 focus:ring-[color-mix(in_oklch,var(--aurora-1)_15%,transparent)]"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]">
          <span>§ {isSearching ? 'Search' : 'Articles'}</span>
          <span>{total} 条</span>
        </div>
      </div>
      {/* 列表区域固定高度 —— 内容数量变化不影响 modal 整体尺寸。 */}
      <div className="relative h-[300px] overflow-y-auto py-1">
        {showInitialLoading && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            搜索中…
          </div>
        )}
        {error && !loading && (
          <div className="px-3 py-3 text-[var(--fs-caption)] text-[var(--signal-danger)]">
            {error}
          </div>
        )}
        {showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            没有找到匹配的文章
          </div>
        )}
        {items.length > 0 && (
          <div
            className={cn(
              'transition-opacity duration-150',
              loading ? 'opacity-50' : 'opacity-100',
            )}
          >
            {items.map((article) => {
              const selected = selectedIds.has(article.id);
              return (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => onPick(article)}
                  disabled={selected}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors',
                    selected
                      ? 'cursor-default text-[var(--aurora-1)]'
                      : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
                  )}
                >
                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 text-[13px]">{article.title}</div>
                    {article.summary && (
                      <div className="mt-0.5 line-clamp-1 text-[11.5px] text-[var(--ink-muted)]">
                        {article.summary}
                      </div>
                    )}
                    {(article.category || article.publishedAt) && (
                      <div className="mt-1 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                        {article.category && (
                          <span className="truncate">{article.category}</span>
                        )}
                        {article.category && article.publishedAt && (
                          <span aria-hidden="true">·</span>
                        )}
                        {article.publishedAt && <span>{article.publishedAt}</span>}
                      </div>
                    )}
                  </div>
                  {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* 分页 footer —— 始终渲染，禁用态用透明度区分。 */}
      <div className="flex items-center justify-between border-t border-[var(--hub-border)] px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={!canPrev}
          aria-label="上一页"
          className="flex h-6 w-6 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-30 enabled:hover:bg-[var(--hub-control-hover)] enabled:hover:text-[var(--ink-primary)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span>{isSearching ? '搜索结果' : `第 ${page} / ${totalPages} 页`}</span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={!canNext}
          aria-label="下一页"
          className="flex h-6 w-6 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-30 enabled:hover:bg-[var(--hub-control-hover)] enabled:hover:text-[var(--ink-primary)]"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </PickerPopover>
  );
}

// =============================================================================
// SlashPicker —— / 选命令
// =============================================================================

function SlashPicker({
  open,
  onClose,
  anchorRef,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  onPick: (cmd: SlashCommand) => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => filterSlashCommands(query), [query]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  return (
    <PickerPopover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel="选择命令"
      className="w-[320px]"
    >
      <div className="border-b border-[var(--hub-border)] p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索命令…"
            className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-control)] py-2 pl-8 pr-2 text-[12.5px] text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] focus:outline-none focus:ring-1 focus:ring-[color-mix(in_oklch,var(--aurora-1)_15%,transparent)]"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]">
          § Commands · {SLASH_COMMANDS.length}
        </div>
      </div>
      <div className="max-h-[320px] overflow-y-auto py-1">
        {visible.length === 0 && (
          <div className="px-3 py-6 text-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            没有匹配的命令
          </div>
        )}
        {visible.map((cmd) => (
          <button
            key={cmd.command}
            type="button"
            onClick={() => onPick(cmd)}
            className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
          >
            <SlashSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[12.5px] tracking-[-0.01em]">{cmd.command}</div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--ink-muted)]">
                {cmd.description}
              </div>
            </div>
            <span className="mt-0.5 shrink-0 font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              {cmd.kind === 'local' ? '本地' : '模板'}
            </span>
          </button>
        ))}
      </div>
    </PickerPopover>
  );
}

// =============================================================================
// 右侧上下文面板 —— 当前会话元信息
// =============================================================================

function ContextPanel({
  session,
  modelsState,
  collapsed,
  displayMode,
  onSetDisplayMode,
  streamAnimation,
  onSetStreamAnimation,
  fontSize,
  onSetFontSize,
  onToggleCollapsed,
  onDeleteSession,
  onClearMessages,
}: {
  session: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  collapsed: boolean;
  displayMode: DisplayMode;
  onSetDisplayMode: (mode: DisplayMode) => void;
  streamAnimation: StreamAnimationMode;
  onSetStreamAnimation: (m: StreamAnimationMode) => void;
  fontSize: number;
  onSetFontSize: (n: number) => void;
  onToggleCollapsed: () => void;
  onDeleteSession: () => void;
  onClearMessages: () => void;
}) {
  const items = modelsState.status === 'ready' ? modelsState.items : [];
  const modelDisplay = useMemo(() => {
    if (!session?.modelId) return '自动路由';
    const found = items.find(
      (m) => m.modelId === session.modelId && m.providerCode === session.providerCode,
    );
    return found ? modelLabel(found) : session.modelId;
  }, [session?.modelId, session?.providerCode, items]);

  const messageCount = session?.messages.length ?? 0;
  const userMessageCount = session?.messages.filter((m) => m.role === 'user').length ?? 0;

  const handleCopyId = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.id);
      toast.success('对话 ID 已复制');
    } catch {
      toast.error('复制失败，请手动选中复制');
    }
  };

  if (collapsed) {
    // 收起态：渲染一个浮动的展开按钮（绝对定位到右上），不再占用 grid 列
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label="展开当前对话面板"
        title="展开当前对话面板"
        className="fixed right-4 top-[72px] z-20 hidden h-10 w-10 place-items-center rounded-full border border-[var(--hub-border)] bg-[var(--hub-panel-strong)] text-[var(--ink-secondary)] shadow-[var(--hub-card-shadow)] backdrop-blur-2xl transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] xl:grid"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
    );
  }

  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="hidden h-full min-h-0 flex-col gap-4 border-l border-[var(--hub-border)] bg-[var(--hub-panel)] p-4 backdrop-blur-2xl xl:flex"
    >
      <div className="flex items-center justify-between px-2 pb-1 pt-3">
        <h2 className="text-sm font-semibold text-[var(--ink-primary)]">当前对话</h2>
        <div className="flex items-center gap-2">
          <IconButton label="收起" onClick={onToggleCollapsed}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
          <IconButton label="更多">
            <MoreHorizontal className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <PanelCard>
        <h3 className="mb-4 text-sm font-medium text-[var(--ink-primary)]">对话信息</h3>
        <MetadataRow label="对话 ID" value={session?.id ?? '—'} mono />
        <MetadataRow
          label="创建时间"
          value={session ? formatDate(new Date(session.createdAt), 'yyyy-MM-dd HH:mm:ss') : '—'}
          mono
        />
        <MetadataRow
          label="最近活动"
          value={session ? formatDate(new Date(session.updatedAt), 'yyyy-MM-dd HH:mm:ss') : '—'}
          mono
        />
        <MetadataRow label="模型" value={modelDisplay} />
        <MetadataRow
          label="消息数"
          value={`${messageCount} / 用户 ${userMessageCount}`}
          mono
        />
        <button
          type="button"
          onClick={handleCopyId}
          disabled={!session}
          className={cn(
            'mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--hub-border)] text-sm text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
            !session && 'cursor-not-allowed opacity-60',
          )}
        >
          <Copy className="h-4 w-4" />
          复制 ID
        </button>
      </PanelCard>

      <PanelCard>
        <h3 className="mb-3 text-sm font-medium text-[var(--ink-primary)]">显示模式</h3>
        <div className="grid grid-cols-2 gap-2">
          <DisplayModeOption
            active={displayMode === 'bubble'}
            label="气泡"
            description="彩色卡片承载"
            onClick={() => onSetDisplayMode('bubble')}
          />
          <DisplayModeOption
            active={displayMode === 'engraved'}
            label="版书"
            description="文字浮印纸面"
            onClick={() => onSetDisplayMode('engraved')}
          />
        </div>
      </PanelCard>

      <PanelCard>
        <h3 className="mb-3 text-sm font-medium text-[var(--ink-primary)]">过渡动画</h3>
        <p className="mb-3 text-[11.5px] leading-snug text-[var(--ink-muted)]">
          流式吐字节流；越平滑阅读节奏越稳。完成态立即显示完整文本。
        </p>
        <SegmentedControl
          value={streamAnimation}
          options={[
            { value: 'none', label: '无' },
            { value: 'fade', label: '淡入' },
            { value: 'smooth', label: '平滑' },
          ]}
          onChange={(v) => onSetStreamAnimation(v as StreamAnimationMode)}
        />
      </PanelCard>

      <PanelCard>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-medium text-[var(--ink-primary)]">字体大小</h3>
          <span className="font-mono text-[11px] tnum text-[var(--ink-muted)]">{fontSize}px</span>
        </div>
        <input
          type="range"
          min={12}
          max={18}
          step={0.5}
          value={fontSize}
          onChange={(e) => onSetFontSize(Number(e.target.value))}
          className="hub-range w-full"
          aria-label="字体大小"
          style={
            {
              '--hub-range-progress': `${(fontSize - 12) / (18 - 12)}`,
            } as React.CSSProperties
          }
        />
        <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
          <span>A</span>
          <span>标准</span>
          <span>A</span>
        </div>
      </PanelCard>

      <PanelCard>
        <h3 className="mb-4 text-sm font-medium text-[var(--ink-primary)]">快捷操作</h3>
        <div className="grid grid-cols-1 gap-3">
          <ActionButton icon={Pencil} onClick={() => toast.info('对话重命名功能开发中')}>
            重命名对话
          </ActionButton>
          <ActionButton
            icon={RefreshCcw}
            onClick={onClearMessages}
            disabled={!session || session.messages.length === 0}
          >
            清空当前对话
          </ActionButton>
          <ActionButton
            icon={Trash2}
            danger
            onClick={onDeleteSession}
            disabled={!session}
          >
            删除对话
          </ActionButton>
        </div>
      </PanelCard>

      <div className="mt-auto flex justify-end">
        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-full border border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
          aria-label="帮助"
          title="对话快捷操作仅本地生效，跨设备同步开发中"
        >
          <CircleHelp className="h-5 w-5" />
        </button>
      </div>
    </motion.aside>
  );
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--hub-border)] bg-[var(--hub-control)] p-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'h-8 rounded-lg text-[12.5px] transition-all',
              active
                ? 'bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)] shadow-[0_2px_6px_-3px_color-mix(in_oklch,var(--aurora-1)_50%,transparent)]'
                : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function DisplayModeOption({
  active,
  label,
  description,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-all',
        active
          ? 'border-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
          : 'border-[var(--hub-border)] bg-[var(--hub-control)] hover:border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] hover:bg-[var(--hub-control-hover)]',
      )}
    >
      <span
        className={cn(
          'text-[13px] font-medium',
          active ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-primary)]',
        )}
      >
        {label}
      </span>
      <span className="text-[11px] text-[var(--ink-muted)]">{description}</span>
    </button>
  );
}

function IconButton({
  children,
  label,
  className,
  onClick,
}: {
  children: ReactNode;
  label: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-9 w-9 place-items-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

function PanelCard({ children }: { children: ReactNode }) {
  return <section className="surface-leaf !rounded-xl p-4">{children}</section>;
}

function MetadataRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4 text-sm">
      <span className="text-[var(--ink-muted)]">{label}</span>
      <span
        className={cn(
          'min-w-0 truncate text-right text-[var(--ink-primary)]',
          mono && 'font-mono tnum',
        )}
      >
        {value}
      </span>
    </div>
  );
}

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ElementType;
  children: ReactNode;
  danger?: boolean;
};

function ActionButton({
  icon: Icon,
  children,
  danger,
  className,
  type,
  ...rest
}: ActionButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      {...rest}
      className={cn(
        'flex h-11 items-center justify-center gap-2 rounded-lg border text-sm transition-colors',
        danger
          ? 'border-[color-mix(in_oklch,var(--signal-danger)_22%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] disabled:opacity-50'
          : 'border-[var(--hub-border)] text-[var(--ink-primary)] hover:bg-[var(--hub-control-hover)] disabled:opacity-50',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

// =============================================================================
// 工具函数
// =============================================================================

function formatRelativeShort(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const d = new Date(timestamp);
  const sameDay =
    new Date(now).toDateString() === d.toDateString();
  if (sameDay) return formatDate(d, 'HH:mm');
  return formatDate(d, 'MM-dd');
}
