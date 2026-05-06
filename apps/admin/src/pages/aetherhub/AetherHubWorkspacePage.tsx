import { useEffect, useMemo, useState } from 'react';
import type { ButtonHTMLAttributes, ElementType, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Clock,
  Cloud,
  Code2,
  Copy,
  Database,
  Diamond,
  FileText,
  Folder,
  LayoutGrid,
  Mail,
  MessageSquare,
  Mic,
  MoreHorizontal,
  PenLine,
  Pin,
  Plus,
  RefreshCcw,
  Settings,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { AetherMark } from '@aetherblog/ui';
import { formatDate } from '@aetherblog/utils';
import { useAuthStore } from '@/stores';
import { getMediaUrl } from '@/services/mediaService';
import { cn } from '@/lib/utils';

type WorkspaceMode = 'chat' | 'cowork' | 'code';

const modeItems: Array<{
  id: WorkspaceMode;
  label: string;
  icon: ElementType;
}> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'cowork', label: 'Cowork', icon: Users },
  { id: 'code', label: 'Code', icon: Code2 },
];

const projectNavItems = [
  { label: '项目', icon: Folder },
  { label: '知识库 / Artifacts', icon: FileText },
  { label: '插件市场', icon: LayoutGrid },
  { label: '自动化', icon: Clock },
  { label: '设置', icon: Settings },
];

const conversationGroups = [
  {
    label: '今天',
    items: [
      { title: '在 AetherBlog 中构建什么?', time: '22:42', active: true },
      { title: '修复 S3 连接失败', time: '18:36' },
      { title: 'PR 552 审查建议', time: '16:21' },
      { title: '部署 webhook 报错排查', time: '21:15' },
    ],
  },
  {
    label: '昨天',
    items: [
      { title: '生成产品需求文档', time: '14:08' },
      { title: '优化登录页性能', time: '19:05' },
    ],
  },
  {
    label: '更早',
    items: [
      { title: '分析用户反馈数据', time: '03/12' },
      { title: '数据库设计评审', time: '03/11' },
    ],
  },
];

const connectorCards: Array<{
  title: string;
  description: string;
  icon: ElementType;
  tone: string;
}> = [
  {
    title: '连接 Slack',
    description: '从频道和讨论中获取最新信息',
    icon: MessageSquare,
    tone: 'from-[#36C5F0] via-[#2EB67D] to-[#ECB22E]',
  },
  {
    title: '连接 Gmail',
    description: '总结邮件和重要对话',
    icon: Mail,
    tone: 'from-[#EA4335] via-[#FBBC04] to-[#34A853]',
  },
  {
    title: '连接 Google Drive',
    description: '访问你的文档和文件',
    icon: Cloud,
    tone: 'from-[#4285F4] via-[#34A853] to-[#FBBC04]',
  },
  {
    title: '连接 日历',
    description: '查看日程并管理时间',
    icon: CalendarDays,
    tone: 'from-[#4285F4] via-[#7BAAF7] to-[#34A853]',
  },
];

const promptChips = [
  '总结 AetherBlog 项目的整体结构',
  '帮我修复最近的构建错误',
  '分析 PR 552 的代码变更',
  '生成部署检查清单',
];

const resources = [
  { name: 'AetherBlog PRD.md', type: '文档', size: '12KB', icon: FileText },
  { name: 'auth.ts', type: 'TypeScript', size: '8KB', icon: Code2 },
  { name: 'schema.prisma', type: 'Prisma', size: '6KB', icon: Database },
];

interface CurrentUser {
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
  const [activeMode, setActiveMode] = useState<WorkspaceMode>('chat');
  const activeModeMeta = useMemo(
    () => modeItems.find((item) => item.id === activeMode) ?? modeItems[0],
    [activeMode],
  );

  const user = useAuthStore((state) => state.user);
  const currentUser = useMemo<CurrentUser>(() => {
    const nickname = user?.nickname?.trim() || '管理员';
    const initial = Array.from(nickname)[0]?.toUpperCase() ?? 'A';
    return {
      nickname,
      initial,
      avatarUrl: user?.avatar ? getMediaUrl(user.avatar) : null,
    };
  }, [user?.nickname, user?.avatar]);

  // 会话元信息使用渲染时的本地时间，避免静态字符串永远停留在某个历史时刻。
  const [conversationCreatedAt] = useState(() => new Date());
  const [greeting, setGreeting] = useState(() => pickGreeting(new Date().getHours()));
  useEffect(() => {
    const tick = () => setGreeting(pickGreeting(new Date().getHours()));
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="aetherhub-workspace h-dvh max-h-dvh overflow-hidden bg-[var(--bg-void)] text-[var(--ink-primary)]">
      <div className="relative h-dvh max-h-dvh overflow-hidden bg-[var(--bg-void)] lg:m-0 xl:m-0">
        <div className="aurora-layer opacity-70" data-animated="true" aria-hidden="true" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'var(--hub-canvas-overlay)',
          }}
          aria-hidden="true"
        />

        <div className="relative z-10 grid h-dvh max-h-dvh min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_320px]">
          <WorkspaceSidebar
            activeMode={activeMode}
            onModeChange={setActiveMode}
            onBack={() => navigate('/dashboard')}
            currentUser={currentUser}
          />

          <section className="flex h-dvh max-h-dvh min-w-0 flex-col border-x border-[var(--hub-border)]">
            <TopBar
              activeMode={activeModeMeta}
              onBack={() => navigate('/dashboard')}
              currentUser={currentUser}
            />
            <MobileModeSwitch activeMode={activeMode} onModeChange={setActiveMode} />
            <WorkspaceCanvas
              activeMode={activeModeMeta}
              greeting={greeting}
              nickname={currentUser.nickname}
            />
          </section>

          <ContextPanel createdAt={conversationCreatedAt} />
        </div>
      </div>
    </div>
  );
}

function WorkspaceSidebar({
  activeMode,
  onModeChange,
  onBack,
  currentUser,
}: {
  activeMode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  onBack: () => void;
  currentUser: CurrentUser;
}) {
  return (
    <aside className="hidden h-dvh max-h-dvh min-h-0 flex-col border-r border-[var(--hub-border)] bg-[var(--hub-panel)] px-5 py-4 backdrop-blur-2xl lg:flex">
      <div className="mb-7 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <button
          type="button"
          onClick={onBack}
          aria-label="返回管理后台"
          className="grid h-9 w-9 place-items-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-4 grid grid-cols-3 rounded-xl border border-[var(--hub-border)] bg-[var(--hub-control)] p-1">
        {modeItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeMode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onModeChange(item.id)}
              className={cn(
                'inline-flex h-10 items-center justify-center gap-2 rounded-lg text-[var(--fs-caption)] transition-all',
                isActive
                  ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)] shadow-[0_8px_24px_-18px_var(--aurora-1)]'
                  : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="mb-4 flex h-11 w-full items-center justify-between rounded-xl px-4 text-[var(--hub-on-accent)] shadow-[var(--hub-accent-shadow)] transition-transform [background:var(--hub-gradient)] active:scale-[0.99]"
      >
        <span className="inline-flex items-center gap-3 text-sm font-medium">
          <Plus className="h-4 w-4" />
          新建对话
        </span>
        <span className="rounded-md bg-white/16 px-1.5 py-0.5 font-mono text-[11px]">⌘ K</span>
      </button>

      <nav className="space-y-1 border-b border-[var(--hub-border)] pb-5">
        {projectNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              className="flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-sm text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        <div className="mb-3">
          <div className="mb-1 px-2 text-[var(--fs-caption)] text-[var(--ink-muted)]">Pinned</div>
          <button
            type="button"
            className="flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-sm text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
          >
            <Pin className="h-4 w-4" />
            AetherBlog 项目概览
          </button>
        </div>

        {conversationGroups.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="mb-1 px-2 text-[var(--fs-caption)] text-[var(--ink-muted)]">{group.label}</div>
            <div className="space-y-1">
              {group.items.map((item) => (
                <button
                  key={`${group.label}-${item.title}`}
                  type="button"
                  className={cn(
                    'group flex h-9 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-sm transition-colors',
                    item.active
                      ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
                      : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
                  )}
                >
                  <span className="min-w-0 truncate">{item.title}</span>
                  <span className="shrink-0 text-[var(--fs-caption)] text-[var(--ink-muted)]">{item.time}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--hub-border)] pt-4">
        <button
          type="button"
          className="mb-3 flex h-9 w-full items-center gap-3 rounded-lg px-2 text-sm text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
        >
          <LayoutGrid className="h-4 w-4" />
          查看全部对话
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
            <div className="mt-0.5 inline-flex rounded-md bg-[var(--hub-control)] px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)]">
              Max Plan
            </div>
          </div>
          <button
            type="button"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
            aria-label="账户设置"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function TopBar({
  activeMode,
  onBack,
  currentUser,
}: {
  activeMode: { label: string; icon: ElementType };
  onBack: () => void;
  currentUser: CurrentUser;
}) {
  const ActiveIcon = activeMode.icon;

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
          <button
            type="button"
            className="flex max-w-[220px] items-center gap-2 truncate text-sm font-semibold text-[var(--ink-primary)]"
          >
            <span className="truncate">AetherBlog</span>
            <ChevronDown className="h-4 w-4 text-[var(--ink-muted)]" />
          </button>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)] lg:hidden">
            <ActiveIcon className="h-3.5 w-3.5" />
            {activeMode.label}
          </div>
        </div>
      </div>

      <div className="hidden items-center gap-2 text-sm text-[var(--ink-secondary)] md:flex">
        <span className="grid h-4 w-4 place-items-center rounded-full bg-[color-mix(in_oklch,var(--signal-success)_20%,transparent)]">
          <span className="h-2 w-2 rounded-full bg-[var(--signal-success)]" />
        </span>
        服务运行正常
      </div>

      <div className="flex items-center gap-2">
        <HeaderButton className="hidden sm:inline-flex">
          <Upload className="h-4 w-4" />
          导入
        </HeaderButton>
        <IconButton label="应用" className="hidden sm:grid">
          <LayoutGrid className="h-4 w-4" />
        </IconButton>
        <button
          type="button"
          className="hidden h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium text-[var(--hub-on-accent)] shadow-[var(--hub-accent-shadow)] [background:var(--hub-gradient)] sm:inline-flex"
        >
          <Diamond className="h-4 w-4" />
          升级
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

function MobileModeSwitch({
  activeMode,
  onModeChange,
}: {
  activeMode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
}) {
  return (
    <div className="border-b border-[var(--hub-border)] bg-[var(--hub-panel)] px-4 py-2.5 lg:hidden">
      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-control)] p-1">
        {modeItems.map((item) => {
          const Icon = item.icon;
          const active = activeMode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onModeChange(item.id)}
              className={cn(
                'flex h-10 items-center justify-center gap-2 rounded-xl text-[13px] transition-colors',
                active
                  ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)] shadow-[0_8px_22px_-18px_var(--aurora-1)]'
                  : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)]',
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkspaceCanvas({
  activeMode,
  greeting,
  nickname,
}: {
  activeMode: { label: string; icon: ElementType };
  greeting: string;
  nickname: string;
}) {
  const ActiveIcon = activeMode.icon;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 md:px-8 md:pb-10 md:pt-16">
      <div className="mx-auto flex w-full max-w-[860px] flex-col items-stretch md:items-center">
        <div className="mb-5 flex flex-col items-center text-center md:mb-8">
          <div className="mb-3 inline-flex items-center gap-3 md:mb-5 md:gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--hub-active)] text-[var(--hub-accent)] md:h-12 md:w-12">
              <Sparkles className="h-6 w-6 md:h-7 md:w-7" />
            </div>
            <h1 className="font-display text-[clamp(1.85rem,8vw,3.25rem)] leading-tight tracking-normal text-[var(--ink-primary)] md:leading-none">
              {greeting}，{nickname}
            </h1>
          </div>
          <p className="text-sm text-[var(--ink-secondary)] md:text-[var(--fs-lede)]">有什么可以帮你构建的?</p>
        </div>

        <div className="surface-overlay w-full !rounded-[28px] p-4 md:!rounded-[24px] md:p-5">
          <div className="min-h-[78px] text-[15px] text-[var(--ink-muted)] md:min-h-[86px] md:text-[var(--fs-body)]">
            询问 Codex、使用 @ 引用或 / 选择技能
          </div>
          <div className="flex items-end justify-between gap-3">
            <button
              type="button"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--hub-border)] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] md:h-11 md:w-11"
              aria-label="添加上下文"
            >
              <Plus className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
              <button
                type="button"
                className="hidden items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] sm:inline-flex"
              >
                <ActiveIcon className="h-4 w-4" />
                {activeMode.label} 模式
              </button>
              <button
                type="button"
                className="flex min-w-0 max-w-[46vw] items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] sm:max-w-none sm:gap-2 sm:px-2.5"
              >
                <span className="truncate">Claude 3.7 Sonnet</span>
                <ChevronDown className="h-4 w-4" />
              </button>
              <IconButton label="语音输入">
                <Mic className="h-4 w-4" />
              </IconButton>
              <button
                type="button"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[var(--hub-on-accent)] shadow-[var(--hub-accent-shadow)] transition-transform [background:var(--hub-gradient)] active:scale-95 md:h-11 md:w-11"
                aria-label="发送"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="-mx-4 mt-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mt-6 sm:w-full sm:justify-center sm:overflow-visible sm:px-0">
          <QuickMode icon={PenLine} label="写作" />
          <QuickMode icon={BookOpen} label="学习" />
          <QuickMode icon={Code2} label="代码" />
          <QuickMode icon={Workflow} label="生活" />
          <QuickMode icon={Cloud} label="从云盘" />
        </div>

        <section className="mt-8 w-full md:mt-12">
          <div className="mb-4 text-sm font-medium text-[var(--ink-primary)]">为你准备</div>
          <div className="flex snap-x gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible xl:grid-cols-4">
            {connectorCards.map((card) => (
              <ConnectorCard key={card.title} {...card} />
            ))}
          </div>
        </section>

        <section className="mt-8 w-full md:mt-12">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-medium text-[var(--ink-primary)]">建议</div>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--hub-border)] text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
              aria-label="刷新建议"
            >
              <RefreshCcw className="h-4 w-4" />
            </button>
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:gap-3 md:overflow-visible md:px-0">
            {promptChips.map((chip) => (
              <button
                key={chip}
                type="button"
                className="shrink-0 rounded-xl border border-[var(--hub-border)] bg-[var(--hub-control)] px-4 py-2 text-sm text-[var(--ink-secondary)] transition-colors hover:border-[var(--hub-border-strong)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
              >
                {chip}
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

const PLACEHOLDER_CONVERSATION_ID = 'conv_abc123def456';

function ContextPanel({ createdAt }: { createdAt: Date }) {
  const createdAtLabel = useMemo(
    () => formatDate(createdAt, 'YYYY-MM-DD HH:mm:ss'),
    [createdAt],
  );

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(PLACEHOLDER_CONVERSATION_ID);
      toast.success('对话 ID 已复制');
    } catch {
      toast.error('复制失败,请手动选中复制');
    }
  };

  const handleNotImplemented = (label: string) => {
    toast.info(`${label}：功能开发中`);
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
        <MetadataRow label="对话 ID" value={PLACEHOLDER_CONVERSATION_ID} mono />
        <MetadataRow label="创建时间" value={createdAtLabel} mono />
        <MetadataRow label="模型" value="Claude 3.7 Sonnet" />
        <MetadataRow label="消息数" value="2" mono />
        <MetadataRow
          label="状态"
          value={
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--signal-success)]" />
              进行中
            </span>
          }
        />
        <MetadataRow label="上下文窗口" value="128K" mono />
        <button
          type="button"
          onClick={handleCopyId}
          className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--hub-border)] text-sm text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
        >
          <Copy className="h-4 w-4" />
          复制 ID
        </button>
      </PanelCard>

      <PanelCard>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--ink-primary)]">资源和上下文</h3>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[var(--hub-control)] px-2 py-0.5 font-mono text-[11px] text-[var(--ink-secondary)]">
              3
            </span>
            <Plus className="h-4 w-4 text-[var(--ink-secondary)]" />
          </div>
        </div>
        <div className="space-y-3">
          {resources.map((resource) => {
            const Icon = resource.icon;
            return (
              <div key={resource.name} className="flex items-center gap-3 text-sm">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--hub-control)] text-[var(--ink-secondary)]">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--ink-primary)]">{resource.name}</span>
                <span className="shrink-0 text-[var(--fs-caption)] text-[var(--ink-muted)]">
                  {resource.type} · {resource.size}
                </span>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="mt-5 flex w-full items-center justify-center gap-2 text-sm text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-primary)]"
        >
          查看更多
          <ArrowUp className="h-3.5 w-3.5 rotate-45" />
        </button>
      </PanelCard>

      <PanelCard>
        <h3 className="mb-4 text-sm font-medium text-[var(--ink-primary)]">快捷操作</h3>
        <div className="grid grid-cols-2 gap-3">
          <ActionButton icon={Upload} onClick={() => handleNotImplemented('导出对话')}>
            导出对话
          </ActionButton>
          <ActionButton icon={Share2} onClick={() => handleNotImplemented('分享对话')}>
            分享对话
          </ActionButton>
          <ActionButton icon={Trash2} onClick={() => handleNotImplemented('清空对话')}>
            清空对话
          </ActionButton>
          <ActionButton icon={Trash2} danger onClick={() => handleNotImplemented('删除对话')}>
            删除对话
          </ActionButton>
        </div>
      </PanelCard>

      <div className="mt-auto flex justify-end">
        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-full border border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
          aria-label="帮助"
        >
          <CircleHelp className="h-5 w-5" />
        </button>
      </div>
    </aside>
  );
}

function ConnectorCard({
  title,
  description,
  icon: Icon,
  tone,
}: {
  title: string;
  description: string;
  icon: ElementType;
  tone: string;
}) {
  return (
    <article className="surface-leaf group min-h-[160px] min-w-[76vw] max-w-[320px] snap-start !rounded-xl p-4 md:min-h-[180px] md:min-w-0 md:max-w-none" data-interactive>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className={cn('grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br text-white shadow-lg', tone)}>
          <Icon className="h-5 w-5" />
        </div>
        <button
          type="button"
          className="text-[var(--ink-muted)] opacity-80 transition-opacity hover:text-[var(--ink-primary)] group-hover:opacity-100"
          aria-label="关闭建议"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <h3 className="mb-2 text-sm font-semibold text-[var(--ink-primary)]">{title}</h3>
      <p className="min-h-[44px] text-sm leading-relaxed text-[var(--ink-secondary)]">{description}</p>
      <button
        type="button"
        className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-[var(--hub-accent-text)]"
      >
        连接
        <ArrowUp className="h-3.5 w-3.5 rotate-45" />
      </button>
    </article>
  );
}

function QuickMode({ icon: Icon, label }: { icon: ElementType; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-10 min-w-[104px] shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--hub-border)] bg-[var(--hub-control)] px-4 text-sm text-[var(--ink-primary)] transition-colors hover:bg-[var(--hub-control-hover)] md:h-11 md:min-w-0 md:px-5"
    >
      <Icon className="h-4 w-4 text-[var(--ink-secondary)]" />
      {label}
    </button>
  );
}

function HeaderButton({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      className={cn(
        'h-9 items-center gap-2 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-control)] px-3 text-sm text-[var(--ink-primary)] transition-colors hover:bg-[var(--hub-control-hover)]',
        className,
      )}
    >
      {children}
    </button>
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

function ActionButton({ icon: Icon, children, danger, className, type, ...rest }: ActionButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      {...rest}
      className={cn(
        'flex h-11 items-center justify-center gap-2 rounded-lg border text-sm transition-colors',
        danger
          ? 'border-[color-mix(in_oklch,var(--signal-danger)_22%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)]'
          : 'border-[var(--hub-border)] text-[var(--ink-primary)] hover:bg-[var(--hub-control-hover)]',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}
