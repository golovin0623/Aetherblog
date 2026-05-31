// Atlas Phase 2 P2-07 — 图谱视图 v1 (MVP)
//
// 路由: /atlas/graph
//
// 实现: 纯 SVG + 简化力导向模拟（manual Verlet-style），不引 d3 / sigma.js 依赖。
//   * 节点按 KP type 着色
//   * 边按 relation type 着色
//   * 默认隐藏入度 > 20 的"枢纽节点"（手册 §3 Phase 2 P2-07）
//   * 节点 > 5000 时仅渲染 top 200（手册 C2-3）
//   * 支持按 KP type / relation type 过滤

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, Compass, EyeOff, Filter, Network, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { Select } from '@aetherblog/ui';

import type {
  AtlasKnowledgePoint,
  AtlasKnowledgePointType,
  AtlasProvenance,
  AtlasRelationType,
  AtlasTypedRelation,
} from '@aetherblog/types';
import { ATLAS_RELATION_TYPES } from '@aetherblog/types';

import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { atlasService } from '@/services/atlasService';
import { extractApiErrorMessage } from '@/lib/utils';

interface Node {
  id: number;
  kp: AtlasKnowledgePoint;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const VIEWPORT_W = 1000;
const VIEWPORT_H = 720;
const HUB_THRESHOLD = 20;
const MAX_NODES = 200;
const ITERATIONS = 200;
const TYPE_COLORS: Record<AtlasKnowledgePointType, string> = {
  claim: '#f97316',
  concept: '#3b82f6',
  question: '#a855f7',
  definition: '#22c55e',
  method: '#eab308',
  example: '#06b6d4',
  person: '#ef4444',
  source: '#84cc16',
};
const RELATION_COLORS: Record<AtlasRelationType, string> = {
  supports: '#22c55e',
  refutes: '#ef4444',
  specializes: '#3b82f6',
  generalizes: '#6366f1',
  precedes: '#f59e0b',
  causes: '#f59e0b',
  similar_to: '#a855f7',
  cites: '#06b6d4',
  instance_of: '#84cc16',
};

const TYPE_OPTIONS = [
  { value: 'all', label: '全部 KP 类型' },
  ...Object.keys(TYPE_COLORS).map((type) => ({ value: type, label: type })),
];

const RELATION_OPTIONS = [
  { value: 'all', label: '全部关系' },
  ...ATLAS_RELATION_TYPES.map((type) => ({ value: type, label: type })),
];

type AtlasScopeFilter = 'all' | 'mine';
type TimeFilter = 'all' | '7d' | '30d' | '90d';
type ConfidenceFilter = 'all' | 'gte-60' | 'gte-80';
type EvidenceFilter = 'all' | 'kp-with' | 'kp-missing' | 'relation-missing';
type TopologyFilter = 'all' | 'orphan' | 'hub';
type GraphSelection =
  | { kind: 'node'; id: number }
  | { kind: 'edge'; id: number };

const SCOPE_OPTIONS = [
  { value: 'all', label: '全部可访问' },
  { value: 'mine', label: '仅我的' },
];

const TIME_OPTIONS: Array<{ value: TimeFilter; label: string }> = [
  { value: 'all', label: '全部时间' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
];

const PROVENANCE_OPTIONS: Array<{ value: AtlasProvenance | 'all'; label: string }> = [
  { value: 'all', label: '全部来源' },
  { value: 'user', label: '用户创建' },
  { value: 'ai_suggested', label: 'AI 建议' },
  { value: 'imported', label: '导入' },
];

const CONFIDENCE_OPTIONS: Array<{ value: ConfidenceFilter; label: string }> = [
  { value: 'all', label: '全部置信度' },
  { value: 'gte-60', label: '置信度 >= 0.60' },
  { value: 'gte-80', label: '置信度 >= 0.80' },
];

const EVIDENCE_OPTIONS: Array<{ value: EvidenceFilter; label: string }> = [
  { value: 'all', label: '全部证据' },
  { value: 'kp-with', label: 'KP 有证据' },
  { value: 'kp-missing', label: 'KP 缺证据' },
  { value: 'relation-missing', label: '关系缺证据' },
];

const TOPOLOGY_OPTIONS: Array<{ value: TopologyFilter; label: string }> = [
  { value: 'all', label: '全部拓扑' },
  { value: 'orphan', label: '孤立 KP' },
  { value: 'hub', label: 'Hub KP' },
];

const TIME_WINDOW_DAYS: Record<Exclude<TimeFilter, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export default function AtlasGraphPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawKps, setRawKps] = useState<AtlasKnowledgePoint[]>([]);
  const [rawEdges, setRawEdges] = useState<AtlasTypedRelation[]>([]);
  const [kpEvidenceCounts, setKpEvidenceCounts] = useState<Record<string, number>>({});
  const [relationEvidenceCounts, setRelationEvidenceCounts] = useState<Record<string, number>>({});
  const [scope, setScope] = useState<AtlasScopeFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<AtlasKnowledgePointType | 'all'>('all');
  const [relFilter, setRelFilter] = useState<AtlasRelationType | 'all'>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [provenanceFilter, setProvenanceFilter] = useState<AtlasProvenance | 'all'>('all');
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>('all');
  const [topologyFilter, setTopologyFilter] = useState<TopologyFilter>('all');
  const [hideHubs, setHideHubs] = useState(true);
  const [selection, setSelection] = useState<GraphSelection | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const lastGraphSearchRef = useRef('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await atlasService.getGraph(undefined, { scope });
      setRawKps(res.data?.nodes ?? []);
      setRawEdges(res.data?.edges ?? []);
      setKpEvidenceCounts(res.data?.kpEvidenceCounts ?? {});
      setRelationEvidenceCounts(res.data?.relationEvidenceCounts ?? {});
      setError(null);
    } catch (err) {
      setError(extractApiErrorMessage(err, '加载图谱失败'));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const query = keyword.trim();
    if (!query) return;
    const signature = `${scope}|${typeFilter}|${relFilter}|${timeFilter}|${provenanceFilter}|${confidenceFilter}|${evidenceFilter}|${topologyFilter}|${query}`;
    const timeoutID = window.setTimeout(() => {
      if (lastGraphSearchRef.current === signature) return;
      lastGraphSearchRef.current = signature;
      void atlasService.recordEvent({
        eventType: 'atlas.graph_search',
        title: 'Atlas graph search',
        description: `keyword=${query}; scope=${scope}; type=${typeFilter}; relation=${relFilter}; time=${timeFilter}; provenance=${provenanceFilter}; confidence=${confidenceFilter}; evidence=${evidenceFilter}; topology=${topologyFilter}`,
        status: 'INFO',
      }).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timeoutID);
  }, [
    confidenceFilter,
    evidenceFilter,
    keyword,
    provenanceFilter,
    relFilter,
    scope,
    timeFilter,
    topologyFilter,
    typeFilter,
  ]);

  const { nodes, edges, hidden, degreeById, inDegreeById, outDegreeById } = useMemo(() => {
    const now = Date.now();

    // 1) 过滤 KP
    let kps = rawKps;
    const query = keyword.trim().toLowerCase();
    if (query) {
      kps = kps.filter((k) => {
        const haystack = `${k.title}\n${k.bodyMarkdown}\n${k.type}\n${k.status}\n${k.provenance}`.toLowerCase();
        return haystack.includes(query);
      });
    }
    if (typeFilter !== 'all') kps = kps.filter((k) => k.type === typeFilter);
    if (timeFilter !== 'all') {
      const cutoff = now - TIME_WINDOW_DAYS[timeFilter] * 24 * 60 * 60 * 1000;
      kps = kps.filter((k) => Date.parse(k.updatedAt || k.createdAt) >= cutoff);
    }
    if (provenanceFilter !== 'all') {
      kps = kps.filter((k) => k.provenance === provenanceFilter);
    }
    if (confidenceFilter !== 'all') {
      const minConfidence = confidenceFilter === 'gte-80' ? 0.8 : 0.6;
      kps = kps.filter((k) => k.confidence >= minConfidence);
    }
    if (evidenceFilter === 'kp-with') {
      kps = kps.filter((k) => evidenceCount(kpEvidenceCounts, k.id) > 0);
    } else if (evidenceFilter === 'kp-missing') {
      kps = kps.filter((k) => evidenceCount(kpEvidenceCounts, k.id) === 0);
    }

    // 2) 过滤 edges
    const kpIds = new Set(kps.map((k) => k.id));
    let es = rawEdges.filter((e) => kpIds.has(e.fromKpId) && kpIds.has(e.toKpId));
    if (relFilter !== 'all') es = es.filter((e) => e.type === relFilter);
    if (evidenceFilter === 'relation-missing') {
      es = es.filter((e) => evidenceCount(relationEvidenceCounts, e.id) === 0);
      const endpoints = new Set<number>();
      es.forEach((e) => {
        endpoints.add(e.fromKpId);
        endpoints.add(e.toKpId);
      });
      kps = kps.filter((k) => endpoints.has(k.id));
    }

    // 3) 拓扑过滤 / hub 折叠
    let degrees = buildDegreeMaps(es, kps);
    if (topologyFilter === 'orphan') {
      kps = kps.filter((k) => (degrees.degreeById.get(k.id) ?? 0) === 0);
      es = [];
      degrees = buildDegreeMaps(es, kps);
    } else if (topologyFilter === 'hub') {
      kps = kps.filter((k) => (degrees.inDegreeById.get(k.id) ?? 0) > HUB_THRESHOLD);
      const after = new Set(kps.map((k) => k.id));
      es = es.filter((e) => after.has(e.fromKpId) && after.has(e.toKpId));
      degrees = buildDegreeMaps(es, kps);
    }
    let hiddenCount = 0;
    if (hideHubs && topologyFilter !== 'hub') {
      const hubs = new Set<number>();
      kps.forEach((k) => {
        if ((degrees.inDegreeById.get(k.id) ?? 0) > HUB_THRESHOLD) hubs.add(k.id);
      });
      hiddenCount = hubs.size;
      kps = kps.filter((k) => !hubs.has(k.id));
      const after = new Set(kps.map((k) => k.id));
      es = es.filter((e) => after.has(e.fromKpId) && after.has(e.toKpId));
      degrees = buildDegreeMaps(es, kps);
    }

    // 4) 上限
    if (kps.length > MAX_NODES) {
      kps = kps.slice(0, MAX_NODES);
      const after = new Set(kps.map((k) => k.id));
      es = es.filter((e) => after.has(e.fromKpId) && after.has(e.toKpId));
      degrees = buildDegreeMaps(es, kps);
    }

    // 5) 力导向布局（简化版 + 确定性: 用 id 当种子）
    const n: Node[] = kps.map((kp, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, kps.length);
      const r = 220 + ((kp.id * 37) % 80);
      return {
        id: kp.id,
        kp,
        x: VIEWPORT_W / 2 + r * Math.cos(angle),
        y: VIEWPORT_H / 2 + r * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });
    simulate(n, es, ITERATIONS);

    return { nodes: n, edges: es, hidden: hiddenCount, ...degrees };
  }, [
    confidenceFilter,
    evidenceFilter,
    hideHubs,
    keyword,
    kpEvidenceCounts,
    provenanceFilter,
    rawEdges,
    rawKps,
    relationEvidenceCounts,
    relFilter,
    timeFilter,
    topologyFilter,
    typeFilter,
  ]);

  useEffect(() => {
    if (!selection) return;
    if (selection.kind === 'node' && nodes.some((node) => node.id === selection.id)) return;
    if (selection.kind === 'edge' && edges.some((edge) => edge.id === selection.id)) return;
    setSelection(null);
  }, [edges, nodes, selection]);

  return (
    <div className="space-y-4">
      <AdminModuleHeader
        title="Aether Graph"
        description={`图谱视图 · ${nodes.length} 节点 · ${edges.length} 关系${hidden ? ` · ${hidden} 个 hub 节点已折叠` : ''}`}
        icon={Compass}
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 text-xs hover:bg-[var(--bg-substrate)]"
          >
            <RefreshCw className="h-3 w-3" /> 刷新
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-1 text-[var(--ink-muted)]">
          <Filter className="h-3 w-3" /> 过滤
        </span>

        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="定位 KP 标题、正文或来源"
            className="h-8 w-full rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-substrate)] pl-8 pr-2 text-xs text-[var(--ink-primary)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
          />
        </label>

        <div className="w-36">
          <Select
            value={scope}
            onValueChange={(next) => setScope(next as AtlasScopeFilter)}
            options={SCOPE_OPTIONS}
            size="sm"
            ariaLabel="Atlas 数据范围"
          />
        </div>

        <div className="w-44">
          <Select
            value={typeFilter}
            onValueChange={(next) => setTypeFilter(next as typeof typeFilter)}
            options={TYPE_OPTIONS}
            size="sm"
            ariaLabel="KP type 过滤"
          />
        </div>

        <div className="w-44">
          <Select
            value={relFilter}
            onValueChange={(next) => setRelFilter(next as typeof relFilter)}
            options={RELATION_OPTIONS}
            size="sm"
            ariaLabel="关系类型过滤"
          />
        </div>

        <div className="w-36">
          <Select
            value={timeFilter}
            onValueChange={(next) => setTimeFilter(next as TimeFilter)}
            options={TIME_OPTIONS}
            size="sm"
            ariaLabel="更新时间过滤"
          />
        </div>

        <div className="w-36">
          <Select
            value={provenanceFilter}
            onValueChange={(next) => setProvenanceFilter(next as AtlasProvenance | 'all')}
            options={PROVENANCE_OPTIONS}
            size="sm"
            ariaLabel="来源过滤"
          />
        </div>

        <div className="w-44">
          <Select
            value={confidenceFilter}
            onValueChange={(next) => setConfidenceFilter(next as ConfidenceFilter)}
            options={CONFIDENCE_OPTIONS}
            size="sm"
            ariaLabel="置信度过滤"
          />
        </div>

        <div className="w-36">
          <Select
            value={evidenceFilter}
            onValueChange={(next) => setEvidenceFilter(next as EvidenceFilter)}
            options={EVIDENCE_OPTIONS}
            size="sm"
            ariaLabel="证据健康过滤"
          />
        </div>

        <div className="w-36">
          <Select
            value={topologyFilter}
            onValueChange={(next) => setTopologyFilter(next as TopologyFilter)}
            options={TOPOLOGY_OPTIONS}
            size="sm"
            ariaLabel="拓扑过滤"
          />
        </div>

        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={hideHubs && topologyFilter !== 'hub'}
            onChange={(e) => setHideHubs(e.target.checked)}
            disabled={topologyFilter === 'hub'}
            className="h-3 w-3"
          />
          <EyeOff className="h-3 w-3" />
          折叠 hub (入度 &gt; {HUB_THRESHOLD})
        </label>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
          <Skeleton className="h-[560px] rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] p-4 text-sm text-[var(--ink-primary)]">
          {error}
        </div>
      ) : nodes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-leaf)] p-10 text-center text-sm text-[var(--ink-secondary)]">
          暂无知识点。请在 Reader 里抽离一些 KP 或直接创建。
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)]">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
              className="block w-full"
              style={{ maxHeight: 720 }}
              onClick={() => setSelection(null)}
            >
              <defs>
                <marker
                  id="atlas-arrow"
                  viewBox="0 -5 10 10"
                  refX="18"
                  refY="0"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M0,-5L10,0L0,5" fill="currentColor" />
                </marker>
              </defs>

              <rect x={0} y={0} width={VIEWPORT_W} height={VIEWPORT_H} fill="transparent" pointerEvents="none" />

              {edges.map((e) => {
                const a = nodes.find((n) => n.id === e.fromKpId);
                const b = nodes.find((n) => n.id === e.toKpId);
                if (!a || !b) return null;
                const color = RELATION_COLORS[e.type];
                const selected = selection?.kind === 'edge' && selection.id === e.id;
                return (
                  <g key={e.id} className="cursor-pointer">
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="rgba(0,0,0,0.001)"
                      strokeWidth={14}
                      pointerEvents="stroke"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelection({ kind: 'edge', id: e.id });
                      }}
                    />
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={color}
                      strokeOpacity={selected ? 0.95 : 0.5}
                      strokeWidth={selected ? 3 + e.strength * 1.2 : 1 + e.strength * 1.2}
                      markerEnd="url(#atlas-arrow)"
                      style={{ color, pointerEvents: 'none' }}
                    />
                  </g>
                );
              })}

              {nodes.map((n) => {
                const color = TYPE_COLORS[n.kp.type] ?? '#94a3b8';
                const selected = selection?.kind === 'node' && selection.id === n.id;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x}, ${n.y})`}
                    className="cursor-pointer"
                    pointerEvents="all"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelection({ kind: 'node', id: n.id });
                    }}
                    onDoubleClick={() => navigate(`/atlas/kp/${n.id}`)}
                  >
                    <rect x={-24} y={-20} width={164} height={40} fill="rgba(0,0,0,0.001)" pointerEvents="all" />
                    <circle
                      r={selected ? 13 : 10}
                      fill={color}
                      fillOpacity={0.85}
                      stroke={selected ? 'var(--ink-primary)' : '#fff'}
                      strokeWidth={selected ? 2.5 : 1.5}
                    />
                    <text
                      x={14}
                      y={4}
                      fontSize={11}
                      fill="currentColor"
                      className="fill-current text-[var(--ink-primary)]"
                      style={{ pointerEvents: 'none' }}
                    >
                      {truncate(n.kp.title, 18)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <GraphInspector
            selection={selection}
            nodes={nodes}
            edges={edges}
            kpEvidenceCounts={kpEvidenceCounts}
            relationEvidenceCounts={relationEvidenceCounts}
            degreeById={degreeById}
            inDegreeById={inDegreeById}
            outDegreeById={outDegreeById}
            onOpenKP={(id) => navigate(`/atlas/kp/${id}`)}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--ink-muted)]">
        <span>图例:</span>
        {Object.entries(TYPE_COLORS).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: v }} />
            {k}
          </span>
        ))}
        <span className="ml-3">|</span>
        {ATLAS_RELATION_TYPES.slice(0, 5).map((t) => (
          <span key={t} className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3" style={{ background: RELATION_COLORS[t] }} />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function GraphInspector({
  selection,
  nodes,
  edges,
  kpEvidenceCounts,
  relationEvidenceCounts,
  degreeById,
  inDegreeById,
  outDegreeById,
  onOpenKP,
}: {
  selection: GraphSelection | null;
  nodes: Node[];
  edges: AtlasTypedRelation[];
  kpEvidenceCounts: Record<string, number>;
  relationEvidenceCounts: Record<string, number>;
  degreeById: Map<number, number>;
  inDegreeById: Map<number, number>;
  outDegreeById: Map<number, number>;
  onOpenKP: (id: number) => void;
}) {
  const selectedNode = selection?.kind === 'node' ? nodes.find((node) => node.id === selection.id) : undefined;
  const selectedEdge = selection?.kind === 'edge' ? edges.find((edge) => edge.id === selection.id) : undefined;
  const missingKps = nodes.filter((node) => evidenceCount(kpEvidenceCounts, node.id) === 0).length;
  const missingRelations = edges.filter((edge) => evidenceCount(relationEvidenceCounts, edge.id) === 0).length;

  if (selectedNode) {
    const kp = selectedNode.kp;
    const relatedEdges = edges.filter((edge) => edge.fromKpId === kp.id || edge.toKpId === kp.id);
    return (
      <aside className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4 text-xs text-[var(--ink-secondary)]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">Knowledge Point</p>
            <h2 className="mt-1 text-sm font-semibold text-[var(--ink-primary)]">{kp.title}</h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenKP(kp.id)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-2 text-[11px] text-[var(--ink-primary)] hover:bg-[var(--bg-substrate)]"
          >
            打开 <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <GraphBadge>{kp.type}</GraphBadge>
          <GraphBadge>{kp.status}</GraphBadge>
          <GraphBadge>{kp.provenance}</GraphBadge>
        </div>
        <div className="mt-4 space-y-2">
          <MetaRow label="证据" value={`${evidenceCount(kpEvidenceCounts, kp.id)} 条`} />
          <MetaRow label="连接度" value={`${degreeById.get(kp.id) ?? 0} · 入 ${inDegreeById.get(kp.id) ?? 0} · 出 ${outDegreeById.get(kp.id) ?? 0}`} />
          <MetaRow label="置信度" value={kp.confidence.toFixed(2)} />
          <MetaRow label="更新" value={formatDate(kp.updatedAt)} />
        </div>
        {kp.bodyMarkdown ? (
          <p className="mt-4 max-h-28 overflow-hidden rounded-lg bg-[var(--bg-substrate)] p-3 leading-5 text-[var(--ink-secondary)]">
            {truncate(kp.bodyMarkdown.replace(/\s+/g, ' '), 180)}
          </p>
        ) : null}
        <div className="mt-4 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pt-3">
          <p className="mb-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
            <Network className="h-3 w-3" /> Relations
          </p>
          <div className="space-y-1.5">
            {relatedEdges.slice(0, 6).map((edge) => (
              <div key={edge.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-[var(--ink-primary)]">{edge.type}</span>
                <span className="shrink-0 text-[var(--ink-muted)]">{edge.strength.toFixed(2)}</span>
              </div>
            ))}
            {relatedEdges.length === 0 ? <p className="text-[var(--ink-muted)]">无关系</p> : null}
          </div>
        </div>
      </aside>
    );
  }

  if (selectedEdge) {
    const from = nodes.find((node) => node.id === selectedEdge.fromKpId)?.kp;
    const to = nodes.find((node) => node.id === selectedEdge.toKpId)?.kp;
    return (
      <aside className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4 text-xs text-[var(--ink-secondary)]">
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">Relation</p>
          <h2 className="mt-1 text-sm font-semibold text-[var(--ink-primary)]">{selectedEdge.type}</h2>
        </div>
        <div className="space-y-2">
          <MetaRow label="From" value={from?.title ?? `KP #${selectedEdge.fromKpId}`} />
          <MetaRow label="To" value={to?.title ?? `KP #${selectedEdge.toKpId}`} />
          <MetaRow label="证据" value={`${evidenceCount(relationEvidenceCounts, selectedEdge.id)} 条`} />
          <MetaRow label="强度" value={selectedEdge.strength.toFixed(2)} />
          <MetaRow label="来源" value={selectedEdge.provenance} />
          <MetaRow label="更新" value={formatDate(selectedEdge.updatedAt)} />
        </div>
        {selectedEdge.bodyMarkdown ? (
          <p className="mt-4 max-h-28 overflow-hidden rounded-lg bg-[var(--bg-substrate)] p-3 leading-5 text-[var(--ink-secondary)]">
            {truncate(selectedEdge.bodyMarkdown.replace(/\s+/g, ' '), 180)}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pt-3">
          <button
            type="button"
            onClick={() => onOpenKP(selectedEdge.fromKpId)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-2 text-[11px] text-[var(--ink-primary)] hover:bg-[var(--bg-substrate)]"
          >
            From <ArrowRight className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onOpenKP(selectedEdge.toKpId)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-2 text-[11px] text-[var(--ink-primary)] hover:bg-[var(--bg-substrate)]"
          >
            To <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4 text-xs text-[var(--ink-secondary)]">
      <div className="mb-4">
        <p className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
          <SlidersHorizontal className="h-3 w-3" /> Graph Summary
        </p>
        <h2 className="mt-1 text-sm font-semibold text-[var(--ink-primary)]">Visible Scope</h2>
      </div>
      <div className="space-y-2">
        <MetaRow label="节点" value={`${nodes.length}`} />
        <MetaRow label="关系" value={`${edges.length}`} />
        <MetaRow label="KP 缺证据" value={`${missingKps}`} />
        <MetaRow label="关系缺证据" value={`${missingRelations}`} />
        <MetaRow label="Hub 阈值" value={`入度 > ${HUB_THRESHOLD}`} />
      </div>
      <p className="mt-4 inline-flex items-center gap-1 text-[var(--ink-muted)]">
        <CalendarDays className="h-3 w-3" />
        {formatDate(new Date().toISOString())}
      </p>
    </aside>
  );
}

function GraphBadge({ children }: { children: string }) {
  return (
    <span className="rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] px-2 py-1 text-[10px] text-[var(--ink-secondary)]">
      {children}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <span className="text-[var(--ink-muted)]">{label}</span>
      <span className="truncate text-[var(--ink-primary)]">{value}</span>
    </div>
  );
}

function evidenceCount(counts: Record<string, number>, id: number): number {
  return counts[String(id)] ?? 0;
}

function buildDegreeMaps(edges: AtlasTypedRelation[], kps: AtlasKnowledgePoint[]) {
  const degreeById = new Map<number, number>();
  const inDegreeById = new Map<number, number>();
  const outDegreeById = new Map<number, number>();
  kps.forEach((kp) => {
    degreeById.set(kp.id, 0);
    inDegreeById.set(kp.id, 0);
    outDegreeById.set(kp.id, 0);
  });
  edges.forEach((edge) => {
    outDegreeById.set(edge.fromKpId, (outDegreeById.get(edge.fromKpId) ?? 0) + 1);
    inDegreeById.set(edge.toKpId, (inDegreeById.get(edge.toKpId) ?? 0) + 1);
    degreeById.set(edge.fromKpId, (degreeById.get(edge.fromKpId) ?? 0) + 1);
    degreeById.set(edge.toKpId, (degreeById.get(edge.toKpId) ?? 0) + 1);
  });
  return { degreeById, inDegreeById, outDegreeById };
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// 简易力导向: 200 次迭代，repulsion + spring + 阻尼。
//
// PR #724 review fix (Gemini high): spring 阶段用 id->Node Map 把 O(E*N) 降为 O(E)。
// 200 迭代 × 边数 N=200 × 节点查找 200 ≈ 800 万次/次渲染 → 现在 4 万次。
function simulate(nodes: Node[], edges: AtlasTypedRelation[], iterations: number): void {
  if (nodes.length === 0) return;
  const k = Math.sqrt((VIEWPORT_W * VIEWPORT_H) / nodes.length);
  // 构建 id → Node 索引，避免每次 spring 计算 O(N) 查找。
  const byId = new Map<number, Node>();
  for (const n of nodes) byId.set(n.id, n);
  // 预过滤掉两端不在 nodes 里的 edges，循环里再无 if 判分支。
  const liveEdges: Array<{ a: Node; b: Node }> = [];
  for (const e of edges) {
    const a = byId.get(e.fromKpId);
    const b = byId.get(e.toKpId);
    if (a && b) liveEdges.push({ a, b });
  }
  for (let iter = 0; iter < iterations; iter++) {
    // repulsion
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      let fx = 0;
      let fy = 0;
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist2 = dx * dx + dy * dy + 0.01;
        const force = (k * k) / dist2;
        fx += dx * force;
        fy += dy * force;
      }
      a.vx = (a.vx + fx * 0.0008) * 0.85;
      a.vy = (a.vy + fy * 0.0008) * 0.85;
    }
    // spring (O(E)，不再 nodes.find)
    for (const { a, b } of liveEdges) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const force = (dist - k) / dist;
      a.vx -= dx * force * 0.05;
      a.vy -= dy * force * 0.05;
      b.vx += dx * force * 0.05;
      b.vy += dy * force * 0.05;
    }
    // apply velocity + boundary clamp
    for (const n of nodes) {
      n.x = clamp(n.x + n.vx, 30, VIEWPORT_W - 30);
      n.y = clamp(n.y + n.vy, 30, VIEWPORT_H - 30);
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
