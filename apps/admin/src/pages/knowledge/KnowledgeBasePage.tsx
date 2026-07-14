import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FilePlus2,
  FolderOpen,
  Library,
  MessageSquareText,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Modal } from '@aetherblog/ui';
import { toast } from 'sonner';

import {
  IntelligenceHeader,
  IntelligencePanel,
  IntelligenceShell,
} from '@/components/intelligence';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import {
  knowledgeBaseService,
  type CreateKnowledgeBaseRequest,
  type KnowledgeBase,
} from '@/services/knowledgeBaseService';
import { storeKnowledgeWorkspaceHandoff } from '@/services/knowledgeWorkspaceHandoff';
import { useAuthStore } from '@/stores';
import {
  canUseKnowledgeBase,
  getKnowledgeBaseNextAction,
  getKnowledgeBaseReadiness,
  type KnowledgeBasePermission,
  type KnowledgeBaseReadiness,
  type KnowledgeBaseReadinessInput,
} from './knowledgeBaseReadiness';

const VIEW_ONLY_PRESENTATION = {
  label: '仅可查看',
  icon: ShieldCheck,
  className:
    'border-[var(--intelligence-border)] bg-[var(--intelligence-control)] text-[var(--ink-secondary)]',
};

const VIEW_ONLY_ACTION = {
  label: '查看资料',
  description: '当前权限只能查看资料清单；需要“可使用”或更高权限才能验证。',
};

const READINESS_PRESENTATION: Record<
  KnowledgeBaseReadiness,
  { label: string; icon: LucideIcon; className: string }
> = {
  empty: {
    label: '等待添加资料',
    icon: FilePlus2,
    className:
      'border-[var(--intelligence-border)] bg-[var(--intelligence-control)] text-[var(--ink-secondary)]',
  },
  processing: {
    label: '正在准备',
    icon: Clock3,
    className: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  },
  attention: {
    label: '需要处理',
    icon: CircleAlert,
    className: 'border-status-danger/30 bg-status-danger/10 text-status-danger',
  },
  ready: {
    label: '可以验证',
    icon: CheckCircle2,
    className: 'border-status-success/30 bg-status-success/10 text-status-success',
  },
};

const VISIBILITY_OPTIONS: Array<{
  value: NonNullable<CreateKnowledgeBaseRequest['visibility']>;
  label: string;
  description: string;
}> = [
  { value: 'PRIVATE', label: '仅自己', description: '只有你可以使用' },
  { value: 'TEAM', label: '团队', description: '团队成员可按权限使用' },
  { value: 'PUBLIC', label: '所有成员', description: '所有登录成员都可以使用' },
];

function toKnowledgeBaseReadinessInput(kb: KnowledgeBase): KnowledgeBaseReadinessInput {
  return {
    kind: kb.kind,
    fileCount: kb.fileCount,
    vectorizedCount: kb.vectorizedCount,
    failedCount: kb.failedCount,
    chunkCount: kb.chunkCount,
    hasActiveProfile: kb.activeProfile != null,
  };
}

export function getKnowledgeBaseDetailPath(
  slug: string,
  permission: KnowledgeBasePermission,
) {
  const basePath = `/intelligence/knowledge/${encodeURIComponent(slug)}`;
  return canUseKnowledgeBase(permission) ? basePath : `${basePath}?tab=files`;
}

export default function KnowledgeBasePage() {
  const navigate = useNavigate();
  const userId = useAuthStore((state) => state.user?.id);
  const [items, setItems] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await knowledgeBaseService.list();
      setItems(response.data || []);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, '暂时无法读取资料库，请稍后重试。'));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const readinessSummary = useMemo(() => {
    const summary: Record<KnowledgeBaseReadiness, number> & { viewOnly: number } = {
      empty: 0,
      processing: 0,
      attention: 0,
      ready: 0,
      viewOnly: 0,
    };

    items.forEach((item) => {
      const readiness = getKnowledgeBaseReadiness(toKnowledgeBaseReadinessInput(item));
      if (readiness === 'ready' && !canUseKnowledgeBase(item.effectivePermission)) {
        summary.viewOnly += 1;
        return;
      }
      summary[readiness] += 1;
    });
    return summary;
  }, [items]);

  const verifyWithKnowledgeBase = (kb: KnowledgeBase) => {
    if (!canUseKnowledgeBase(kb.effectivePermission)) {
      toast.error('当前权限只能查看资料清单，需要“可使用”或更高权限才能验证。');
      return;
    }
    if (!userId) {
      toast.error('无法确认当前用户，请重新登录后再试。');
      return;
    }

    const result = storeKnowledgeWorkspaceHandoff({
      userId,
      origin: 'knowledge-base',
      intent: 'ask',
      context: {
        mode: 'selected',
        refs: [{ kind: 'knowledge-base', id: kb.id, label: kb.name }],
      },
      draftPrompt: '请基于这个知识库回答我的问题，并为关键结论提供引用。',
    });

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    navigate('/aetherhub');
  };

  const summaryText = loading
    ? undefined
    : items.length === 0
      ? '还没有资料库，从添加第一份资料开始。'
      : `${readinessSummary.ready} 个可以验证 · ${readinessSummary.processing} 个正在准备${
          readinessSummary.attention > 0 ? ` · ${readinessSummary.attention} 个需要处理` : ''
        }${readinessSummary.viewOnly > 0 ? ` · ${readinessSummary.viewOnly} 个仅可查看` : ''}`;

  return (
    <IntelligenceShell mode="standard">
      <IntelligenceHeader
        eyebrow="INTELLIGENCE · SOURCES"
        currentLabel="3 步流程"
        title="让资料真正可用于回答"
        description="添加可信资料，等系统准备完成，再用一个真实问题检查回答与引用。"
        activeSummary={summaryText}
        icon={Library}
        actions={!loading && items.length > 0 ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="intelligence-action-button-primary !min-h-11 sm:!min-h-10"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            新建资料库
          </button>
        ) : undefined}
      />

      <KnowledgeJourney />

      <IntelligencePanel
        title="你的资料库"
        description="每个资料库都显示当前是否可用，以及此刻最应该做什么。"
        icon={FolderOpen}
        actions={
          !loading && items.length > 0 ? (
            <span className="font-mono text-xs text-[var(--intelligence-muted)]">
              {items.length} 个资料库
            </span>
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {loading ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <div className="divide-y divide-[var(--intelligence-border)]">
            {items.map((kb) => (
              <KnowledgeBaseRow
                key={kb.id}
                kb={kb}
                onOpen={() => navigate(getKnowledgeBaseDetailPath(kb.slug, kb.effectivePermission))}
                onVerify={() => verifyWithKnowledgeBase(kb)}
              />
            ))}
          </div>
        )}
      </IntelligencePanel>

      <CreateKnowledgeBaseModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(kb) => {
          setCreateOpen(false);
          toast.success(`资料库「${kb.name}」已创建，接下来添加第一份资料。`);
          navigate(`/intelligence/knowledge/${kb.slug}`);
        }}
      />
    </IntelligenceShell>
  );
}

function KnowledgeJourney() {
  const steps = [
    {
      icon: FilePlus2,
      title: '添加资料',
      description: '放入文档或已有内容',
    },
    {
      icon: Clock3,
      title: '等待可用',
      description: '系统会自动准备内容',
    },
    {
      icon: MessageSquareText,
      title: '真实问题验证',
      description: '检查结论是否有可靠引用',
    },
  ];

  return (
    <IntelligencePanel
      title="从资料到可信回答"
      description="不需要先理解复杂配置，按这条路径完成第一次验证。"
      icon={BookOpenCheck}
      bodyClassName="p-0"
    >
      <ol className="grid grid-cols-1 md:grid-cols-3">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li
              key={step.title}
              className={cn(
                'relative flex min-w-0 items-center gap-3 px-4 py-3.5',
                index > 0 &&
                  'border-t border-[var(--intelligence-border)] md:border-l md:border-t-0',
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--intelligence-border-strong)] bg-[var(--intelligence-control)] text-[var(--intelligence-accent)]">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--ink-primary)]">
                  <span className="mr-1.5 font-mono text-[11px] text-[var(--intelligence-muted)]">
                    0{index + 1}
                  </span>
                  {step.title}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-[var(--intelligence-muted)]">
                  {step.description}
                </p>
              </div>
              {index < steps.length - 1 && (
                <ArrowRight
                  className="absolute -right-2.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-[var(--intelligence-panel-strong)] p-1 text-[var(--intelligence-muted)] md:block"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </IntelligencePanel>
  );
}

function KnowledgeBaseRow({
  kb,
  onOpen,
  onVerify,
}: {
  kb: KnowledgeBase;
  onOpen: () => void;
  onVerify: () => void;
}) {
  const readinessInput = toKnowledgeBaseReadinessInput(kb);
  const readiness = getKnowledgeBaseReadiness(readinessInput);
  const canVerify = readiness === 'ready' && canUseKnowledgeBase(kb.effectivePermission);
  const nextAction = readiness === 'ready' && !canVerify
    ? VIEW_ONLY_ACTION
    : getKnowledgeBaseNextAction(readinessInput);
  const presentation = readiness === 'ready' && !canVerify
    ? VIEW_ONLY_PRESENTATION
    : READINESS_PRESENTATION[readiness];
  const StatusIcon = presentation.icon;
  const isSystem = kb.kind === 'SYSTEM_POSTS';
  const unavailableCount = Math.max(0, kb.fileCount - kb.vectorizedCount);

  return (
    <article className="grid min-w-0 gap-4 p-4 transition-colors hover:bg-[var(--intelligence-control)] sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.72fr)_auto] sm:items-center sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] text-[var(--intelligence-accent)]">
          {isSystem ? (
            <BookOpenCheck className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Library className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex min-h-11 max-w-full items-center text-left text-sm font-semibold text-[var(--ink-primary)] underline-offset-4 transition-colors hover:text-[var(--intelligence-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-h-0"
            >
              <span className="truncate">{kb.name}</span>
            </button>
            {isSystem && (
              <span className="inline-flex items-center gap-1 rounded-full border border-status-success/25 bg-status-success/10 px-2 py-0.5 text-[10px] font-medium text-status-success">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                站内文章
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--intelligence-muted)]">
            {kb.description || (isSystem ? '随站内文章更新的可信内容来源。' : '尚未填写用途说明。')}
          </p>
          <p className="mt-1.5 font-mono text-[10px] tracking-wide text-[var(--intelligence-muted)]">
            {kb.fileCount} 份资料 · {kb.vectorizedCount} 份已处理
            {readiness === 'processing' && unavailableCount > 0
              ? ` · ${unavailableCount} 份准备中`
              : ''}
            {kb.failedCount > 0 ? ` · ${kb.failedCount} 份未完成` : ''}
          </p>
        </div>
      </div>

      <div className="min-w-0">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
            presentation.className,
          )}
        >
          <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {presentation.label}
        </span>
        <p className="mt-1.5 text-xs leading-5 text-[var(--intelligence-muted)]">
          {isSystem && readiness === 'empty'
            ? '发布文章后，这里会自动出现可用内容。'
            : nextAction.description}
        </p>
      </div>

      <button
        type="button"
        onClick={canVerify ? onVerify : onOpen}
        className={cn(
          '!min-h-11 whitespace-nowrap sm:!min-h-10',
          canVerify
            ? 'intelligence-action-button-primary'
            : 'intelligence-action-button',
        )}
      >
        {isSystem && readiness === 'empty' ? '查看内容来源' : nextAction.label}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </article>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center sm:py-14">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--intelligence-border-strong)] bg-[var(--intelligence-control)] text-[var(--intelligence-accent)]">
        <FilePlus2 className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-base font-semibold text-[var(--ink-primary)]">
        先创建一个资料库
      </h2>
      <p className="mt-1.5 max-w-md text-sm leading-6 text-[var(--intelligence-muted)]">
        按主题放入一组可信资料。创建后会直接进入添加资料的下一步。
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="intelligence-action-button-primary mt-5 !min-h-11 sm:!min-h-10"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        创建第一个资料库
      </button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-[var(--intelligence-border)]" aria-label="正在读取资料库">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="grid animate-pulse gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.72fr)_7rem] sm:items-center sm:px-5"
        >
          <div className="flex gap-3">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-[var(--intelligence-control-hover)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3.5 w-2/5 rounded bg-[var(--intelligence-control-hover)]" />
              <div className="h-3 w-4/5 rounded bg-[var(--intelligence-control)]" />
              <div className="h-2.5 w-1/2 rounded bg-[var(--intelligence-control)]" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-6 w-20 rounded-full bg-[var(--intelligence-control-hover)]" />
            <div className="h-3 w-full rounded bg-[var(--intelligence-control)]" />
          </div>
          <div className="h-10 rounded-xl bg-[var(--intelligence-control-hover)]" />
        </div>
      ))}
    </div>
  );
}

function CreateKnowledgeBaseModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (kb: KnowledgeBase) => void;
}) {
  const [form, setForm] = useState<CreateKnowledgeBaseRequest>({
    name: '',
    description: '',
    visibility: 'PRIVATE',
  });
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    if (submitting) return;
    setForm({ name: '', description: '', visibility: 'PRIVATE' });
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      toast.error('请先给资料库起一个名称。');
      return;
    }

    setSubmitting(true);
    try {
      const response = await knowledgeBaseService.create({
        name,
        description: form.description?.trim() || undefined,
        visibility: form.visibility,
      });
      onCreated(response.data);
      setForm({ name: '', description: '', visibility: 'PRIVATE' });
    } catch (error) {
      const message = extractApiErrorMessage(error, '创建资料库失败，请稍后重试。');
      toast.error(
        message.toLowerCase().includes('slug')
          ? '已有同名资料库，请换一个更容易区分的名称。'
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="创建资料库"
      size="lg"
      showCloseButton={false}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="创建资料库"
        aria-describedby="create-knowledge-description"
      >
        <p
          id="create-knowledge-description"
          className="text-sm leading-6 text-[var(--ink-secondary)]"
        >
          先按用途建一个容器，下一步再添加资料。名称和用途会帮助你以后快速选择正确来源。
        </p>

        <form onSubmit={submit} className="mt-5 space-y-5">
          <Field label="资料库名称" required>
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="例如：产品规范与决策"
              maxLength={120}
              className="intelligence-input !min-h-11 w-full px-3 text-sm outline-none sm:!min-h-10"
              autoFocus
            />
          </Field>

          <Field label="用途说明" hint="可选；说明这组资料适合回答什么问题。">
            <textarea
              value={form.description || ''}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="例如：用于核对产品规则、历史决策与发布边界"
              rows={3}
              maxLength={500}
              className="intelligence-input w-full resize-none px-3 py-2.5 text-sm leading-6 outline-none"
            />
          </Field>

          <fieldset>
            <legend className="text-xs font-semibold text-[var(--ink-secondary)]">谁可以使用</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {VISIBILITY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    'flex min-h-11 cursor-pointer flex-col justify-center rounded-xl border px-3 py-2 transition-colors',
                    form.visibility === option.value
                      ? 'border-[var(--intelligence-border-strong)] bg-primary/10 text-[var(--ink-primary)]'
                      : 'border-[var(--intelligence-border)] bg-[var(--intelligence-control)] text-[var(--ink-secondary)] hover:bg-[var(--intelligence-control-hover)]',
                  )}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={option.value}
                    checked={form.visibility === option.value}
                    onChange={() =>
                      setForm((current) => ({ ...current, visibility: option.value }))
                    }
                    className="sr-only"
                  />
                  <span className="text-xs font-semibold">{option.label}</span>
                  <span className="mt-0.5 text-[10px] leading-4 text-[var(--intelligence-muted)]">
                    {option.description}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col-reverse gap-2 border-t border-[var(--intelligence-border)] pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={close}
              disabled={submitting}
              className="intelligence-action-button !min-h-11 sm:!min-h-9"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting || !form.name.trim()}
              className="intelligence-action-button-primary !min-h-11 sm:!min-h-10"
            >
              {submitting ? '正在创建…' : '创建并添加资料'}
              {!submitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-[var(--ink-secondary)]">
        {label}
        {required && <span className="ml-0.5 text-status-danger">*</span>}
      </span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-[11px] leading-5 text-[var(--intelligence-muted)]">
          {hint}
        </span>
      )}
    </label>
  );
}
