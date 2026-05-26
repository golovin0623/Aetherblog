// Atlas (Aether Knowledge) 入口页 —— Phase 0 占位
//
// 当前阶段只显示模块标题 + 健康自检 + 路线图指引。Phase 1 起会被替换为
// 阅读器（PDF / Markdown）+ 标注侧栏 + 右侧 KP 抽屉。
//
// 路由：/atlas
// 设计文档：docs/plan/task-aether-knowledge-system.md §3 Phase 0 A0-3 验收

import { useEffect, useState } from 'react';
import { Compass, Database, FlaskConical, GitBranch, Loader2, ShieldCheck } from 'lucide-react';

import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { atlasService } from '@/services/atlasService';
import type { AtlasHealthResponse } from '@aetherblog/types';
import { cn, extractApiErrorMessage } from '@/lib/utils';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: AtlasHealthResponse }
  | { kind: 'error'; message: string };

const PHASE_MILESTONES: Array<{
  phase: number;
  title: string;
  outcome: string;
  status: 'in-progress' | 'planned';
}> = [
  { phase: 0, title: '数据骨架与栈决策', outcome: '5 张核心表 + atlas 路由 + 决策记录', status: 'in-progress' },
  { phase: 1, title: '标注层 MVP', outcome: 'PDF / Markdown Carrier + W3C 多选择器 + 鲁棒锚定', status: 'planned' },
  { phase: 2, title: '知识点与有类型关系', outcome: '一阶 KP + 9 种 typed relation + 图谱视图 v1', status: 'planned' },
  { phase: 3, title: 'AI 辅助建图', outcome: '复用 kb_indexer / kb_recall + AI 建议卡片', status: 'planned' },
  { phase: 4, title: '多模态扩展', outcome: '视频 / 音频 / 网页 / 图像 + transcript-as-primary', status: 'planned' },
  { phase: 5, title: '发现与激活', outcome: 'FSRS 复习 + 上下文推荐 + 主动关联', status: 'planned' },
];

export default function AtlasPage() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await atlasService.health();
        if (cancelled) return;
        setState({ kind: 'ok', data: res.data });
      } catch (err) {
        if (cancelled) return;
        setState({ kind: 'error', message: extractApiErrorMessage(err, 'Atlas 健康自检失败') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <AdminModuleHeader
        title="Aether Knowledge"
        description="多模态个人知识图集 · Atlas — 输入流（载体 / 标注 / 知识点 / 有类型关系）"
        icon={Compass}
        currentLabel="Phase 0 · 数据骨架"
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <HealthCard state={state} />
        <InfoCard
          icon={Database}
          title="Schema 基线"
          lines={[
            'migration 000062 — atlas_core',
            'migration 000063 — atlas_permissions',
            '5 张核心表 + 11 索引 + 3 权限码',
          ]}
        />
        <InfoCard
          icon={ShieldCheck}
          title="权限"
          lines={[
            'content.atlas.read · content.atlas.write · content.atlas.admin',
            'Phase 0 仅绑定 ADMIN 角色',
          ]}
        />
      </section>

      <section className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-5 shadow-sm">
        <header className="mb-4 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--ink-primary)]">
            <GitBranch className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-[var(--ink-primary)]">5 阶段路线图</h2>
            <p className="text-xs text-[var(--ink-secondary)]">
              落地手册：<code className="font-mono">docs/plan/task-aether-knowledge-system.md</code> ·
              任务命名前缀 <code className="font-mono">task-knowledge-*</code>
            </p>
          </div>
        </header>
        <ol className="space-y-2">
          {PHASE_MILESTONES.map((item) => (
            <li
              key={item.phase}
              className={cn(
                'flex items-start gap-3 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[var(--bg-substrate)] p-3 text-sm',
                item.status === 'in-progress' && 'ring-1 ring-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs',
                  item.status === 'in-progress'
                    ? 'bg-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] text-[var(--ink-primary)]'
                    : 'bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] text-[var(--ink-secondary)]'
                )}
              >
                P{item.phase}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[var(--ink-primary)]">{item.title}</p>
                <p className="text-xs text-[var(--ink-secondary)]">{item.outcome}</p>
              </div>
              <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-secondary)]">
                {item.status === 'in-progress' ? '进行中' : '规划'}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-substrate)] p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--signal-info)_18%,transparent)] text-[var(--ink-primary)]">
            <FlaskConical className="h-4 w-4" />
          </span>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[var(--ink-primary)]">Phase 0 占位</h3>
            <p className="text-xs leading-relaxed text-[var(--ink-secondary)]">
              此页是 Phase 0 的占位入口。当前阶段 schema 与权限已就绪，
              但阅读视图、标注、知识点和图谱视图都在 Phase 1+ 实现，
              <strong> 严禁在此页提交真实用户操作。 </strong>
              对应红线见落地手册 §0.2 R5（现状破坏）。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function HealthCard({ state }: { state: HealthState }) {
  const baseClass =
    'rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-5 shadow-sm';

  if (state.kind === 'loading') {
    return (
      <article className={baseClass}>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-secondary)]">健康自检</p>
        <div className="mt-3 flex items-center gap-2 text-sm text-[var(--ink-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" /> 探测 /api/v1/admin/atlas/health …
        </div>
      </article>
    );
  }

  if (state.kind === 'error') {
    return (
      <article className={cn(baseClass, 'border-[color-mix(in_oklch,var(--signal-danger)_25%,transparent)]')}>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--signal-danger)]">健康自检失败</p>
        <p className="mt-3 text-sm text-[var(--ink-primary)]">{state.message}</p>
        <p className="mt-2 text-xs text-[var(--ink-secondary)]">
          常见原因：migrations 000062/000063 未执行，或 server-go 尚未重启。
        </p>
      </article>
    );
  }

  return (
    <article className={baseClass}>
      <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-secondary)]">健康自检</p>
      <div className="mt-3 flex items-center gap-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-[var(--signal-success)]" />
        <span className="text-sm font-semibold text-[var(--ink-primary)]">就绪 · phase {state.data.phase}</span>
      </div>
      <p className="mt-2 text-xs text-[var(--ink-secondary)]">
        module = <code className="font-mono">{state.data.module}</code>
      </p>
    </article>
  );
}

function InfoCard({
  icon: Icon,
  title,
  lines,
}: {
  icon: typeof Database;
  title: string;
  lines: string[];
}) {
  return (
    <article className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-5 shadow-sm">
      <header className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--ink-secondary)]">
        <Icon className="h-4 w-4" /> {title}
      </header>
      <ul className="mt-3 space-y-1.5 text-sm text-[var(--ink-primary)]">
        {lines.map((line) => (
          <li key={line} className="font-mono text-xs leading-relaxed text-[var(--ink-secondary)]">
            {line}
          </li>
        ))}
      </ul>
    </article>
  );
}
