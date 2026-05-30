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
  Archive,
  Brain,
  Compass,
  FilePenLine,
  GitBranch,
  Highlighter,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { ConfirmModal, Modal, Select } from '@aetherblog/ui';
import { toast } from 'sonner';

import type {
  AtlasAnnotation,
  AtlasCarrier,
  AtlasKnowledgePoint,
  AtlasKnowledgePointStatus,
  AtlasKnowledgePointType,
  AtlasRelationType,
  AtlasTypedRelation,
  TextQuoteSelector,
} from '@aetherblog/types';
import { ATLAS_RELATION_TYPES } from '@aetherblog/types';

import { atlasService } from '@/services/atlasService';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, extractApiErrorMessage } from '@/lib/utils';

interface EvidenceRow {
  annotationId: number;
  role: string;
  annotation?: AtlasAnnotation;
}

type EvidenceRole = 'evidence' | 'definition' | 'example' | 'counter';

interface RelationEvidenceRow {
  annotationId: number;
  createdAt: string;
  annotation?: AtlasAnnotation;
}

interface KPEditDraft {
  title: string;
  bodyMarkdown: string;
  type: AtlasKnowledgePointType;
  status: AtlasKnowledgePointStatus;
  confidence: number;
  saving: boolean;
}

interface RelationDraft {
  type: AtlasRelationType;
  toKpId: number | null;
  strength: number;
  bodyMarkdown: string;
  evidenceAnnotationId: number | null;
}

interface LocalGraphState {
  nodes: AtlasKnowledgePoint[];
  edges: AtlasTypedRelation[];
  loading: boolean;
  error: string | null;
}

const RELATION_OPTIONS = ATLAS_RELATION_TYPES.map((type) => ({ value: type, label: type }));
const LOCAL_GRAPH_DEPTH_OPTIONS = [
  { value: '1', label: 'Depth 1', description: '只看直接相邻 KP' },
  { value: '2', label: 'Depth 2', description: '扩展到相邻节点的上下游' },
  { value: '3', label: 'Depth 3', description: '用于主题链路粗查' },
];

const KP_TYPE_OPTIONS: Array<{ value: AtlasKnowledgePointType; label: string; description: string }> = [
  { value: 'claim', label: '主张', description: '可被证据支持或反驳的判断' },
  { value: 'concept', label: '概念', description: '稳定术语、主题或对象' },
  { value: 'question', label: '问题', description: '尚未回答或需要继续探索' },
  { value: 'definition', label: '定义', description: '对术语边界的解释' },
  { value: 'method', label: '方法', description: '可复用的流程或技术' },
  { value: 'example', label: '例子', description: '支撑理解的实例' },
  { value: 'person', label: '人物', description: '作者、研究者或相关人物' },
  { value: 'source', label: '来源', description: '可被引用的材料来源' },
];

const KP_STATUS_OPTIONS: Array<{ value: AtlasKnowledgePointStatus; label: string; description: string }> = [
  { value: 'seed', label: 'Seed', description: '刚提炼的种子知识点' },
  { value: 'growing', label: 'Growing', description: '仍在补证据和关系' },
  { value: 'evergreen', label: 'Evergreen', description: '相对稳定、可长期复用' },
  { value: 'archived', label: 'Archived', description: '不参与主图谱' },
];

const RELATION_HINTS: Record<AtlasRelationType, string> = {
  supports: 'A 支持 B，可用于论证链。',
  refutes: 'A 反驳 B，用于记录冲突证据。',
  specializes: 'A 是 B 的更具体版本。',
  generalizes: 'A 是 B 的上位概括。',
  precedes: 'A 在时间或步骤上先于 B。',
  causes: 'A 导致或推动 B。',
  similar_to: 'A 与 B 相似，但不等价。',
  cites: 'A 引用 B 或以 B 为来源。',
  instance_of: 'A 是 B 的一个实例。',
};

const emptyRelationDraft = (): RelationDraft => ({
  type: 'cites',
  toKpId: null,
  strength: 0.8,
  bodyMarkdown: '',
  evidenceAnnotationId: null,
});

export default function KnowledgePointPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const kpId = id ? Number(id) : 0;

  const [kp, setKp] = useState<AtlasKnowledgePoint | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [relations, setRelations] = useState<AtlasTypedRelation[]>([]);
  const [otherKPs, setOtherKPs] = useState<AtlasKnowledgePoint[]>([]);
  const [relationEvidence, setRelationEvidence] = useState<Map<number, RelationEvidenceRow[]>>(new Map());
  // PR #724 review fix (Codex P1 #3): 缓存 evidence 涉及的 carrier，用于把 carrierId
  // 解析回 noteId（reader 路由 /atlas/reader/note/:noteId 期望的是 noteId）。
  const [carrierMap, setCarrierMap] = useState<Map<number, AtlasCarrier>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newRel, setNewRel] = useState<RelationDraft>(() => emptyRelationDraft());
  const [editDraft, setEditDraft] = useState<KPEditDraft | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [generatingRelation, setGeneratingRelation] = useState(false);
  const [localGraphDepth, setLocalGraphDepth] = useState('1');
  const [localGraph, setLocalGraph] = useState<LocalGraphState>({
    nodes: [],
    edges: [],
    loading: false,
    error: null,
  });

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

      const relationList = relRes.data ?? [];
      const relationEvidenceRows = new Map<number, RelationEvidenceRow[]>();
      const relationAnnotationIDs = new Set<number>();
      await Promise.all(
        relationList.map(async (relation) => {
          try {
            const relEvidence = await atlasService.listRelationEvidence(relation.id);
            const rows: RelationEvidenceRow[] = (relEvidence.data ?? []).map((item) => ({
              annotationId: item.annotationId,
              createdAt: item.createdAt,
            }));
            rows.forEach((row) => relationAnnotationIDs.add(row.annotationId));
            relationEvidenceRows.set(relation.id, rows);
          } catch {
            relationEvidenceRows.set(relation.id, []);
          }
        })
      );
      await Promise.all(
        Array.from(relationAnnotationIDs).map(async (annotationID) => {
          if (annoMap.has(annotationID)) return;
          try {
            const a = await atlasService.getAnnotation(annotationID);
            annoMap.set(annotationID, a.data);
          } catch {
            /* relation evidence 可能已被删 */
          }
        })
      );
      relationEvidenceRows.forEach((rows, relationID) => {
        relationEvidenceRows.set(
          relationID,
          rows.map((row) => ({ ...row, annotation: annoMap.get(row.annotationId) }))
        );
      });
      setRelationEvidence(relationEvidenceRows);

      // PR #724 review fix (Codex P1 #3): 预拉 evidence 涉及的 carrier，便于把 carrierId
      // 映射成 noteId（reader 路由用 noteId 而非 carrierId）。
      const uniqueCarrierIds = Array.from(
        new Set(
          [
            ...enrichedEvidence.map((e) => e.annotation?.carrierId),
            ...Array.from(annoMap.values()).map((annotation) => annotation.carrierId),
          ].filter((x): x is number => !!x)
        )
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

      setRelations(relationList);
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

  useEffect(() => {
    if (!kp) return;
    let cancelled = false;
    const depth = Math.max(1, Math.min(3, Number(localGraphDepth) || 1));
    void (async () => {
      setLocalGraph((state) => ({ ...state, loading: true, error: null }));
      try {
        const nodeMap = new Map<number, AtlasKnowledgePoint>([[kp.id, kp]]);
        const edgeMap = new Map<number, AtlasTypedRelation>();
        let frontier = new Set<number>([kp.id]);
        const visited = new Set<number>();

        for (let level = 0; level < depth && frontier.size > 0; level += 1) {
          const current = Array.from(frontier).filter((nodeID) => !visited.has(nodeID));
          current.forEach((nodeID) => visited.add(nodeID));
          const next = new Set<number>();

          await Promise.all(
            current.map(async (nodeID) => {
              try {
                const relRes = await atlasService.listKPRelations(nodeID, 'all');
                (relRes.data ?? []).forEach((relation) => {
                  edgeMap.set(relation.id, relation);
                  const neighborID = relation.fromKpId === nodeID ? relation.toKpId : relation.fromKpId;
                  if (!visited.has(neighborID)) next.add(neighborID);
                });
              } catch {
                /* 单个节点关系读取失败不阻断局部图 */
              }
            })
          );

          const missingNodeIDs = Array.from(next).filter((nodeID) => !nodeMap.has(nodeID));
          await Promise.all(
            missingNodeIDs.map(async (nodeID) => {
              const known = otherKPs.find((item) => item.id === nodeID);
              if (known) {
                nodeMap.set(nodeID, known);
                return;
              }
              try {
                const nodeRes = await atlasService.getKnowledgePoint(nodeID);
                nodeMap.set(nodeID, nodeRes.data);
              } catch {
                /* 权限或删除导致不可读时跳过该节点 */
              }
            })
          );

          frontier = new Set(Array.from(next).filter((nodeID) => nodeMap.has(nodeID)));
        }

        if (cancelled) return;
        setLocalGraph({
          nodes: Array.from(nodeMap.values()),
          edges: Array.from(edgeMap.values()).filter(
            (edge) => nodeMap.has(edge.fromKpId) && nodeMap.has(edge.toKpId)
          ),
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setLocalGraph({
          nodes: [kp],
          edges: [],
          loading: false,
          error: extractApiErrorMessage(err, '局部图加载失败'),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kp, localGraphDepth, otherKPs]);

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
        strength: newRel.strength,
        bodyMarkdown: newRel.bodyMarkdown.trim() || undefined,
        evidenceAnnotationIds: newRel.evidenceAnnotationId ? [newRel.evidenceAnnotationId] : undefined,
      });
      toast.success(`已建立 ${newRel.type} 关系`);
      setNewRel(emptyRelationDraft());
      await refresh();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '建立关系失败'));
    }
  }, [kpId, newRel, refresh]);

  const handleGenerateRelationSuggestion = useCallback(async () => {
    if (!kpId || !newRel.toKpId) {
      toast.message('请选择目标知识点');
      return;
    }
    setGeneratingRelation(true);
    try {
      const res = await atlasService.generateRelationSuggestion(kpId, { toKpId: newRel.toKpId });
      toast.success(`已生成关系建议 #${res.data.id}，前往 Inbox 采纳`);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '生成关系建议失败'));
    } finally {
      setGeneratingRelation(false);
    }
  }, [kpId, newRel.toKpId]);

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

  const openEditModal = useCallback(() => {
    if (!kp) return;
    setEditDraft({
      title: kp.title,
      bodyMarkdown: kp.bodyMarkdown ?? '',
      type: kp.type,
      status: kp.status,
      confidence: kp.confidence,
      saving: false,
    });
  }, [kp]);

  const handleSaveKP = useCallback(async () => {
    if (!kp || !editDraft) return;
    const title = editDraft.title.trim();
    if (!title) {
      toast.error('标题不能为空');
      return;
    }
    if (editDraft.confidence < 0 || editDraft.confidence > 1) {
      toast.error('Confidence 必须在 0 到 1 之间');
      return;
    }
    setEditDraft((draft) => (draft ? { ...draft, saving: true } : draft));
    try {
      const res = await atlasService.updateKnowledgePoint(kp.id, {
        title,
        bodyMarkdown: editDraft.bodyMarkdown,
        type: editDraft.type,
        status: editDraft.status,
        confidence: editDraft.confidence,
        archived: editDraft.status === 'archived' ? true : kp.archived,
      });
      setKp(res.data);
      setEditDraft(null);
      toast.success('知识点已更新');
    } catch (err) {
      setEditDraft((draft) => (draft ? { ...draft, saving: false } : draft));
      toast.error(extractApiErrorMessage(err, '更新失败'));
    }
  }, [editDraft, kp]);

  const handleArchiveToggle = useCallback(async () => {
    if (!kp) return;
    setMutating(true);
    const nextArchived = !kp.archived;
    try {
      const res = await atlasService.updateKnowledgePoint(kp.id, {
        archived: nextArchived,
        status: nextArchived ? 'archived' : kp.status === 'archived' ? 'growing' : kp.status,
      });
      setKp(res.data);
      toast.success(nextArchived ? '知识点已归档' : '知识点已恢复');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, nextArchived ? '归档失败' : '恢复失败'));
    } finally {
      setMutating(false);
    }
  }, [kp]);

  const handleDeleteKP = useCallback(async () => {
    if (!kp) return;
    setMutating(true);
    try {
      await atlasService.deleteKnowledgePoint(kp.id);
      toast.success('知识点已删除');
      navigate('/atlas/kps');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '删除失败'));
      setMutating(false);
      setDeleteOpen(false);
    }
  }, [kp, navigate]);

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
      <div className="space-y-4 p-6">
        <Skeleton className="h-28 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
        <Skeleton className="h-40 rounded-2xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
        <Skeleton className="h-56 rounded-2xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
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
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={openEditModal}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-3 text-xs text-[var(--ink-primary)] hover:bg-[var(--bg-leaf)]"
          >
            <FilePenLine className="h-3.5 w-3.5" /> 编辑
          </button>
          <button
            type="button"
            disabled={mutating}
            onClick={() => void handleArchiveToggle()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-3 text-xs text-[var(--ink-primary)] hover:bg-[var(--bg-leaf)] disabled:opacity-60"
          >
            {kp.archived ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            {kp.archived ? '恢复' : '归档'}
          </button>
          <button
            type="button"
            disabled={mutating}
            onClick={() => setDeleteOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[color-mix(in_oklch,var(--signal-danger)_28%,transparent)] px-3 text-xs text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" /> 删除
          </button>
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
              const relEvidence = relationEvidence.get(r.id) ?? [];
              return (
                <li
                  key={r.id}
                  className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[var(--bg-substrate)] p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
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
                      {relEvidence.length > 0 && (
                        <span className="rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] px-2 py-0.5 text-[10px] text-[var(--ink-secondary)]">
                          evidence {relEvidence.length}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteRelation(r.id)}
                      aria-label="删除关系"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] hover:text-[var(--signal-danger)]"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {r.bodyMarkdown && (
                    <p className="mt-2 line-clamp-2 text-[var(--ink-secondary)]">{r.bodyMarkdown}</p>
                  )}
                  {relEvidence.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {relEvidence.slice(0, 2).map((row) => {
                        const quote = row.annotation?.selectors.find((s) => s.type === 'TextQuoteSelector') as
                          | TextQuoteSelector
                          | undefined;
                        return (
                          <div
                            key={row.annotationId}
                            className="rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[var(--bg-leaf)] px-2 py-1.5 text-[10px] text-[var(--ink-secondary)]"
                          >
                            <span className="font-mono text-[var(--ink-muted)]">annotation #{row.annotationId}</span>
                            {quote?.exact && (
                              <p className="mt-1 line-clamp-2 text-[var(--ink-primary)]">「{quote.exact}」</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
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
          className="mt-3 grid gap-2 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[var(--bg-substrate)] p-3"
        >
          <div className="grid gap-2 md:grid-cols-[190px_minmax(0,1fr)_220px_auto_auto]">
            <Select
              value={newRel.type}
              onValueChange={(next) => setNewRel((s) => ({ ...s, type: next as AtlasRelationType }))}
              options={RELATION_OPTIONS.map((option) => ({
                ...option,
                description: RELATION_HINTS[option.value as AtlasRelationType],
              }))}
              size="sm"
              ariaLabel="关系类型"
            />
            <Select
              value={newRel.toKpId ? String(newRel.toKpId) : ''}
              onValueChange={(next) => setNewRel((s) => ({ ...s, toKpId: next ? Number(next) : null }))}
              options={otherKPs.map((k) => ({ value: String(k.id), label: `#${k.id} · ${k.title}` }))}
              placeholder="选择目标知识点"
              size="sm"
              ariaLabel="目标知识点"
            />
            <Select
              value={newRel.evidenceAnnotationId ? String(newRel.evidenceAnnotationId) : ''}
              onValueChange={(next) => setNewRel((s) => ({ ...s, evidenceAnnotationId: next ? Number(next) : null }))}
              options={evidence.map((item) => ({
                value: String(item.annotationId),
                label: `annotation #${item.annotationId}`,
                description: item.role,
              }))}
              placeholder="选择 evidence"
              disabled={evidence.length === 0}
              disabledHint="无 KP evidence"
              size="sm"
              ariaLabel="关系证据"
            />
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] px-3 text-xs text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_38%,transparent)]"
            >
              <Plus className="h-3 w-3" /> 建立
            </button>
            <button
              type="button"
              disabled={generatingRelation}
              onClick={() => void handleGenerateRelationSuggestion()}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--aurora-2)_25%,transparent)] px-3 text-xs text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-2)_10%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles className="h-3 w-3" /> AI
            </button>
          </div>
          <label className="grid gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Strength · {newRel.strength.toFixed(2)}
            </span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={newRel.strength}
              onChange={(event) => setNewRel((s) => ({ ...s, strength: Number(event.target.value) }))}
              className="w-full accent-[var(--aurora-1)]"
            />
          </label>
          <textarea
            value={newRel.bodyMarkdown}
            onChange={(event) => setNewRel((s) => ({ ...s, bodyMarkdown: event.target.value }))}
            rows={3}
            placeholder="关系依据 / rationale（可选）"
            className="w-full resize-none rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] px-3 py-2 text-xs leading-5 text-[var(--ink-primary)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
          />
        </form>
      </section>

      <section className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-primary)]">
            <Compass className="h-4 w-4" /> 局部图
            <span className="text-xs font-normal text-[var(--ink-muted)]">
              {localGraph.nodes.length} nodes · {localGraph.edges.length} edges
            </span>
          </div>
          <div className="w-40">
            <Select
              value={localGraphDepth}
              onValueChange={setLocalGraphDepth}
              options={LOCAL_GRAPH_DEPTH_OPTIONS}
              size="sm"
              ariaLabel="局部图深度"
            />
          </div>
        </header>

        {localGraph.loading ? (
          <Skeleton className="h-[260px] rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
        ) : localGraph.error ? (
          <div className="rounded-xl border border-[color-mix(in_oklch,var(--signal-danger)_24%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] p-3 text-xs text-[var(--ink-primary)]">
            {localGraph.error}
          </div>
        ) : localGraph.nodes.length <= 1 ? (
          <p className="text-xs text-[var(--ink-secondary)]">当前知识点暂无可展开的上下游关系。</p>
        ) : (
          <LocalGraphView
            centerId={kp.id}
            nodes={localGraph.nodes}
            edges={localGraph.edges}
            onNavigate={(nodeId) => navigate(`/atlas/kp/${nodeId}`)}
          />
        )}
      </section>

      <div className="text-center text-xs text-[var(--ink-muted)]">
        <Compass className="mx-auto mb-1 h-4 w-4" />
        Atlas Phase 2 · 知识点详情 · 出处与关系一阶可见
      </div>

      <Modal
        isOpen={Boolean(editDraft)}
        onClose={() => {
          if (!editDraft?.saving) setEditDraft(null);
        }}
        title="编辑知识点"
        size="lg"
      >
        {editDraft && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveKP();
            }}
          >
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--ink-secondary)]">标题</span>
              <input
                value={editDraft.title}
                onChange={(event) => setEditDraft((draft) => (draft ? { ...draft, title: event.target.value } : draft))}
                className="w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-substrate)] px-3 py-2 text-sm text-[var(--ink-primary)] outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--ink-secondary)]">正文</span>
              <textarea
                value={editDraft.bodyMarkdown}
                onChange={(event) => setEditDraft((draft) => (draft ? { ...draft, bodyMarkdown: event.target.value } : draft))}
                rows={8}
                className="w-full resize-none rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-substrate)] px-3 py-2 text-sm leading-6 text-[var(--ink-primary)] outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-[var(--ink-secondary)]">类型</span>
                <Select
                  value={editDraft.type}
                  onValueChange={(next) => setEditDraft((draft) => (draft ? { ...draft, type: next as AtlasKnowledgePointType } : draft))}
                  options={KP_TYPE_OPTIONS}
                  size="sm"
                  ariaLabel="知识点类型"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-[var(--ink-secondary)]">状态</span>
                <Select
                  value={editDraft.status}
                  onValueChange={(next) => setEditDraft((draft) => (draft ? { ...draft, status: next as AtlasKnowledgePointStatus } : draft))}
                  options={KP_STATUS_OPTIONS}
                  size="sm"
                  ariaLabel="知识点状态"
                />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--ink-secondary)]">
                Confidence · {editDraft.confidence.toFixed(2)}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={editDraft.confidence}
                onChange={(event) => setEditDraft((draft) => (draft ? { ...draft, confidence: Number(event.target.value) } : draft))}
                className="w-full accent-[var(--aurora-1)]"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={editDraft.saving}
                onClick={() => setEditDraft(null)}
                className="inline-flex h-9 items-center rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] px-3 text-xs text-[var(--ink-secondary)] hover:bg-[var(--bg-substrate)] disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={editDraft.saving}
                className="inline-flex h-9 items-center rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_32%,transparent)] px-3 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)] disabled:opacity-60"
              >
                {editDraft.saving ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmModal
        isOpen={deleteOpen}
        title="删除知识点"
        message={`确定删除「${kp.title}」？该操作会软删除知识点，并从当前图谱视图中移除。`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        zIndex={120}
        onConfirm={() => void handleDeleteKP()}
        onCancel={() => {
          if (!mutating) setDeleteOpen(false);
        }}
      />
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

function LocalGraphView({
  centerId,
  nodes,
  edges,
  onNavigate,
}: {
  centerId: number;
  nodes: AtlasKnowledgePoint[];
  edges: AtlasTypedRelation[];
  onNavigate: (nodeId: number) => void;
}) {
  const width = 760;
  const height = 280;
  const center = { x: width / 2, y: height / 2 };
  const outerNodes = nodes.filter((node) => node.id !== centerId).slice(0, 24);
  const nodePositions = new Map<number, { x: number; y: number }>([[centerId, center]]);
  outerNodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(outerNodes.length, 1) - Math.PI / 2;
    const radius = outerNodes.length > 10 ? 112 : 98;
    nodePositions.set(node.id, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  });

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[var(--bg-substrate)]">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[280px] w-full">
          <defs>
            <marker
              id="atlas-local-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="color-mix(in oklch, var(--ink-muted) 55%, transparent)" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const from = nodePositions.get(edge.fromKpId);
            const to = nodePositions.get(edge.toKpId);
            if (!from || !to) return null;
            return (
              <g key={edge.id}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="color-mix(in oklch, var(--ink-muted) 42%, transparent)"
                  strokeWidth={1.4}
                  markerEnd="url(#atlas-local-arrow)"
                />
                <text
                  x={(from.x + to.x) / 2}
                  y={(from.y + to.y) / 2 - 4}
                  textAnchor="middle"
                  className="fill-[var(--ink-muted)] text-[9px]"
                >
                  {edge.type}
                </text>
              </g>
            );
          })}
          {nodes.map((node) => {
            const pos = nodePositions.get(node.id);
            if (!pos) return null;
            const isCenter = node.id === centerId;
            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                onClick={() => onNavigate(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onNavigate(node.id);
                }}
                className="cursor-pointer"
              >
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isCenter ? 28 : 22}
                  className={cn(
                    'stroke-[color-mix(in_oklch,var(--ink-primary)_16%,transparent)]',
                    isCenter
                      ? 'fill-[color-mix(in_oklch,var(--aurora-1)_34%,var(--bg-leaf))]'
                      : 'fill-[var(--bg-leaf)]'
                  )}
                  strokeWidth={1.2}
                />
                <text
                  x={pos.x}
                  y={pos.y + 3}
                  textAnchor="middle"
                  className="pointer-events-none fill-[var(--ink-primary)] text-[10px] font-semibold"
                >
                  #{node.id}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="max-h-[280px] overflow-y-auto rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[var(--bg-substrate)] p-2">
        <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Nodes</div>
        <div className="space-y-1.5">
          {nodes.map((node) => {
            const edgeCount = edges.filter((edge) => edge.fromKpId === node.id || edge.toKpId === node.id).length;
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onNavigate(node.id)}
                className={cn(
                  'block w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-leaf)]',
                  node.id === centerId && 'bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)]'
                )}
              >
                <span className="line-clamp-1 font-medium text-[var(--ink-primary)]">
                  #{node.id} · {node.title}
                </span>
                <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">
                  {node.type} · {edgeCount} relations
                </span>
              </button>
            );
          })}
        </div>
        {edges.some((edge) => !nodeMap.has(edge.fromKpId) || !nodeMap.has(edge.toKpId)) && (
          <p className="mt-2 text-[10px] text-[var(--ink-muted)]">部分不可访问节点已隐藏。</p>
        )}
      </div>
    </div>
  );
}
