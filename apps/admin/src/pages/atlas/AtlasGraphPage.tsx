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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, EyeOff, Filter, Loader2, RefreshCw } from 'lucide-react';

import type {
  AtlasKnowledgePoint,
  AtlasKnowledgePointType,
  AtlasRelationType,
  AtlasTypedRelation,
} from '@aetherblog/types';
import { ATLAS_RELATION_TYPES } from '@aetherblog/types';

import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { atlasService } from '@/services/atlasService';
import { cn, extractApiErrorMessage } from '@/lib/utils';

interface Node {
  id: number;
  kp: AtlasKnowledgePoint;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Edge {
  source: number;
  target: number;
  type: AtlasRelationType;
  raw: AtlasTypedRelation;
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

export default function AtlasGraphPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawKps, setRawKps] = useState<AtlasKnowledgePoint[]>([]);
  const [rawEdges, setRawEdges] = useState<AtlasTypedRelation[]>([]);
  const [typeFilter, setTypeFilter] = useState<AtlasKnowledgePointType | 'all'>('all');
  const [relFilter, setRelFilter] = useState<AtlasRelationType | 'all'>('all');
  const [hideHubs, setHideHubs] = useState(true);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await atlasService.getGraph();
      setRawKps(res.data?.nodes ?? []);
      setRawEdges(res.data?.edges ?? []);
      setError(null);
    } catch (err) {
      setError(extractApiErrorMessage(err, '加载图谱失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const { nodes, edges, hidden } = useMemo(() => {
    // 1) 过滤 KP
    let kps = rawKps;
    if (typeFilter !== 'all') kps = kps.filter((k) => k.type === typeFilter);

    // 2) 过滤 edges
    const kpIds = new Set(kps.map((k) => k.id));
    let es = rawEdges.filter((e) => kpIds.has(e.fromKpId) && kpIds.has(e.toKpId));
    if (relFilter !== 'all') es = es.filter((e) => e.type === relFilter);

    // 3) 算入度，可选隐藏 hub
    const indegree = new Map<number, number>();
    es.forEach((e) => indegree.set(e.toKpId, (indegree.get(e.toKpId) ?? 0) + 1));
    let hiddenCount = 0;
    if (hideHubs) {
      const hubs = new Set<number>();
      kps.forEach((k) => {
        if ((indegree.get(k.id) ?? 0) > HUB_THRESHOLD) hubs.add(k.id);
      });
      hiddenCount = hubs.size;
      kps = kps.filter((k) => !hubs.has(k.id));
      const after = new Set(kps.map((k) => k.id));
      es = es.filter((e) => after.has(e.fromKpId) && after.has(e.toKpId));
    }

    // 4) 上限
    if (kps.length > MAX_NODES) {
      kps = kps.slice(0, MAX_NODES);
      const after = new Set(kps.map((k) => k.id));
      es = es.filter((e) => after.has(e.fromKpId) && after.has(e.toKpId));
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

    return { nodes: n, edges: es as Edge[] | AtlasTypedRelation[], hidden: hiddenCount };
  }, [rawKps, rawEdges, typeFilter, relFilter, hideHubs]);

  return (
    <div className="space-y-4">
      <AdminModuleHeader
        title="Aether Graph"
        description={`图谱视图 · ${nodes.length} 节点 · ${(edges as AtlasTypedRelation[]).length} 关系${hidden ? ` · ${hidden} 个 hub 节点已折叠` : ''}`}
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

        <label className="inline-flex items-center gap-1">
          KP type:
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
            className="h-7 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] px-1.5"
          >
            <option value="all">all</option>
            {Object.keys(TYPE_COLORS).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-1">
          关系:
          <select
            value={relFilter}
            onChange={(e) => setRelFilter(e.target.value as typeof relFilter)}
            className="h-7 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] px-1.5"
          >
            <option value="all">all</option>
            {ATLAS_RELATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={hideHubs}
            onChange={(e) => setHideHubs(e.target.checked)}
            className="h-3 w-3"
          />
          <EyeOff className="h-3 w-3" />
          折叠 hub (入度 &gt; {HUB_THRESHOLD})
        </label>
      </div>

      {loading ? (
        <div className="flex h-[600px] items-center justify-center rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)]">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--ink-muted)]" />
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
        <div className="overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)]">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
            className="block w-full"
            style={{ maxHeight: 720 }}
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

            {(edges as AtlasTypedRelation[]).map((e) => {
              const a = nodes.find((n) => n.id === e.fromKpId);
              const b = nodes.find((n) => n.id === e.toKpId);
              if (!a || !b) return null;
              const color = RELATION_COLORS[e.type];
              return (
                <line
                  key={e.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={color}
                  strokeOpacity={0.5}
                  strokeWidth={1 + e.strength * 1.2}
                  markerEnd="url(#atlas-arrow)"
                  style={{ color }}
                />
              );
            })}

            {nodes.map((n) => {
              const color = TYPE_COLORS[n.kp.type] ?? '#94a3b8';
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x}, ${n.y})`}
                  className="cursor-pointer"
                  onClick={() => navigate(`/atlas/kp/${n.id}`)}
                >
                  <circle r={10} fill={color} fillOpacity={0.85} stroke="#fff" strokeWidth={1.5} />
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
