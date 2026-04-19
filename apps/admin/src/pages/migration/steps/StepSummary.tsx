import { CheckCircle2, AlertTriangle, XCircle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { WizardState } from '../useMigrationWizard';

interface Props {
  state: WizardState;
  onRestart: () => void;
}

/** Step 5：展示最终统计 + 深链到新导入的文章。 */
export function StepSummary({ state, onRestart }: Props) {
  const s = state.summary;
  if (state.fatalError && !s) {
    return (
      <div className="space-y-4 rounded-2xl surface-leaf p-8 text-center">
        <XCircle className="mx-auto h-12 w-12 text-red-400" />
        <h3 className="font-display text-2xl text-[var(--text-primary)]">导入未完成</h3>
        <p className="text-sm text-[var(--text-secondary)]">{state.fatalError}</p>
        <button
          onClick={onRestart}
          className="rounded-xl bg-[var(--aurora-1)] px-5 py-2 text-sm text-white"
        >
          重新开始
        </button>
      </div>
    );
  }
  if (!s) {
    return (
      <div className="rounded-2xl surface-leaf p-8 text-center text-[var(--text-secondary)]">
        还在等待服务端 summary…
      </div>
    );
  }

  const ok = s.failedPosts === 0 && s.errors.length === 0;

  // 深链：postMap 在 SSE 中以 recentItems 里 kind=article + postId 记录。
  const createdLinks = state.recentItems
    .filter((it) => it.kind === 'article' && it.postId && (it.action === 'create' || it.action === 'overwrite'))
    .slice(-10);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl surface-raised p-8">
        <div className="flex items-center gap-3">
          {ok ? (
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-8 w-8 text-amber-400" />
          )}
          <h3 className="font-display text-3xl text-[var(--text-primary)]">
            {ok ? '导入成功' : '部分完成'}
          </h3>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="新建文章" value={s.createdPosts} />
          <Stat label="覆盖文章" value={s.overwrittenPosts} />
          <Stat label="跳过" value={s.skippedPosts} />
          <Stat label="失败" value={s.failedPosts} />
          <Stat label="新建分类" value={s.createdCategories} />
          <Stat label="复用分类" value={s.reusedCategories} />
          <Stat label="新建标签" value={s.createdTags} />
          <Stat label="标签关联" value={s.createdPostTags} />
        </div>
        <div className="mt-6 flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>耗时: <span className="font-mono tnum text-[var(--text-primary)]">{s.durationMs} ms</span></span>
          <span>warnings: {s.warnings.length} · errors: {s.errors.length}</span>
        </div>
      </div>

      {createdLinks.length > 0 && (
        <section className="rounded-2xl surface-leaf p-6">
          <div className="mb-3 text-xs uppercase tracking-wide text-[var(--text-muted)]">
            最近导入的文章 (点击跳转编辑)
          </div>
          <ul className="space-y-2">
            {createdLinks.map((it, idx) => (
              <li key={idx}>
                <Link
                  to={`/posts/edit/${it.postId}`}
                  className="flex items-center justify-between rounded-lg bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]"
                >
                  <span className="truncate">{it.title || `#${it.postId}`}</span>
                  <ArrowRight className="h-4 w-4 text-[var(--aurora-1)]" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(s.warnings.length > 0 || s.errors.length > 0) && (
        <section className="grid gap-4 md:grid-cols-2">
          {s.warnings.length > 0 && (
            <div className="rounded-2xl surface-leaf p-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-amber-300">Warnings</div>
              <ul className="space-y-1 text-sm">
                {s.warnings.map((w, i) => (
                  <li key={i} className="text-[var(--text-secondary)]">· {w}</li>
                ))}
              </ul>
            </div>
          )}
          {s.errors.length > 0 && (
            <div className="rounded-2xl surface-leaf p-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-red-300">Errors</div>
              <ul className="space-y-1 text-sm">
                {s.errors.map((w, i) => (
                  <li key={i} className="text-red-300">· {w}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="flex justify-end gap-3">
        <button
          onClick={onRestart}
          className="rounded-xl bg-[var(--bg-secondary)] px-5 py-2.5 text-sm text-[var(--text-primary)]"
        >
          再次迁移
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[var(--bg-secondary)] px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 font-display text-3xl tnum text-[var(--text-primary)]">{value}</div>
    </div>
  );
}
