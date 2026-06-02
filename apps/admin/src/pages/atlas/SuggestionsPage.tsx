// Atlas Phase 3 P3-04 — AI 建议卡片页面
//
// 路由: /atlas/suggestions
//
// 红线 C3-1 可见性: 所有 AI 产出在此 inbox 中等待用户处理；接受才入图谱。
// 红线 C3-2: 接受时保留 ai_suggestion_id 指向源——服务端已实现。

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Compass, RefreshCw, Sparkles, X } from 'lucide-react';
import { Select } from '@aetherblog/ui';
import { toast } from 'sonner';

import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { atlasService, type AtlasSuggestion } from '@/services/atlasService';
import { cn, extractApiErrorMessage } from '@/lib/utils';

type StatusFilter = AtlasSuggestion['status'] | 'all';
type KindFilter = AtlasSuggestion['kind'] | 'all';
type AtlasScopeFilter = 'all' | 'mine';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: '全部状态' },
];

const KIND_OPTIONS = [
  { value: 'all', label: '全部种类' },
  { value: 'kp', label: 'KP' },
  { value: 'relation', label: 'Relation' },
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

  return (
    <div className="space-y-4">
      <AdminModuleHeader
        title="AI 建议 Inbox"
        description="Phase 3 · AI 抽取的 KP / 关系候选；任何 AI 产出都必须经此处用户确认后才入图谱（红线 C3-1）"
        icon={Sparkles}
        actions={
          <div className="flex items-center gap-2">
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
        <div className="rounded-2xl border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-leaf)] p-10 text-center text-sm text-[var(--ink-secondary)]">
          没有匹配的建议。Phase 3 后期接入 ai-service 后会有大批量 claim extraction 产出。
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
        <Compass className="mx-auto mb-1 h-4 w-4" />
        Phase 3 · 红线 C3-1: AI 产出永远先入 Inbox，accept 才入图谱
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
          {s.kind}
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
          {s.status}
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
            <p className="text-xs text-[var(--ink-secondary)]">type: {s.proposedKpType}</p>
          )}
          {s.proposedBody && (
            <p className="line-clamp-3 text-xs text-[var(--ink-secondary)]">{s.proposedBody}</p>
          )}
        </div>
      )}

      {s.kind === 'relation' && (
        <div className="space-y-1">
          <p className="font-mono text-[var(--ink-primary)]">
            KP #{s.fromKpId} <span className="text-[var(--aurora-1)]">--[{s.proposedRelationType}]--&gt;</span> KP #{s.toKpId}
          </p>
          {s.proposedStrength != null && (
            <p className="text-xs text-[var(--ink-secondary)]">strength: {s.proposedStrength.toFixed(2)}</p>
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
            → 查看 KP #{s.resolvedKpId}
          </button>
        ) : s.resolvedRelationId ? (
          <span className="text-xs text-[var(--ink-secondary)]">→ 关系 #{s.resolvedRelationId}</span>
        ) : null}
      </footer>
    </li>
  );
}
