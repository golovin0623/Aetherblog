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
      } catch (e: unknown) {
        const msg = (e as { message?: string }).message || '分析失败';
        onAnalyzeFailure(msg);
        toast.error(msg);
      }
    })();
    // 依赖列表省略了 callbacks —— 它们是 useReducer 的 dispatch 包装，引用稳定；
    // 如果放进 deps 会导致重新跑 analyze 覆盖刚返回的结果。
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
    <div className="migration-step-stack">
      {/* 总体汇总 */}
      <section className="migration-summary-grid">
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
        <section className="migration-notice">
          <div className="migration-notice-title">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>备份含以下数据但不会导入</span>
          </div>
          <ul className="migration-notice-list">
            {state.analysis.unsupported.map((u) => (
              <li key={u}>· {u}</li>
            ))}
          </ul>
        </section>
      )}

      {/* 文章计划表 */}
      <section className="migration-plan-panel">
        <div className="migration-plan-toolbar">
          <div>
            <span className="migration-section-title">文章计划</span>
            <span className="migration-plan-count">{state.analysis.articlePlans.length} 条</span>
          </div>
          <div className="migration-plan-actions">
            <button
              onClick={() => toggleAll(true)}
              className="migration-button migration-button-compact"
            >
              全选可导入
            </button>
            <button
              onClick={() => toggleAll(false)}
              className="migration-button migration-button-compact migration-button-secondary"
            >
              全不选
            </button>
          </div>
        </div>

        {/* 桌面端表格 */}
        <div className="migration-plan-table" role="table" aria-label="文章导入计划">
          <div className="migration-plan-head" role="row">
            <span aria-hidden="true" />
            <span>ID</span>
            <span>标题</span>
            <span>分类</span>
            <span>动作</span>
          </div>
          <div className="migration-plan-scroll">
            {state.analysis.articlePlans.map((p) => {
              const selectable =
                p.action === 'create' || p.action === 'overwrite' || p.action === 'rename';
              const numericId = parseNumericSourceId(p.sourceId);
              return (
                <div key={p.sourceKey} className="migration-plan-row" role="row" data-selectable={selectable}>
                  <div className="migration-plan-check">
                    <input
                      type="checkbox"
                      disabled={!selectable}
                      checked={selectedInternal.has(p.sourceKey)}
                      onChange={() => toggleOne(p.sourceKey, numericId)}
                      aria-label={`选择 ${p.title}`}
                    />
                  </div>
                  <div className="migration-plan-id">{p.sourceId}</div>
                  <div className="migration-plan-title">
                    <div className="migration-plan-title-main">{p.title}</div>
                    <div className="migration-plan-title-sub">{p.slug}</div>
                  </div>
                  <div className="migration-plan-category">{p.category || '—'}</div>
                  <div className="migration-plan-action">
                    <ActionBadge action={p.action} reason={p.reason} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 移动端卡片列表 */}
        <div className="migration-plan-mobile">
          {state.analysis.articlePlans.map((p) => {
            const selectable =
              p.action === 'create' || p.action === 'overwrite' || p.action === 'rename';
            const numericId = parseNumericSourceId(p.sourceId);
            return (
              <label
                key={p.sourceKey}
                className={`flex items-start gap-3 px-4 py-3 ${selectable ? 'active:bg-[var(--bg-secondary)]/40' : 'opacity-70'} touch-manipulation`}
              >
                <input
                  type="checkbox"
                  disabled={!selectable}
                  checked={selectedInternal.has(p.sourceKey)}
                  onChange={() => toggleOne(p.sourceKey, numericId)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[var(--text-primary)] break-all">{p.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
                    <span className="font-mono">#{p.sourceId}</span>
                    {p.slug && <span className="truncate max-w-[60%]">{p.slug}</span>}
                    {p.category && <span>· {p.category}</span>}
                  </div>
                <div className="mt-2">
                  <ActionBadge action={p.action} reason={p.reason} />
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      {/* 分类/标签 create vs reuse */}
      <section className="migration-entity-grid">
        <EntityPlanList title="分类" plans={state.analysis.categoryPlans} />
        <EntityPlanList title="标签" plans={state.analysis.tagPlans} />
      </section>

      <div className="migration-wizard-actions migration-wizard-actions-between">
        <button
          onClick={onBack}
          className="migration-button migration-button-secondary"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          disabled={counts.importableArticles === 0}
          className="migration-button migration-button-primary"
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
    <div className="migration-entity-card">
      <div className="migration-section-title">
        {title} ({plans.length})
      </div>
      <div className="migration-entity-tags">
        {plans.map((p) => (
          <span
            key={p.name}
            className="migration-entity-tag"
            data-action={p.action}
          >
            {p.name}
            <span>{p.action === 'create' ? '新建' : '复用'}</span>
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
      className={`migration-action-badge ${m.cls}`}
      data-action={action}
      title={reason || ''}
    >
      {m.icon}
      {m.label}
    </span>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="migration-summary-card" data-highlight={highlight || undefined}>
      <div className="migration-summary-label">{label}</div>
      <div className="migration-summary-value">{value}</div>
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
    <div className="migration-center-box">
      <div>{icon}</div>
      <div className="text-sm">{text}</div>
      {action}
    </div>
  );
}
