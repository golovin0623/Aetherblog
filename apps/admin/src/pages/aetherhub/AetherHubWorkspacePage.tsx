import {
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
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Copy,
  LayoutGrid,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
  Settings,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { AetherMark } from '@aetherblog/ui';
import { MarkdownPreview } from '@aetherblog/editor';
import { formatDate } from '@aetherblog/utils';
import { useAuthStore } from '@/stores';
import { getMediaUrl } from '@/services/mediaService';
import { cn } from '@/lib/utils';
import {
  type AgentMessage,
  type AgentSession,
  type ChatStreamRequest,
  createEmptySession,
  deriveSessionTitle,
  groupSessionsByRecency,
  loadSessions,
  modelLabel,
  newMessageId,
  saveSessions,
  streamAgentChat,
  useAgentModels,
} from '@/services/agent';

const promptChips = [
  '总结 AetherBlog 项目的整体结构',
  '帮我修复最近的构建错误',
  '生成部署检查清单',
  '解释 pgvector 半自动调优策略',
];

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
    [streaming, activeSession, updateSession],
  );

  return (
    <div className="aetherhub-workspace h-dvh max-h-dvh overflow-hidden bg-[var(--bg-void)] text-[var(--ink-primary)]">
      <div className="relative h-dvh max-h-dvh overflow-hidden bg-[var(--bg-void)]">
        <div className="aurora-layer opacity-70" data-animated="true" aria-hidden="true" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'var(--hub-canvas-overlay)' }}
          aria-hidden="true"
        />

        <div className="relative z-10 grid h-dvh max-h-dvh min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_320px]">
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

          <section className="flex h-dvh max-h-dvh min-w-0 flex-col border-x border-[var(--hub-border)]">
            <TopBar
              currentUser={currentUser}
              activeSession={activeSession}
              modelsState={modelsState}
              streaming={streaming}
              onSetModel={handleSetModel}
              onBack={() => navigate('/dashboard')}
              onNewSession={handleNewSession}
            />

            <WorkspaceCanvas
              greeting={greeting}
              nickname={currentUser.nickname}
              activeSession={activeSession}
              modelsState={modelsState}
              streaming={streaming}
              composer={composer}
              onComposerChange={setComposer}
              onSend={handleSend}
              onAbort={handleAbort}
              onSetModel={handleSetModel}
              onPickPrompt={(text) => setComposer(text)}
            />
          </section>

          <ContextPanel
            session={activeSession}
            modelsState={modelsState}
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
    <aside className="hidden h-dvh max-h-dvh min-h-0 flex-col border-r border-[var(--hub-border)] bg-[var(--hub-panel)] px-5 py-4 backdrop-blur-2xl lg:flex">
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
  onSetModel,
  onBack,
  onNewSession,
}: {
  currentUser: CurrentUser;
  activeSession: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  streaming: boolean;
  onSetModel: (modelId: string | null, providerCode: string | null) => void;
  onBack: () => void;
  onNewSession: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--hub-border)] bg-[var(--hub-panel)] px-3 backdrop-blur-2xl md:h-[68px] md:px-7">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] lg:hidden"
          aria-label="返回管理后台"
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center">
          <AetherMark size={30} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--ink-primary)]">
            {activeSession?.title || 'AetherHub'}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
            {streaming ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                正在生成回答
              </>
            ) : (
              <>
                <span className="grid h-2.5 w-2.5 place-items-center rounded-full bg-[color-mix(in_oklch,var(--signal-success)_22%,transparent)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--signal-success)]" />
                </span>
                就绪
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ModelPickerButton
          activeSession={activeSession}
          modelsState={modelsState}
          disabled={streaming}
          onSetModel={onSetModel}
        />
        <button
          type="button"
          onClick={onNewSession}
          disabled={streaming}
          aria-label="新建对话"
          title="新建对话"
          className={cn(
            'grid h-9 w-9 place-items-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] md:hidden',
            streaming && 'cursor-not-allowed opacity-60',
          )}
        >
          <Plus className="h-4 w-4" />
        </button>
        {currentUser.avatarUrl ? (
          <img
            src={currentUser.avatarUrl}
            alt={currentUser.nickname}
            className="ml-1 h-9 w-9 rounded-full object-cover"
          />
        ) : (
          <div
            className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_72%,var(--bg-raised))] text-sm font-semibold text-[var(--hub-on-accent)]"
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
}: {
  activeSession: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  disabled: boolean;
  onSetModel: (modelId: string | null, providerCode: string | null) => void;
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
        className={cn(
          'inline-flex h-9 max-w-[200px] items-center gap-2 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-control)] px-3 text-sm text-[var(--ink-primary)] transition-colors hover:bg-[var(--hub-control-hover)]',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <Bot className="h-4 w-4 text-[var(--ink-secondary)]" />
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className="h-4 w-4 text-[var(--ink-muted)]" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[280px] max-h-[420px] overflow-y-auto rounded-xl border border-[var(--hub-border)] bg-[var(--hub-panel-strong)] p-2 shadow-[var(--hub-card-shadow)] backdrop-blur-2xl">
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
  activeSession,
  modelsState,
  streaming,
  composer,
  onComposerChange,
  onSend,
  onAbort,
  onSetModel,
  onPickPrompt,
}: {
  greeting: string;
  nickname: string;
  activeSession: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  streaming: boolean;
  composer: string;
  onComposerChange: (value: string) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  onSetModel: (modelId: string | null, providerCode: string | null) => void;
  onPickPrompt: (text: string) => void;
}) {
  const isEmpty = !activeSession || activeSession.messages.length === 0;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const messages = activeSession?.messages ?? [];

  // 流式过程中保持滚到底
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, streaming]);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 md:px-8 md:pt-12">
        <div className="mx-auto w-full max-w-[820px]">
          {isEmpty ? (
            <EmptyState
              greeting={greeting}
              nickname={nickname}
              onPickPrompt={onPickPrompt}
            />
          ) : (
            <div className="flex flex-col gap-6 pb-6">
              {messages.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
              {streaming && messages[messages.length - 1]?.role === 'assistant' && (
                <div className="text-[var(--fs-caption)] text-[var(--ink-muted)]">
                  按下 ⏹ 可随时停止
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Composer
        value={composer}
        onChange={onComposerChange}
        onSend={onSend}
        onAbort={onAbort}
        streaming={streaming}
        modelsState={modelsState}
        activeSession={activeSession}
        onSetModel={onSetModel}
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

function MessageRow({ message }: { message: AgentMessage }) {
  const [thinkOpen, setThinkOpen] = useState(false);
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--hub-active)] text-[var(--hub-accent)]">
          <Sparkles className="h-4 w-4" />
        </div>
      )}
      <div className={cn('min-w-0 max-w-[88%]', isUser ? 'text-right' : 'text-left')}>
        {isUser ? (
          <div className="inline-block rounded-2xl bg-[var(--hub-active)] px-4 py-2.5 text-left text-sm text-[var(--ink-primary)] whitespace-pre-wrap">
            {message.content}
          </div>
        ) : (
          <div className="surface-leaf inline-block !rounded-2xl px-4 py-3 text-left text-sm">
            {message.think && (
              <button
                type="button"
                onClick={() => setThinkOpen((v) => !v)}
                className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--hub-control)] px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-primary)]"
              >
                {thinkOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                思考过程
              </button>
            )}
            {thinkOpen && message.think && (
              <pre className="mb-3 whitespace-pre-wrap rounded-lg bg-[var(--hub-control)] px-3 py-2 text-[11px] text-[var(--ink-muted)]">
                {message.think}
              </pre>
            )}
            {message.content ? (
              <MarkdownPreview content={message.content} className="text-sm leading-relaxed" />
            ) : message.pending ? (
              <span className="inline-flex items-center gap-2 text-[var(--ink-muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                思考中…
              </span>
            ) : null}
            {message.error && (
              <div className="mt-2 rounded-lg bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] px-3 py-2 text-[var(--fs-caption)] text-[var(--signal-danger)]">
                {message.error}
              </div>
            )}
            {message.sources && message.sources.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {message.sources.map((s) => (
                  <span
                    key={s.slug}
                    className="rounded-md bg-[var(--hub-control)] px-2 py-0.5 text-[11px] text-[var(--ink-muted)]"
                  >
                    {s.title}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <div
          className={cn(
            'mt-1 text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)] tnum',
            isUser ? 'text-right' : 'text-left',
          )}
        >
          {formatDate(new Date(message.createdAt), 'HH:mm:ss')}
        </div>
      </div>
    </div>
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
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
  activeSession: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  onSetModel: (modelId: string | null, providerCode: string | null) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  return (
    <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:px-8">
      <div className="mx-auto w-full max-w-[820px]">
        <div className="surface-overlay !rounded-3xl p-3 md:p-4">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={streaming}
            placeholder="输入问题，回车发送 · Shift + 回车换行"
            className="block w-full resize-none bg-transparent px-1 py-2 text-[15px] text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:outline-none disabled:opacity-60 md:text-[var(--fs-body)]"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <ModelPickerButton
              activeSession={activeSession}
              modelsState={modelsState}
              disabled={streaming}
              onSetModel={onSetModel}
            />
            {streaming ? (
              <button
                type="button"
                onClick={onAbort}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-primary)] transition-colors hover:bg-[var(--hub-control-hover)] md:h-11 md:w-11"
                aria-label="停止生成"
                title="停止生成"
              >
                <Square className="h-4 w-4" />
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
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// 右侧上下文面板 —— 当前会话元信息
// =============================================================================

function ContextPanel({
  session,
  modelsState,
  onDeleteSession,
  onClearMessages,
}: {
  session: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
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

  return (
    <aside className="hidden h-dvh max-h-dvh min-h-0 flex-col gap-4 border-l border-[var(--hub-border)] bg-[var(--hub-panel)] p-4 backdrop-blur-2xl xl:flex">
      <div className="flex items-center justify-between px-2 pb-1 pt-7">
        <h2 className="text-sm font-semibold text-[var(--ink-primary)]">当前对话</h2>
        <div className="flex items-center gap-2">
          <IconButton label="收起">
            <ChevronUp className="h-4 w-4" />
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
    </aside>
  );
}

function IconButton({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
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
