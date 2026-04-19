import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, XCircle, SkipForward, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { WizardState } from '../useMigrationWizard';
import { migrationService, type AnalysisReport, type ArticleAction } from '@/services/migrationService';

interface Props {
  state: WizardState;
  onAnalyzeStart: () => void;
  onAnalyzeSuccess: (a: AnalysisReport) => void;
  onAnalyzeFailure: (e: string) => void;
  onSelectedIdsChange: (ids: Set<number> | null) => void;
  onBack: () => void;
  onNext: () => void;
}

/** Step 3：触发 /analyze，展示逐条文章计划 + 分类标签 create/reuse 列表。 */
export function StepPreview({
  state,
  onAnalyzeStart,
  onAnalyzeSuccess,
  onAnalyzeFailure,
  onSelectedIdsChange,
  onBack,
  onNext,
}: Props) {
  const [selectedInternal, setSelectedInternal] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!state.file) return;
    if (state.analysis) return;
    (async () => {
      onAnalyzeStart();
      try {
        const rep = await migrationService.analyze(state.file!, state.options);
        onAnalyzeSuccess(rep);
        // 默认全选所有 create/overwrite/rename 计划。
        const initial = new Set<string>();
        rep.articlePlans.forEach((p) => {
          if (p.action === 'create' || p.action === 'overwrite' || p.action === 'rename') {
            initial.add(p.sourceKey);
          }
        });
        setSelectedInternal(initial);
      } catch (e: any) {
        onAnalyzeFailure(e.message || '分析失败');
        toast.error(e.message || '分析失败');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.file, state.options, state.analysis]);

  const sum = state.analysis?.summary;

  const toggleAll = (checked: boolean) => {
    if (!state.analysis) return;
    if (!checked) {
      setSelectedInternal(new Set());
      onSelectedIdsChange(new Set());
      return;
    }
    const all = new Set<string>();
    state.analysis.articlePlans.forEach((p) => {
      if (p.action === 'create' || p.action === 'overwrite' || p.action === 'rename') {
        all.add(p.sourceKey);
      }
    });
    setSelectedInternal(all);
    onSelectedIdsChange(null); // null = 全选 → 不传 onlyArticleIds
  };

  const toggleOne = (sourceKey: string, numericId: number | null) => {
    const next = new Set(selectedInternal);
    if (next.has(sourceKey)) next.delete(sourceKey);
    else next.add(sourceKey);
    setSelectedInternal(next);
    if (numericId === null) {
      // 没有数字 id 的条目无法通过 onlyArticleIds 精准控制，告警即可。
      return;
    }
    if (!state.analysis) return;
    // 全量计划的所有可选条目都有 id（VanBlog 实测 74/74）。
    const ids = new Set<number>();
    state.analysis.articlePlans.forEach((p) => {
      if (next.has(p.sourceKey)) {
        const id = parseNumericSourceId(p.sourceId);
        if (id !== null) ids.add(id);
      }
    });
    onSelectedIdsChange(ids);
  };

  const counts = useMemo(() => sum, [sum]);

  if (state.analyzing) {
    return <CenterBox icon={<Loader2 className="h-6 w-6 animate-spin" />} text="正在分析备份…" />;
  }
  if (state.analyzeError) {
    return (
      <CenterBox
        icon={<AlertTriangle className="h-6 w-6 text-amber-400" />}
        text={state.analyzeError}
        action={
          <button onClick={onBack} className="rounded-xl bg-[var(--bg-secondary)] px-4 py-2 text-sm">
            返回上一步
          </button>
        }
      />
    );
  }
  if (!state.analysis || !counts) {
    return <CenterBox icon={<Loader2 className="h-6 w-6 animate-spin" />} text="等待分析结果…" />;
  }

  return (
    <div className="space-y-6">
      {/* 总体汇总 */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="将新建文章" value={counts.willCreatePosts} />
        <SummaryCard label="将覆盖" value={counts.willOverwritePosts} />
        <SummaryCard label="将跳过重复" value={counts.willSkipDuplicates} />
        <SummaryCard label="可导入合计" value={counts.importableArticles} highlight />
        <SummaryCard label="新分类" value={counts.createdCategories} />
        <SummaryCard label="复用分类" value={counts.reusedCategories} />
        <SummaryCard label="新标签" value={counts.createdTags} />
        <SummaryCard label="复用标签" value={counts.reusedTags} />
      </section>

      {state.analysis.unsupported.length > 0 && (
        <section className="rounded-xl surface-leaf p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <AlertTriangle className="h-4 w-4" />
            备份含以下数据但不会导入
          </div>
          <ul className="mt-2 space-y-1 text-sm text-[var(--text-secondary)]">
            {state.analysis.unsupported.map((u) => (
              <li key={u}>· {u}</li>
            ))}
          </ul>
        </section>
      )}

      {/* 文章计划表 */}
      <section className="overflow-hidden rounded-2xl surface-leaf">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3 text-xs uppercase tracking-wide text-[var(--text-muted)]">
          <span>文章计划 ({state.analysis.articlePlans.length})</span>
          <div className="flex gap-2">
            <button
              onClick={() => toggleAll(true)}
              className="rounded-lg bg-[var(--bg-secondary)] px-3 py-1 text-[var(--text-primary)]"
            >
              全选可导入
            </button>
            <button
              onClick={() => toggleAll(false)}
              className="rounded-lg bg-[var(--bg-secondary)] px-3 py-1 text-[var(--text-primary)]"
            >
              全不选
            </button>
          </div>
        </div>
        <div className="max-h-[50vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--bg-card)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="w-10 px-4 py-2"></th>
                <th className="w-16 px-2 py-2 text-left">ID</th>
                <th className="px-2 py-2 text-left">标题</th>
                <th className="px-2 py-2 text-left">分类</th>
                <th className="px-2 py-2 text-left">动作</th>
              </tr>
            </thead>
            <tbody>
              {state.analysis.articlePlans.map((p) => {
                const selectable =
                  p.action === 'create' || p.action === 'overwrite' || p.action === 'rename';
                const numericId = parseNumericSourceId(p.sourceId);
                return (
                  <tr key={p.sourceKey} className="border-t border-[var(--border-subtle)]">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        disabled={!selectable}
                        checked={selectedInternal.has(p.sourceKey)}
                        onChange={() => toggleOne(p.sourceKey, numericId)}
                      />
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-[var(--text-muted)]">{p.sourceId}</td>
                    <td className="px-2 py-2 text-[var(--text-primary)]">
                      <div className="truncate max-w-md">{p.title}</div>
                      <div className="text-xs text-[var(--text-muted)]">{p.slug}</div>
                    </td>
                    <td className="px-2 py-2 text-[var(--text-secondary)]">{p.category || '—'}</td>
                    <td className="px-2 py-2">
                      <ActionBadge action={p.action} reason={p.reason} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 分类/标签 create vs reuse */}
      <section className="grid gap-4 md:grid-cols-2">
        <EntityPlanList title="分类" plans={state.analysis.categoryPlans} />
        <EntityPlanList title="标签" plans={state.analysis.tagPlans} />
      </section>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="rounded-xl bg-[var(--bg-secondary)] px-5 py-2.5 text-sm text-[var(--text-primary)]"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          disabled={counts.importableArticles === 0}
          className="rounded-xl bg-[var(--aurora-1)] px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          开始导入 ({counts.importableArticles})
        </button>
      </div>
    </div>
  );
}

function parseNumericSourceId(id: string): number | null {
  const n = Number(id);
  return Number.isFinite(n) && !id.startsWith('sha1:') ? n : null;
}

function EntityPlanList({
  title,
  plans,
}: {
  title: string;
  plans: { name: string; action: 'create' | 'reuse' }[];
}) {
  return (
    <div className="rounded-xl surface-leaf p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
        {title} ({plans.length})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {plans.map((p) => (
          <span
            key={p.name}
            className={`rounded-full px-2.5 py-0.5 text-xs ${
              p.action === 'create'
                ? 'bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
            }`}
          >
            {p.name}
            {p.action === 'create' ? ' ✚' : ' ↻'}
          </span>
        ))}
      </div>
    </div>
  );
}

function ActionBadge({ action, reason }: { action: ArticleAction; reason?: string }) {
  const map: Record<ArticleAction, { label: string; icon: ReactElement; cls: string }> = {
    create: {
      label: '新建',
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      cls: 'bg-emerald-500/20 text-emerald-300',
    },
    overwrite: {
      label: '覆盖',
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      cls: 'bg-amber-500/20 text-amber-300',
    },
    rename: {
      label: '重命名导入',
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      cls: 'bg-sky-500/20 text-sky-300',
    },
    skip_duplicate: {
      label: '跳过（重复）',
      icon: <SkipForward className="h-3.5 w-3.5" />,
      cls: 'bg-[var(--bg-secondary)] text-[var(--text-muted)]',
    },
    skip_hidden: {
      label: '跳过（hidden）',
      icon: <SkipForward className="h-3.5 w-3.5" />,
      cls: 'bg-[var(--bg-secondary)] text-[var(--text-muted)]',
    },
    skip_deleted: {
      label: '跳过（deleted）',
      icon: <SkipForward className="h-3.5 w-3.5" />,
      cls: 'bg-[var(--bg-secondary)] text-[var(--text-muted)]',
    },
    skip_filtered: {
      label: '未选中',
      icon: <SkipForward className="h-3.5 w-3.5" />,
      cls: 'bg-[var(--bg-secondary)] text-[var(--text-muted)]',
    },
    invalid: {
      label: '非法',
      icon: <XCircle className="h-3.5 w-3.5" />,
      cls: 'bg-red-500/20 text-red-300',
    },
  };
  const m = map[action];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${m.cls}`}
      title={reason || ''}
    >
      {m.icon}
      {m.label}
    </span>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-4 ${highlight ? 'surface-raised' : 'bg-[var(--bg-secondary)]'}`}>
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 font-display text-3xl tnum text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function CenterBox({
  icon,
  text,
  action,
}: {
  icon: React.ReactNode;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl surface-leaf px-6 py-16 text-center text-[var(--text-primary)]">
      <div>{icon}</div>
      <div className="text-sm">{text}</div>
      {action}
    </div>
  );
}
