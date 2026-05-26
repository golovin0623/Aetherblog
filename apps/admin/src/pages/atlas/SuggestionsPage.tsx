// Atlas Phase 3 P3-04 — AI 建议卡片页面
//
// 路由: /atlas/suggestions
//
// 红线 C3-1 可见性: 所有 AI 产出在此 inbox 中等待用户处理；接受才入图谱。
// 红线 C3-2: 接受时保留 ai_suggestion_id 指向源——服务端已实现。

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Check, Compass, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { atlasService, type AtlasSuggestion } from '@/services/atlasService';
import { cn, extractApiErrorMessage } from '@/lib/utils';

type StatusFilter = AtlasSuggestion['status'] | 'all';
type KindFilter = AtlasSuggestion['kind'] | 'all';

export default function SuggestionsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AtlasSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [kind, setKind] = useState<KindFilter>('all');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await atlasService.listSuggestions({
        status: status === 'all' ? undefined : status,
        kind: kind === 'all' ? undefined : kind,
        limit: 200,
      });
      setItems(res.data ?? []);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '加载建议失败'));
    } finally {
      setLoading(false);
    }
  }, [status, kind]);

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

  // P3-DEMO: 一键创建一条样例建议（无 LLM；用于验证 accept/reject UX）
  //
  // PR #724 review fix (Codex P2): 过去硬编码 carrierId=1，但 atlas_ai_suggestions.carrier_id
  // 有 FK 到 atlas_carriers(id)。新数据库 / 重建 schema 后 carrier #1 不一定存在，
  // demo 按钮总是 FK 失败。schema 允许 carrier_id 为 NULL（CHECK 只要 kind=kp 时
  // proposed_title 非空），因此 demo 创建时**不绑定 carrier_id** 即可。
  const handleDemoCreate = useCallback(async () => {
    try {
      const res = await atlasService.createSuggestion({
        kind: 'kp',
        // carrierId 故意不传：demo 数据不与具体载体挂钩
        proposedTitle: `Demo 建议 ${new Date().toLocaleTimeString('zh-CN')}`,
        proposedBody: '这是一条来自 P3-DEMO 的样例 KP 建议（未经过 LLM）。Phase 3 后期接入 ai-service 后此入口将被替换为真正的 claim extraction。',
        proposedKpType: 'concept',
        proposedConfidence: 0.6,
        rationale: 'P3-DEMO：手动创建用于验证 accept/reject 链路',
        modelId: 'demo/fake',
      });
      toast.success(`已创建样例建议 #${res.data.id}`);
      await refresh();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '创建样例失败'));
    }
  }, [refresh]);

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
              onClick={() => void handleDemoCreate()}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] px-3 text-xs text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]"
              title="不调用 LLM，仅写入一条 demo 建议用于验证链路"
            >
              <Brain className="h-3 w-3" /> P3-DEMO 创建样例
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
        <label className="inline-flex items-center gap-1">
          状态:
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="h-7 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] px-1.5"
          >
            <option value="pending">pending</option>
            <option value="accepted">accepted</option>
            <option value="rejected">rejected</option>
            <option value="all">all</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1">
          种类:
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as KindFilter)}
            className="h-7 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] px-1.5"
          >
            <option value="all">all</option>
            <option value="kp">kp</option>
            <option value="relation">relation</option>
          </select>
        </label>
        <span className="ml-auto text-[var(--ink-muted)]">{items.length} 条</span>
      </div>

      {loading ? (
        <div className="flex h-60 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--ink-muted)]" />
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
