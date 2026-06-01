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
import type { PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  Compass,
  Download,
  EyeOff,
  Filter,
  Maximize2,
  Network,
  Quote,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Select } from '@aetherblog/ui';

import type {
  AtlasKnowledgePoint,
  AtlasKnowledgePointType,
  AtlasProvenance,
  AtlasRelationType,
  AtlasSearchEvidencePreview,
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
type GraphViewport = {
  x: number;
  y: number;
  scale: number;
};
type GraphPositionMap = Record<string, { x: number; y: number }>;
type SavedGraphLayout = {
  version: 1;
  viewport: GraphViewport;
  positions: GraphPositionMap;
  savedAt: string;
};
type GraphFilterState = {
  keyword: string;
  typeFilter: AtlasKnowledgePointType | 'all';
  relFilter: AtlasRelationType | 'all';
  timeFilter: TimeFilter;
  provenanceFilter: AtlasProvenance | 'all';
  confidenceFilter: ConfidenceFilter;
  evidenceFilter: EvidenceFilter;
  topologyFilter: TopologyFilter;
  hideHubs: boolean;
};
type GraphFilterPreset = {
  id: string;
  name: string;
  filters: GraphFilterState;
  createdAt: string;
  updatedAt: string;
};
type SavedGraphFilterPresets = {
  version: 1;
  presets: GraphFilterPreset[];
};
type PanState = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: GraphViewport;
};

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
const MIN_GRAPH_SCALE = 0.55;
const MAX_GRAPH_SCALE = 2.6;
const GRAPH_ZOOM_STEP = 1.2;
const DEFAULT_VIEWPORT: GraphViewport = { x: 0, y: 0, scale: 1 };
const LAYOUT_STORAGE_PREFIX = 'atlas.graph.layout.v1';
const FILTER_PRESET_STORAGE_PREFIX = 'atlas.graph.filter-presets.v1';
const FILTER_PRESET_LIMIT = 12;
const NO_FILTER_PRESET = 'none';

export default function AtlasGraphPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawKps, setRawKps] = useState<AtlasKnowledgePoint[]>([]);
  const [rawEdges, setRawEdges] = useState<AtlasTypedRelation[]>([]);
  const [kpEvidenceCounts, setKpEvidenceCounts] = useState<Record<string, number>>({});
  const [relationEvidenceCounts, setRelationEvidenceCounts] = useState<Record<string, number>>({});
  const [kpEvidencePreviews, setKpEvidencePreviews] = useState<Record<string, AtlasSearchEvidencePreview>>({});
  const [relationEvidencePreviews, setRelationEvidencePreviews] = useState<Record<string, AtlasSearchEvidencePreview>>({});
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
  const [viewport, setViewport] = useState<GraphViewport>(DEFAULT_VIEWPORT);
  const [savedPositions, setSavedPositions] = useState<GraphPositionMap>({});
  const [layoutSavedAt, setLayoutSavedAt] = useState<string | null>(null);
  const [filterPresets, setFilterPresets] = useState<GraphFilterPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [activePresetId, setActivePresetId] = useState(NO_FILTER_PRESET);
  const [presetStatus, setPresetStatus] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'json' | 'graphml' | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<PanState | null>(null);
  const draggedRef = useRef(false);
  const lastGraphSearchRef = useRef('');
  const graphLayoutKey = useMemo(() => `${LAYOUT_STORAGE_PREFIX}:${scope}`, [scope]);
  const graphFilterPresetKey = useMemo(() => `${FILTER_PRESET_STORAGE_PREFIX}:${scope}`, [scope]);
  const currentFilterState = useMemo<GraphFilterState>(() => ({
    keyword,
    typeFilter,
    relFilter,
    timeFilter,
    provenanceFilter,
    confidenceFilter,
    evidenceFilter,
    topologyFilter,
    hideHubs,
  }), [
    confidenceFilter,
    evidenceFilter,
    hideHubs,
    keyword,
    provenanceFilter,
    relFilter,
    timeFilter,
    topologyFilter,
    typeFilter,
  ]);
  const filterPresetOptions = useMemo(() => [
    { value: NO_FILTER_PRESET, label: '选择过滤预设' },
    ...filterPresets.map((preset) => ({ value: preset.id, label: preset.name })),
  ], [filterPresets]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await atlasService.getGraph(undefined, { scope });
      setRawKps(res.data?.nodes ?? []);
      setRawEdges(res.data?.edges ?? []);
      setKpEvidenceCounts(res.data?.kpEvidenceCounts ?? {});
      setRelationEvidenceCounts(res.data?.relationEvidenceCounts ?? {});
      setKpEvidencePreviews(res.data?.kpEvidencePreviews ?? {});
      setRelationEvidencePreviews(res.data?.relationEvidencePreviews ?? {});
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
    const saved = readSavedGraphLayout(graphLayoutKey);
    setViewport(saved?.viewport ?? DEFAULT_VIEWPORT);
    setSavedPositions(saved?.positions ?? {});
    setLayoutSavedAt(saved?.savedAt ?? null);
    setSelection(null);
  }, [graphLayoutKey]);

  useEffect(() => {
    setFilterPresets(readGraphFilterPresets(graphFilterPresetKey));
    setPresetName('');
    setPresetStatus(null);
  }, [graphFilterPresetKey]);

  useEffect(() => {
    setActivePresetId(findMatchingPresetId(filterPresets, currentFilterState) ?? NO_FILTER_PRESET);
  }, [currentFilterState, filterPresets]);

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
    n.forEach((node) => {
      const saved = savedPositions[String(node.id)];
      if (!saved) return;
      node.x = clamp(saved.x, 30, VIEWPORT_W - 30);
      node.y = clamp(saved.y, 30, VIEWPORT_H - 30);
    });

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
    savedPositions,
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

  const zoomGraph = useCallback((factor: number, anchor = { x: VIEWPORT_W / 2, y: VIEWPORT_H / 2 }) => {
    setViewport((current) => zoomViewport(current, factor, anchor));
  }, []);

  const resetViewport = useCallback(() => {
    setViewport(DEFAULT_VIEWPORT);
  }, []);

  const saveLayout = useCallback(() => {
    const positions = nodes.reduce<GraphPositionMap>((acc, node) => {
      acc[String(node.id)] = { x: roundPosition(node.x), y: roundPosition(node.y) };
      return acc;
    }, {});
    const savedAt = new Date().toISOString();
    const layout: SavedGraphLayout = {
      version: 1,
      viewport: clampViewport(viewport),
      positions,
      savedAt,
    };
    window.localStorage.setItem(graphLayoutKey, JSON.stringify(layout));
    setSavedPositions(positions);
    setLayoutSavedAt(savedAt);
  }, [graphLayoutKey, nodes, viewport]);

  const resetLayout = useCallback(() => {
    window.localStorage.removeItem(graphLayoutKey);
    setSavedPositions({});
    setViewport(DEFAULT_VIEWPORT);
    setLayoutSavedAt(null);
  }, [graphLayoutKey]);

  const persistFilterPresets = useCallback((presets: GraphFilterPreset[]) => {
    const next = presets.slice(0, FILTER_PRESET_LIMIT);
    const saved: SavedGraphFilterPresets = { version: 1, presets: next };
    window.localStorage.setItem(graphFilterPresetKey, JSON.stringify(saved));
    setFilterPresets(next);
  }, [graphFilterPresetKey]);

  const applyFilterState = useCallback((filters: GraphFilterState) => {
    setKeyword(filters.keyword);
    setTypeFilter(filters.typeFilter);
    setRelFilter(filters.relFilter);
    setTimeFilter(filters.timeFilter);
    setProvenanceFilter(filters.provenanceFilter);
    setConfidenceFilter(filters.confidenceFilter);
    setEvidenceFilter(filters.evidenceFilter);
    setTopologyFilter(filters.topologyFilter);
    setHideHubs(filters.hideHubs);
    setSelection(null);
  }, []);

  const applyFilterPreset = useCallback((presetId: string) => {
    if (presetId === NO_FILTER_PRESET) {
      setActivePresetId(NO_FILTER_PRESET);
      return;
    }
    const preset = filterPresets.find((item) => item.id === presetId);
    if (!preset) return;
    applyFilterState(preset.filters);
    setPresetName(preset.name);
    setPresetStatus(`已套用过滤预设 · ${preset.name}`);
  }, [applyFilterState, filterPresets]);

  const saveFilterPreset = useCallback(() => {
    const name = presetName.trim() || defaultGraphFilterPresetName(currentFilterState);
    const existing = activePresetId !== NO_FILTER_PRESET
      ? filterPresets.find((preset) => preset.id === activePresetId)
      : filterPresets.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
    const now = new Date().toISOString();
    const nextPreset: GraphFilterPreset = {
      id: existing?.id ?? makeGraphFilterPresetId(),
      name,
      filters: currentFilterState,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const next = [
      nextPreset,
      ...filterPresets.filter((preset) => (
        preset.id !== nextPreset.id && preset.name.toLowerCase() !== name.toLowerCase()
      )),
    ];
    persistFilterPresets(next);
    setPresetName(name);
    setActivePresetId(nextPreset.id);
    setPresetStatus(`已保存过滤预设 · ${name}`);
  }, [activePresetId, currentFilterState, filterPresets, persistFilterPresets, presetName]);

  const deleteFilterPreset = useCallback(() => {
    if (activePresetId === NO_FILTER_PRESET) return;
    const preset = filterPresets.find((item) => item.id === activePresetId);
    const next = filterPresets.filter((item) => item.id !== activePresetId);
    persistFilterPresets(next);
    setActivePresetId(NO_FILTER_PRESET);
    setPresetName('');
    setPresetStatus(preset ? `已删除过滤预设 · ${preset.name}` : null);
  }, [activePresetId, filterPresets, persistFilterPresets]);

  const exportGraph = useCallback(async (format: 'json' | 'graphml') => {
    if (exportingFormat) return;
    setExportingFormat(format);
    try {
      const blob = await atlasService.exportGraph(format, { scope, limit: 5000 });
      downloadBlob(blob, `aether-atlas-${scope}-${formatDateForFilename(new Date())}.${format === 'graphml' ? 'graphml' : 'json'}`);
      setPresetStatus(`已导出 ${format === 'graphml' ? 'GraphML' : 'JSON'} · ${scope === 'all' ? '全部范围' : '我的范围'}`);
    } catch (err) {
      setError(extractApiErrorMessage(err, '导出图谱失败'));
    } finally {
      setExportingFormat(null);
    }
  }, [exportingFormat, scope]);

  const handleWheel = useCallback((event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const point = svgPointFromClient(event.currentTarget, event.clientX, event.clientY);
    zoomGraph(event.deltaY < 0 ? GRAPH_ZOOM_STEP : 1 / GRAPH_ZOOM_STEP, point);
  }, [zoomGraph]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-graph-node-id], [data-graph-edge-id]')) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: viewport,
    };
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [viewport]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const next = clampViewport({
      ...pan.origin,
      x: pan.origin.x + event.clientX - pan.startX,
      y: pan.origin.y + event.clientY - pan.startY,
    });
    if (Math.abs(event.clientX - pan.startX) > 3 || Math.abs(event.clientY - pan.startY) > 3) {
      draggedRef.current = true;
    }
    setViewport(next);
  }, []);

  const endPan = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div className="space-y-4">
      <AdminModuleHeader
        title="Aether Graph"
        description={`图谱视图 · ${nodes.length} 节点 · ${edges.length} 关系${hidden ? ` · ${hidden} 个 hub 节点已折叠` : ''}`}
        icon={Compass}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void exportGraph('json')}
              disabled={Boolean(exportingFormat)}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 text-xs hover:bg-[var(--bg-substrate)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3 w-3" /> {exportingFormat === 'json' ? '导出中' : '导出 JSON'}
            </button>
            <button
              type="button"
              onClick={() => void exportGraph('graphml')}
              disabled={Boolean(exportingFormat)}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 text-xs hover:bg-[var(--bg-substrate)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3 w-3" /> {exportingFormat === 'graphml' ? '导出中' : '导出 GraphML'}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 text-xs hover:bg-[var(--bg-substrate)]"
            >
              <RefreshCw className="h-3 w-3" /> 刷新
            </button>
          </div>
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

        <span className="hidden h-5 w-px bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] lg:inline-block" />

        <div className="w-44">
          <Select
            value={activePresetId}
            onValueChange={applyFilterPreset}
            options={filterPresetOptions}
            size="sm"
            ariaLabel="图谱过滤预设"
          />
        </div>

        <input
          type="text"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="预设名称"
          aria-label="过滤预设名称"
          className="h-8 w-36 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-substrate)] px-2 text-xs text-[var(--ink-primary)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
        />

        <button
          type="button"
          onClick={saveFilterPreset}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-2 text-[11px] text-[var(--ink-primary)] hover:bg-[var(--bg-substrate)]"
        >
          <Save className="h-3 w-3" /> 保存过滤
        </button>

        <button
          type="button"
          onClick={deleteFilterPreset}
          disabled={activePresetId === NO_FILTER_PRESET}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-2 text-[11px] text-[var(--ink-primary)] hover:bg-[var(--bg-substrate)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Trash2 className="h-3 w-3" /> 删除预设
        </button>

        {presetStatus ? (
          <span className="text-[10px] text-[var(--ink-muted)]" aria-live="polite">
            {presetStatus}
          </span>
        ) : null}
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
          <div className="relative overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)]">
            <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_92%,transparent)] p-1 shadow-sm backdrop-blur">
              <GraphIconButton label="缩小图谱" onClick={() => zoomGraph(1 / GRAPH_ZOOM_STEP)}>
                <ZoomOut className="h-3.5 w-3.5" />
              </GraphIconButton>
              <GraphIconButton label="重置视图" onClick={resetViewport}>
                <Maximize2 className="h-3.5 w-3.5" />
              </GraphIconButton>
              <GraphIconButton label="放大图谱" onClick={() => zoomGraph(GRAPH_ZOOM_STEP)}>
                <ZoomIn className="h-3.5 w-3.5" />
              </GraphIconButton>
              <span className="mx-1 h-5 w-px bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]" />
              <GraphIconButton label="保存布局" onClick={saveLayout}>
                <Save className="h-3.5 w-3.5" />
              </GraphIconButton>
              <GraphIconButton label="重置布局" onClick={resetLayout}>
                <RotateCcw className="h-3.5 w-3.5" />
              </GraphIconButton>
            </div>
            {layoutSavedAt ? (
              <p className="absolute bottom-3 left-3 z-10 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_92%,transparent)] px-2 py-1 text-[10px] text-[var(--ink-muted)] shadow-sm backdrop-blur">
                布局已保存 · {formatDate(layoutSavedAt)}
              </p>
            ) : null}
            <GraphMiniMap nodes={nodes} edges={edges} viewport={viewport} onJump={setViewport} />
            <svg
              ref={svgRef}
              aria-label="Atlas graph canvas"
              viewBox={`0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
              className="block w-full"
              data-zoom-scale={viewport.scale.toFixed(2)}
              style={{ maxHeight: 720, cursor: panRef.current ? 'grabbing' : 'grab', touchAction: 'none' }}
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onClick={() => {
                if (draggedRef.current) {
                  draggedRef.current = false;
                  return;
                }
                setSelection(null);
              }}
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

              <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
                {edges.map((e) => {
                  const a = nodes.find((n) => n.id === e.fromKpId);
                  const b = nodes.find((n) => n.id === e.toKpId);
                  if (!a || !b) return null;
                  const color = RELATION_COLORS[e.type];
                  const selected = selection?.kind === 'edge' && selection.id === e.id;
                  return (
                    <g key={e.id} data-graph-edge-id={e.id} className="cursor-pointer">
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
                      data-graph-node-id={n.id}
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
              </g>
            </svg>
          </div>

          <GraphInspector
            selection={selection}
            nodes={nodes}
            edges={edges}
            kpEvidenceCounts={kpEvidenceCounts}
            relationEvidenceCounts={relationEvidenceCounts}
            kpEvidencePreviews={kpEvidencePreviews}
            relationEvidencePreviews={relationEvidencePreviews}
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

function GraphIconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-primary)] hover:bg-[var(--bg-substrate)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklch,var(--aurora-1)_35%,transparent)]"
    >
      {children}
    </button>
  );
}

function GraphMiniMap({
  nodes,
  edges,
  viewport,
  onJump,
}: {
  nodes: Node[];
  edges: AtlasTypedRelation[];
  viewport: GraphViewport;
  onJump: (viewport: GraphViewport) => void;
}) {
  const width = 180;
  const height = 130;
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const visibleRect = getVisibleGraphRect(viewport);

  const jumpTo = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VIEWPORT_W;
    const y = ((event.clientY - rect.top) / rect.height) * VIEWPORT_H;
    onJump(clampViewport({
      ...viewport,
      x: VIEWPORT_W / 2 - x * viewport.scale,
      y: VIEWPORT_H / 2 - y * viewport.scale,
    }));
  };

  return (
    <svg
      aria-label="图谱小地图"
      viewBox={`0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
      width={width}
      height={height}
      onPointerDown={jumpTo}
      className="absolute bottom-3 right-3 z-10 cursor-crosshair rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_92%,transparent)] p-2 shadow-sm backdrop-blur"
    >
      <rect x={0} y={0} width={VIEWPORT_W} height={VIEWPORT_H} rx={22} fill="var(--bg-substrate)" opacity={0.82} />
      {edges.map((edge) => {
        const from = nodeById.get(edge.fromKpId);
        const to = nodeById.get(edge.toKpId);
        if (!from || !to) return null;
        return (
          <line
            key={edge.id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={RELATION_COLORS[edge.type]}
            strokeOpacity={0.38}
            strokeWidth={4}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {nodes.map((node) => (
        <circle
          key={node.id}
          cx={node.x}
          cy={node.y}
          r={7}
          fill={TYPE_COLORS[node.kp.type] ?? '#94a3b8'}
          fillOpacity={0.85}
        />
      ))}
      <rect
        x={visibleRect.x}
        y={visibleRect.y}
        width={visibleRect.width}
        height={visibleRect.height}
        fill="none"
        stroke="var(--ink-primary)"
        strokeWidth={8}
        vectorEffect="non-scaling-stroke"
        strokeDasharray="18 12"
      />
    </svg>
  );
}

function GraphInspector({
  selection,
  nodes,
  edges,
  kpEvidenceCounts,
  relationEvidenceCounts,
  kpEvidencePreviews,
  relationEvidencePreviews,
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
  kpEvidencePreviews: Record<string, AtlasSearchEvidencePreview>;
  relationEvidencePreviews: Record<string, AtlasSearchEvidencePreview>;
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
    const preview = evidencePreview(kpEvidencePreviews, kp.id);
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
        <EvidencePreviewBlock preview={preview} />
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
    const preview = evidencePreview(relationEvidencePreviews, selectedEdge.id);
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
        <EvidencePreviewBlock preview={preview} />
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

function EvidencePreviewBlock({ preview }: { preview?: AtlasSearchEvidencePreview }) {
  if (!preview) return null;
  return (
    <div className="mt-4 border-l-2 border-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)] pl-3">
      <p className="mb-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
        <Quote className="h-3 w-3 text-[var(--aurora-1)]" /> Evidence
      </p>
      <p className="line-clamp-4 text-xs leading-5 text-[var(--ink-primary)]">{preview.quote}</p>
      {preview.note ? (
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--ink-secondary)]">{preview.note}</p>
      ) : null}
      <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
        {preview.carrierType} · {preview.carrierTitle || `carrier #${preview.carrierId}`} · annotation #{preview.annotationId}
      </p>
    </div>
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

function evidencePreview(previews: Record<string, AtlasSearchEvidencePreview>, id: number): AtlasSearchEvidencePreview | undefined {
  return previews[String(id)];
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

function formatDateForFilename(value: Date): string {
  return value.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function readSavedGraphLayout(key: string): SavedGraphLayout | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedGraphLayout>;
    if (parsed.version !== 1 || !parsed.viewport || !parsed.positions || !parsed.savedAt) return null;
    return {
      version: 1,
      viewport: clampViewport(parsed.viewport),
      positions: parsed.positions,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function readGraphFilterPresets(key: string): GraphFilterPreset[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<SavedGraphFilterPresets>;
    if (parsed.version !== 1 || !Array.isArray(parsed.presets)) return [];
    return parsed.presets
      .map(normalizeGraphFilterPreset)
      .filter((preset): preset is GraphFilterPreset => Boolean(preset))
      .slice(0, FILTER_PRESET_LIMIT);
  } catch {
    return [];
  }
}

function normalizeGraphFilterPreset(value: unknown): GraphFilterPreset | null {
  if (!value || typeof value !== 'object') return null;
  const preset = value as Partial<GraphFilterPreset>;
  if (!preset.id || !preset.name || !preset.filters || !preset.createdAt || !preset.updatedAt) return null;
  const filters = normalizeGraphFilterState(preset.filters);
  if (!filters) return null;
  return {
    id: String(preset.id),
    name: String(preset.name).trim() || '未命名过滤',
    filters,
    createdAt: String(preset.createdAt),
    updatedAt: String(preset.updatedAt),
  };
}

function normalizeGraphFilterState(value: unknown): GraphFilterState | null {
  if (!value || typeof value !== 'object') return null;
  const filters = value as Partial<GraphFilterState>;
  if (!isTypeFilter(filters.typeFilter)) return null;
  if (!isRelationFilter(filters.relFilter)) return null;
  if (!isTimeFilter(filters.timeFilter)) return null;
  if (!isProvenanceFilter(filters.provenanceFilter)) return null;
  if (!isConfidenceFilter(filters.confidenceFilter)) return null;
  if (!isEvidenceFilter(filters.evidenceFilter)) return null;
  if (!isTopologyFilter(filters.topologyFilter)) return null;
  return {
    keyword: typeof filters.keyword === 'string' ? filters.keyword : '',
    typeFilter: filters.typeFilter,
    relFilter: filters.relFilter,
    timeFilter: filters.timeFilter,
    provenanceFilter: filters.provenanceFilter,
    confidenceFilter: filters.confidenceFilter,
    evidenceFilter: filters.evidenceFilter,
    topologyFilter: filters.topologyFilter,
    hideHubs: typeof filters.hideHubs === 'boolean' ? filters.hideHubs : true,
  };
}

function findMatchingPresetId(presets: GraphFilterPreset[], filters: GraphFilterState): string | null {
  return presets.find((preset) => graphFilterStateEquals(preset.filters, filters))?.id ?? null;
}

function graphFilterStateEquals(a: GraphFilterState, b: GraphFilterState): boolean {
  return a.keyword === b.keyword
    && a.typeFilter === b.typeFilter
    && a.relFilter === b.relFilter
    && a.timeFilter === b.timeFilter
    && a.provenanceFilter === b.provenanceFilter
    && a.confidenceFilter === b.confidenceFilter
    && a.evidenceFilter === b.evidenceFilter
    && a.topologyFilter === b.topologyFilter
    && a.hideHubs === b.hideHubs;
}

function defaultGraphFilterPresetName(filters: GraphFilterState): string {
  const parts = [
    filters.keyword.trim(),
    filters.typeFilter !== 'all' ? filters.typeFilter : '',
    filters.relFilter !== 'all' ? filters.relFilter : '',
    filters.timeFilter !== 'all' ? filters.timeFilter : '',
    filters.provenanceFilter !== 'all' ? filters.provenanceFilter : '',
    filters.confidenceFilter !== 'all' ? filters.confidenceFilter : '',
    filters.evidenceFilter !== 'all' ? filters.evidenceFilter : '',
    filters.topologyFilter !== 'all' ? filters.topologyFilter : '',
    filters.hideHubs ? 'fold-hubs' : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.slice(0, 3).join(' · ') : '默认过滤';
}

function makeGraphFilterPresetId(): string {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isTypeFilter(value: unknown): value is AtlasKnowledgePointType | 'all' {
  return value === 'all' || (typeof value === 'string' && value in TYPE_COLORS);
}

function isRelationFilter(value: unknown): value is AtlasRelationType | 'all' {
  return value === 'all' || (typeof value === 'string' && ATLAS_RELATION_TYPES.includes(value as AtlasRelationType));
}

function isTimeFilter(value: unknown): value is TimeFilter {
  return TIME_OPTIONS.some((option) => option.value === value);
}

function isProvenanceFilter(value: unknown): value is AtlasProvenance | 'all' {
  return PROVENANCE_OPTIONS.some((option) => option.value === value);
}

function isConfidenceFilter(value: unknown): value is ConfidenceFilter {
  return CONFIDENCE_OPTIONS.some((option) => option.value === value);
}

function isEvidenceFilter(value: unknown): value is EvidenceFilter {
  return EVIDENCE_OPTIONS.some((option) => option.value === value);
}

function isTopologyFilter(value: unknown): value is TopologyFilter {
  return TOPOLOGY_OPTIONS.some((option) => option.value === value);
}

function roundPosition(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampScale(scale: number): number {
  return clamp(scale, MIN_GRAPH_SCALE, MAX_GRAPH_SCALE);
}

function clampViewport(viewport: GraphViewport): GraphViewport {
  const scale = clampScale(viewport.scale);
  const margin = 80;
  const [minX, maxX] = panLimits(VIEWPORT_W, scale, margin);
  const [minY, maxY] = panLimits(VIEWPORT_H, scale, margin);
  return {
    scale,
    x: clamp(viewport.x, minX, maxX),
    y: clamp(viewport.y, minY, maxY),
  };
}

function panLimits(size: number, scale: number, margin: number): [number, number] {
  if (scale < 1) {
    return [-margin, size * (1 - scale) + margin];
  }
  return [size * (1 - scale) - margin, margin];
}

function zoomViewport(viewport: GraphViewport, factor: number, anchor: { x: number; y: number }): GraphViewport {
  const nextScale = clampScale(viewport.scale * factor);
  const worldX = (anchor.x - viewport.x) / viewport.scale;
  const worldY = (anchor.y - viewport.y) / viewport.scale;
  return clampViewport({
    scale: nextScale,
    x: anchor.x - worldX * nextScale,
    y: anchor.y - worldY * nextScale,
  });
}

function svgPointFromClient(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * VIEWPORT_W,
    y: ((clientY - rect.top) / rect.height) * VIEWPORT_H,
  };
}

function getVisibleGraphRect(viewport: GraphViewport) {
  const scale = clampScale(viewport.scale);
  const x = clamp(-viewport.x / scale, 0, VIEWPORT_W);
  const y = clamp(-viewport.y / scale, 0, VIEWPORT_H);
  return {
    x,
    y,
    width: clamp(VIEWPORT_W / scale, 0, VIEWPORT_W - x),
    height: clamp(VIEWPORT_H / scale, 0, VIEWPORT_H - y),
  };
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
