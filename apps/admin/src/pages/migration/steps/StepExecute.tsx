import { useEffect, useRef } from 'react';
import { Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { WizardState } from '../useMigrationWizard';
import {
  streamImport,
  type ProgressEvent,
} from '@/services/migrationService';

interface Props {
  state: WizardState;
  onExecuteStart: () => void;
  onExecuteEvent: (e: ProgressEvent) => void;
  onExecuteEnd: () => void;
  onNext: () => void;
}

/** Step 4：开启 SSE 流，实时渲染阶段进度条 + 滚动日志。 */
export function StepExecute({ state, onExecuteStart, onExecuteEvent, onExecuteEnd, onNext }: Props) {
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (startedRef.current || !state.file) return;
    startedRef.current = true;
    onExecuteStart();
    const controller = new AbortController();
    abortRef.current = controller;
    (async () => {
      try {
        await streamImport(
          state.file!,
          {
            ...state.options,
            onlyArticleIds: state.selectedArticleIds
              ? Array.from(state.selectedArticleIds)
              : undefined,
          },
          onExecuteEvent,
          controller.signal,
        );
      } catch (e: any) {
        if (e.name === 'AbortError') return;
        toast.error(e.message || '导入失败');
        onExecuteEvent({ type: 'fatal', error: e.message || '网络中断' });
      } finally {
        onExecuteEnd();
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 流结束或 fatal 时自动进入 Summary。
  useEffect(() => {
    if (state.summary || state.fatalError) {
      const t = setTimeout(onNext, 800);
      return () => clearTimeout(t);
    }
  }, [state.summary, state.fatalError, onNext]);

  const phaseOrder = ['categories', 'tags', 'articles', 'post_tags'];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl surface-raised p-6">
        <div className="flex items-center gap-3">
          {state.executing ? (
            <Loader2 className="h-5 w-5 animate-spin text-[var(--aurora-1)]" />
          ) : (
            <Zap className="h-5 w-5 text-[var(--aurora-1)]" />
          )}
          <h3 className="font-display text-xl text-[var(--text-primary)]">
            {state.fatalError
              ? '出现致命错误'
              : state.summary
                ? '导入完成'
                : `正在执行… (${state.currentPhase || 'start'})`}
          </h3>
        </div>
        {state.fatalError && (
          <div className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {state.fatalError}
          </div>
        )}

        <div className="mt-5 space-y-3">
          {phaseOrder.map((name) => {
            const p = state.phases[name];
            const total = p?.total || 0;
            const done = p?.done || 0;
            const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
            const active = state.currentPhase === name;
            return (
              <div key={name}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span
                    className={`uppercase tracking-wide ${
                      active ? 'text-[var(--aurora-1)]' : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {name}
                  </span>
                  <span className="font-mono tnum text-[var(--text-muted)]">
                    {done}/{total || '?'}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
                  <div
                    className="h-full rounded-full bg-[var(--aurora-1)] transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 滚动日志 */}
      <div className="rounded-2xl surface-leaf p-4">
        <div className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
          最近事件 (保留末尾 80 条)
        </div>
        <div className="max-h-64 overflow-auto rounded-xl bg-[var(--bg-secondary)] p-3 font-mono text-xs">
          {state.recentItems.length === 0 && (
            <div className="text-[var(--text-muted)]">—</div>
          )}
          {state.recentItems.map((it, idx) => (
            <div key={idx} className="flex gap-2 py-0.5">
              <span className="text-[var(--text-muted)]">[{it.kind}]</span>
              <span className="text-[var(--aurora-1)]">{it.action}</span>
              <span className="flex-1 truncate text-[var(--text-primary)]">
                {it.title || it.sourceId}
              </span>
              {it.postId && <span className="text-[var(--text-muted)]">#{it.postId}</span>}
              {it.error && <span className="text-red-300">{it.error}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
