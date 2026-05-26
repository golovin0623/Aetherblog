// Atlas Phase 2 P2-06 — KP 详情页 + 双向投影
//
// 路由: /atlas/kp/:id
//
// 展示:
//   * KP 元信息（title / type / status / confidence / provenance）
//   * Body markdown 渲染
//   * 出处证据：evidence annotations（with carrier 链接）
//   * 关系列表：出入关系（按 type 着色）+ 添加关系 form
//   * 编辑 / 归档 / 删除按钮

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MarkdownPreview } from '@aetherblog/editor';
import {
  ArrowLeft,
  Brain,
  Compass,
  GitBranch,
  Highlighter,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import type {
  AtlasAnnotation,
  AtlasCarrier,
  AtlasKnowledgePoint,
  AtlasRelationType,
  AtlasTypedRelation,
} from '@aetherblog/types';
import { ATLAS_RELATION_TYPES } from '@aetherblog/types';

import { atlasService } from '@/services/atlasService';
import { cn, extractApiErrorMessage } from '@/lib/utils';

interface EvidenceRow {
  annotationId: number;
  role: string;
  annotation?: AtlasAnnotation;
}

export default function KnowledgePointPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const kpId = id ? Number(id) : 0;

  const [kp, setKp] = useState<AtlasKnowledgePoint | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [relations, setRelations] = useState<AtlasTypedRelation[]>([]);
  const [otherKPs, setOtherKPs] = useState<AtlasKnowledgePoint[]>([]);
  // PR #724 review fix (Codex P1 #3): 缓存 evidence 涉及的 carrier，用于把 carrierId
  // 解析回 noteId（reader 路由 /atlas/reader/note/:noteId 期望的是 noteId）。
  const [carrierMap, setCarrierMap] = useState<Map<number, AtlasCarrier>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newRel, setNewRel] = useState<{ type: AtlasRelationType; toKpId: number | null }>(
    { type: 'cites', toKpId: null }
  );

  const refresh = useCallback(async () => {
    if (!kpId) return;
    setLoading(true);
    try {
      const [kpRes, evRes, relRes, allKpsRes] = await Promise.all([
        atlasService.getKnowledgePoint(kpId),
        atlasService.listEvidence(kpId),
        atlasService.listKPRelations(kpId, 'all'),
        atlasService.listKnowledgePoints({ limit: 100 }),
      ]);
      setKp(kpRes.data);
      const evRows: EvidenceRow[] = (evRes.data ?? []).map((e) => ({
        annotationId: e.annotationId,
        role: e.role,
      }));
      // 拉每条 evidence 的标注内容
      const annoMap = new Map<number, AtlasAnnotation>();
      await Promise.all(
        evRows.map(async (e) => {
          try {
            const a = await atlasService.getAnnotation(e.annotationId);
            annoMap.set(e.annotationId, a.data);
          } catch {
            /* 标注可能已被删 */
          }
        })
      );
      const enrichedEvidence = evRows.map((e) => ({ ...e, annotation: annoMap.get(e.annotationId) }));
      setEvidence(enrichedEvidence);

      // PR #724 review fix (Codex P1 #3): 预拉 evidence 涉及的 carrier，便于把 carrierId
      // 映射成 noteId（reader 路由用 noteId 而非 carrierId）。
      const uniqueCarrierIds = Array.from(
        new Set(enrichedEvidence.map((e) => e.annotation?.carrierId).filter((x): x is number => !!x))
      );
      const carriers = new Map<number, AtlasCarrier>();
      await Promise.all(
        uniqueCarrierIds.map(async (cid) => {
          try {
            const c = await atlasService.getCarrier(cid);
            carriers.set(cid, c.data);
          } catch {
            /* carrier 已删或权限不足 */
          }
        })
      );
      setCarrierMap(carriers);

      setRelations(relRes.data ?? []);
      setOtherKPs((allKpsRes.data ?? []).filter((x) => x.id !== kpId));
      setError(null);
    } catch (err) {
      setError(extractApiErrorMessage(err, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [kpId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAddRelation = useCallback(async () => {
    if (!kpId || !newRel.toKpId) {
      toast.message('请选择目标知识点');
      return;
    }
    try {
      await atlasService.createRelation({
        fromKpId: kpId,
        toKpId: newRel.toKpId,
        type: newRel.type,
        strength: 0.8,
      });
      toast.success(`已建立 ${newRel.type} 关系`);
      setNewRel({ type: 'cites', toKpId: null });
      await refresh();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '建立关系失败'));
    }
  }, [kpId, newRel, refresh]);

  const handleDeleteRelation = useCallback(
    async (relId: number) => {
      try {
        await atlasService.deleteRelation(relId);
        toast.success('关系已删除');
        setRelations((rs) => rs.filter((r) => r.id !== relId));
      } catch (err) {
        toast.error(extractApiErrorMessage(err, '删除失败'));
      }
    },
    []
  );

  const kpMap = useMemo(() => {
    const m = new Map<number, AtlasKnowledgePoint>();
    otherKPs.forEach((k) => m.set(k.id, k));
    if (kp) m.set(kp.id, kp);
    return m;
  }, [kp, otherKPs]);

  // PR #724 review fix (Codex P2 #4): 错误分支必须在 (!kp) 之前判断，
  // 否则 fetch 失败后 loading=false + kp=null 会被 spinner 永远捕获，error 分支永不可达。
  if (error) {
    return (
      <div className="p-6">
        <button
          type="button"
          onClick={() => navigate('/atlas')}
          className="mb-4 inline-flex items-center gap-2 text-sm text-[var(--ink-secondary)]"
        >
          <ArrowLeft className="h-4 w-4" /> 返回 Atlas
        </button>
        <div className="rounded-xl border border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] p-4 text-sm text-[var(--ink-primary)]">{error}</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--ink-muted)]" />
      </div>
    );
  }

  if (!kp) {
    return (
      <div className="p-6 text-sm text-[var(--ink-secondary)]">
        知识点不存在或已被删除（KP #{kpId}）。
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate('/atlas')}
            className="mb-2 inline-flex items-center gap-2 text-xs text-[var(--ink-secondary)]"
          >
            <ArrowLeft className="h-3 w-3" /> 返回 Atlas
          </button>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            <Brain className="h-3 w-3" /> 知识点 · uuid {kp.uuid.slice(0, 8)}…
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--ink-primary)]">{kp.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-secondary)]">
            <Pill>{kp.type}</Pill>
            <Pill>{kp.status}</Pill>
            <Pill className="font-mono">conf {kp.confidence.toFixed(2)}</Pill>
            <Pill>{kp.provenance}</Pill>
            {kp.archived && <Pill className="bg-[color-mix(in_oklch,var(--signal-warn)_18%,transparent)]">已归档</Pill>}
          </div>
        </div>
      </header>

      {kp.bodyMarkdown && (
        <section className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
          <MarkdownPreview content={kp.bodyMarkdown} />
        </section>
      )}

      <section className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
        <header className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ink-primary)]">
          <Highlighter className="h-4 w-4" /> 出处证据
          <span className="text-xs font-normal text-[var(--ink-muted)]">{evidence.length}</span>
        </header>
        {evidence.length === 0 ? (
          <p className="text-xs text-[var(--ink-secondary)]">尚无证据标注。可在 Reader 里选中文本并通过 P2-02 "提炼 KP" 关联。</p>
        ) : (
          <ul className="space-y-2">
            {evidence.map((e) => {
              const a = e.annotation;
              const quote = a?.selectors.find((s) => s.type === 'TextQuoteSelector') as
                | import('@aetherblog/types').TextQuoteSelector
                | undefined;
              return (
                <li
                  key={e.annotationId}
                  className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[var(--bg-substrate)] p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[10px] text-[var(--ink-muted)]">
                      annotation #{e.annotationId} · role={e.role}
                    </span>
                    {a && <Pill>{a.anchorState}</Pill>}
                  </div>
                  {quote && (
                    <p className="mt-1.5 line-clamp-3 text-[var(--ink-primary)]">
                      <span className="text-[var(--ink-muted)]">「</span>
                      {quote.exact}
                      <span className="text-[var(--ink-muted)]">」</span>
                    </p>
                  )}
                  {a && (() => {
                    // PR #724 review fix (Codex P1 #3): 解析 carrier.source_uri='notes://N' 得到 noteId。
                    // reader 路由 /atlas/reader/note/:noteId 用的是 noteId 而非 carrierId。
                    // 非 markdown 类型 / 无法解析时隐藏跳转按钮。
                    const carrier = carrierMap.get(a.carrierId);
                    if (!carrier || carrier.type !== 'markdown') return null;
                    const match = /^notes:\/\/(\d+)$/.exec(carrier.sourceUri);
                    if (!match) return null;
                    const noteId = match[1];
                    return (
                      <button
                        type="button"
                        onClick={() => navigate(`/atlas/reader/note/${noteId}`)}
                        className="mt-2 text-[10px] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                      >
                        在阅读器中查看 →
                      </button>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
        <header className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ink-primary)]">
          <GitBranch className="h-4 w-4" /> 关系
          <span className="text-xs font-normal text-[var(--ink-muted)]">{relations.length}</span>
        </header>

        {relations.length === 0 ? (
          <p className="text-xs text-[var(--ink-secondary)]">尚未与其它知识点建立 typed relation。</p>
        ) : (
          <ul className="space-y-2">
            {relations.map((r) => {
              const isOut = r.fromKpId === kp.id;
              const otherId = isOut ? r.toKpId : r.fromKpId;
              const other = kpMap.get(otherId);
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[var(--bg-substrate)] p-2.5 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]',
                        relationColorClass(r.type)
                      )}
                    >
                      {isOut ? '→' : '←'} {r.type}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate(`/atlas/kp/${otherId}`)}
                      className="truncate text-[var(--ink-primary)] hover:underline"
                    >
                      {other?.title ?? `KP #${otherId}`}
                    </button>
                    <span className="text-[10px] text-[var(--ink-muted)]">strength={r.strength.toFixed(2)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeleteRelation(r.id)}
                    aria-label="删除关系"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] hover:text-[var(--signal-danger)]"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleAddRelation();
          }}
          className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2"
        >
          <select
            value={newRel.type}
            onChange={(e) => setNewRel((s) => ({ ...s, type: e.target.value as AtlasRelationType }))}
            className="h-9 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] px-2 text-xs"
          >
            {ATLAS_RELATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={newRel.toKpId ?? ''}
            onChange={(e) => setNewRel((s) => ({ ...s, toKpId: e.target.value ? Number(e.target.value) : null }))}
            className="h-9 truncate rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] px-2 text-xs"
          >
            <option value="">选择目标知识点</option>
            {otherKPs.map((k) => (
              <option key={k.id} value={k.id}>
                #{k.id} · {k.title}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="inline-flex h-9 items-center gap-1 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] px-3 text-xs text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_38%,transparent)]"
          >
            <Plus className="h-3 w-3" /> 建立
          </button>
        </form>
      </section>

      <div className="text-center text-xs text-[var(--ink-muted)]">
        <Compass className="mx-auto mb-1 h-4 w-4" />
        Atlas Phase 2 · 知识点详情 · 出处与关系一阶可见
      </div>
    </div>
  );
}

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-2 py-0.5', className)}>{children}</span>
  );
}

function relationColorClass(t: AtlasRelationType): string {
  switch (t) {
    case 'supports':
      return 'bg-[color-mix(in_oklch,var(--signal-success)_20%,transparent)] text-[var(--signal-success)]';
    case 'refutes':
      return 'bg-[color-mix(in_oklch,var(--signal-danger)_20%,transparent)] text-[var(--signal-danger)]';
    case 'specializes':
    case 'instance_of':
      return 'bg-[color-mix(in_oklch,var(--aurora-2)_22%,transparent)] text-[var(--ink-primary)]';
    case 'generalizes':
      return 'bg-[color-mix(in_oklch,var(--aurora-3)_22%,transparent)] text-[var(--ink-primary)]';
    case 'precedes':
    case 'causes':
      return 'bg-[color-mix(in_oklch,var(--signal-warn)_22%,transparent)] text-[var(--signal-warn)]';
    case 'similar_to':
      return 'bg-[color-mix(in_oklch,var(--aurora-4)_22%,transparent)] text-[var(--ink-primary)]';
    case 'cites':
    default:
      return 'bg-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] text-[var(--ink-primary)]';
  }
}
