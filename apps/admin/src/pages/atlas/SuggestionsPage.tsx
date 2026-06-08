// Atlas Phase 3 P3-04 — AI 建议卡片页面
//
// 路由: /atlas/suggestions
//
// 红线 C3-1 可见性: 所有 AI 产出在此 inbox 中等待用户处理；接受才入图谱。
// 红线 C3-2: 接受时保留 ai_suggestion_id 指向源——服务端已实现。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, CheckCheck, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Select } from '@aetherblog/ui';
import { toast } from 'sonner';

import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { atlasService, type AtlasSuggestion } from '@/services/atlasService';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import {
  kpTypeLabel,
  relationTypeLabel,
  suggestionKindLabel,
  suggestionStatusLabel,
} from './atlasLabels';

type StatusFilter = AtlasSuggestion['status'] | 'all';
type KindFilter = AtlasSuggestion['kind'] | 'all';
type AtlasScopeFilter = 'all' | 'mine';

const STATUS_OPTIONS = [
  { value: 'pending', label: '待处理' },
  { value: 'accepted', label: '已采纳' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'all', label: '全部状态' },
];

const KIND_OPTIONS = [
  { value: 'all', label: '全部种类' },
  { value: 'kp', label: '知识点' },
  { value: 'relation', label: '关系' },
];

const SCOPE_OPTIONS = [
  { value: 'all', label: '全部可访问' },
  { value: 'mine', label: '仅我的' },
];

export default function SuggestionsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AtlasSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [kind, setKind] = useState<KindFilter>('all');
  const [scope, setScope] = useState<AtlasScopeFilter>('all');
  const [batchRunning, setBatchRunning] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await atlasService.listSuggestions({
        status: status === 'all' ? undefined : status,
        kind: kind === 'all' ? undefined : kind,
        scope,
        limit: 200,
      });
      setItems(res.data ?? []);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '加载建议失败'));
    } finally {
      setLoading(false);
    }
  }, [status, kind, scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAccept = useCallback(
    async (s: AtlasSuggestion) => {
      try {
        const res = await atlasService.acceptSuggestion(s.id);
        const out = res.data;
        toast.success(
          out.kind === 'kp'
            ? `已采纳为 KP #${out.resolvedKpId}`
            : `已采纳为关系 #${out.resolvedRelationId}`
        );
        await refresh();
      } catch (err) {
        toast.error(extractApiErrorMessage(err, '采纳失败'));
      }
    },
    [refresh]
  );

  const handleReject = useCallback(
    async (s: AtlasSuggestion) => {
      try {
        await atlasService.rejectSuggestion(s.id);
        toast.success('已拒绝并加入忽略列表');
        await refresh();
      } catch (err) {
        toast.error(extractApiErrorMessage(err, '拒绝失败'));
      }
    },
    [refresh]
  );

  const pendingItems = useMemo(() => items.filter((item) => item.status === 'pending'), [items]);

  // 批量采纳：把逐条点 accept 的苦力活变成一次操作（原本几十次点击才能建一张图）。
  // 顺序执行而非并发——后端 accept 是单事务 KP/Relation 插入，串行可避免互相竞争；
  // 知识点先于关系采纳，确保关系候选引用的 KP 已经落地。
  const handleAcceptAll = useCallback(async () => {
    if (pendingItems.length === 0 || batchRunning) return;
    setBatchRunning(true);
    let ok = 0;
    let fail = 0;
    const ordered = [...pendingItems].sort((a, b) =>
      a.kind === b.kind ? 0 : a.kind === 'kp' ? -1 : 1
    );
    for (const s of ordered) {
      try {
        await atlasService.acceptSuggestion(s.id);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setBatchRunning(false);
    if (fail === 0) {
      toast.success(`已采纳 ${ok} 条建议`);
    } else {
      toast.warning(`已采纳 ${ok} 条，${fail} 条未成功（可能依赖未就绪），保留在收件箱待处理`);
    }
    await refresh();
  }, [pendingItems, batchRunning, refresh]);

  return (
    <div className="space-y-4">
      <AdminModuleHeader
        title="AI 建议"
        description="AI 抽取的知识点 / 关系候选；采纳后才进入你的知识图谱"
        icon={Sparkles}
        showCurrentLabel={false}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleAcceptAll()}
              disabled={pendingItems.length === 0 || batchRunning}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[color-mix(in_oklch,var(--signal-success)_24%,transparent)] px-3 text-xs font-medium text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--signal-success)_36%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {batchRunning ? '采纳中…' : `全部采纳${pendingItems.length ? ` (${pendingItems.length})` : ''}`}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 text-xs hover:bg-[var(--bg-substrate)]"
            >
              <RefreshCw className="h-3 w-3" /> 刷新
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-3 py-2 text-xs">
        <div className="w-36">
          <Select
            value={scope}
            onValueChange={(next) => setScope(next as AtlasScopeFilter)}
            options={SCOPE_OPTIONS}
            size="sm"
            ariaLabel="Atlas 数据范围"
          />
        </div>
        <div className="w-40">
          <Select
            value={status}
            onValueChange={(next) => setStatus(next as StatusFilter)}
            options={STATUS_OPTIONS}
            size="sm"
            ariaLabel="建议状态过滤"
          />
        </div>
        <div className="w-40">
          <Select
            value={kind}
            onValueChange={(next) => setKind(next as KindFilter)}
            options={KIND_OPTIONS}
            size="sm"
            ariaLabel="建议种类过滤"
          />
        </div>
        <span className="ml-auto text-[var(--ink-muted)]">{items.length} 条</span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-32 rounded-2xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_14%,transparent)] bg-[var(--bg-leaf)] p-8 text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--ink-primary)]">
            <Sparkles className="h-5 w-5" />
          </span>
          <h2 className="mt-4 text-base font-semibold text-[var(--ink-primary)]">还没有待处理的建议</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--ink-secondary)]">
            打开一篇读物，在阅读器里点「生成建议」，AI 会把正文里的要点抽成知识点 / 关系候选，汇集到这里等你采纳。
          </p>
          <Link
            to="/atlas/readings"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_32%,transparent)] px-4 text-sm font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)]"
          >
            去读物生成建议
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              onAccept={() => void handleAccept(s)}
              onReject={() => void handleReject(s)}
              onClickKP={(id) => navigate(`/atlas/kp/${id}`)}
            />
          ))}
        </ul>
      )}

      <div className="text-center text-xs text-[var(--ink-muted)]">
        <ShieldCheck className="mx-auto mb-1 h-4 w-4" />
        所有 AI 产出都先进入这里，由你确认后才进入知识图谱。
      </div>
    </div>
  );
}

function SuggestionCard({
  s,
  onAccept,
  onReject,
  onClickKP,
}: {
  s: AtlasSuggestion;
  onAccept: () => void;
  onReject: () => void;
  onClickKP: (id: number) => void;
}) {
  const isPending = s.status === 'pending';
  return (
    <li
      className={cn(
        'rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4 text-sm',
        !isPending && 'opacity-70'
      )}
    >
      <header className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-[color-mix(in_oklch,var(--aurora-3)_22%,transparent)] px-2 py-0.5 font-mono uppercase tracking-[0.16em] text-[var(--ink-primary)]">
          {suggestionKindLabel(s.kind)}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 font-mono uppercase tracking-[0.16em]',
            s.status === 'pending' &&
              'bg-[color-mix(in_oklch,var(--signal-warn)_22%,transparent)] text-[var(--signal-warn)]',
            s.status === 'accepted' &&
              'bg-[color-mix(in_oklch,var(--signal-success)_22%,transparent)] text-[var(--signal-success)]',
            s.status === 'rejected' &&
              'bg-[color-mix(in_oklch,var(--signal-danger)_22%,transparent)] text-[var(--signal-danger)]'
          )}
        >
          {suggestionStatusLabel(s.status)}
        </span>
        {s.modelId && <span className="font-mono text-[10px] text-[var(--ink-muted)]">{s.modelId}</span>}
        {s.proposedConfidence != null && (
          <span className="font-mono text-[10px] text-[var(--ink-muted)]">
            conf {s.proposedConfidence.toFixed(2)}
          </span>
        )}
        {s.costUsd != null && (
          <span className="font-mono text-[10px] text-[var(--ink-muted)]">${s.costUsd.toFixed(4)}</span>
        )}
        <span className="ml-auto font-mono text-[10px] text-[var(--ink-muted)]">
          #{s.id} · {new Date(s.createdAt).toLocaleString('zh-CN')}
        </span>
      </header>

      {s.kind === 'kp' && (
        <div className="space-y-1">
          <p className="font-semibold text-[var(--ink-primary)]">{s.proposedTitle ?? '(无标题)'}</p>
          {s.proposedKpType && (
            <p className="text-xs text-[var(--ink-secondary)]">类型：{kpTypeLabel(s.proposedKpType)}</p>
          )}
          {s.proposedBody && (
            <p className="line-clamp-3 text-xs text-[var(--ink-secondary)]">{s.proposedBody}</p>
          )}
        </div>
      )}

      {s.kind === 'relation' && (
        <div className="space-y-1">
          <p className="font-mono text-[var(--ink-primary)]">
            知识点 #{s.fromKpId}{' '}
            <span className="text-[var(--aurora-1)]">
              —[{s.proposedRelationType ? relationTypeLabel(s.proposedRelationType) : '关系'}]→
            </span>{' '}
            知识点 #{s.toKpId}
          </p>
          {s.proposedStrength != null && (
            <p className="text-xs text-[var(--ink-secondary)]">强度：{s.proposedStrength.toFixed(2)}</p>
          )}
        </div>
      )}

      {s.rationale && (
        <p className="mt-2 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[var(--bg-substrate)] p-2 text-[11px] italic text-[var(--ink-secondary)]">
          AI: {s.rationale}
        </p>
      )}

      <footer className="mt-3 flex items-center gap-2">
        {isPending ? (
          <>
            <button
              type="button"
              onClick={onAccept}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-[color-mix(in_oklch,var(--signal-success)_24%,transparent)] px-3 text-xs font-medium text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--signal-success)_36%,transparent)]"
            >
              <Check className="h-3 w-3" /> 采纳
            </button>
            <button
              type="button"
              onClick={onReject}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 text-xs hover:bg-[var(--bg-substrate)]"
            >
              <X className="h-3 w-3" /> 拒绝
            </button>
          </>
        ) : s.resolvedKpId ? (
          <button
            type="button"
            onClick={() => onClickKP(s.resolvedKpId!)}
            className="text-xs text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:underline"
          >
            → 查看知识点 #{s.resolvedKpId}
          </button>
        ) : s.resolvedRelationId ? (
          <span className="text-xs text-[var(--ink-secondary)]">→ 关系 #{s.resolvedRelationId}</span>
        ) : null}
      </footer>
    </li>
  );
}
