// 知识脉搏 —— 工作台顶部的资产总览条。
//
// 四块指标回答同一个问题:「我的知识现在处于什么状态,能不能立刻用?」
// 数值一律 mono + tabular-nums;就绪率用墨条而不是数字堆叠;
// 图谱统计缺席时如实显示占位,不伪造 0。

import { Layers, FileCheck2, Network, NotebookPen } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { stagger, transition, variants } from '@aetherblog/ui';
import { cn } from '@/lib/utils';

export interface KnowledgePulseGraphStats {
  activeKpCount: number;
  relationCount: number;
  orphanKpCount: number;
}

export interface KnowledgePulseProps {
  /** 就绪知识库中可检索的片段总数。 */
  searchableChunks: number;
  queryableBaseCount: number;
  readyFiles: number;
  totalFiles: number;
  failedFiles: number;
  noteTotal: number;
  readableCarriers: number;
  carrierTotal: number;
  /** null = 图谱统计本次不可用。 */
  graph: KnowledgePulseGraphStats | null;
}

function formatCount(value: number): string {
  return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : '—';
}

interface PulseTile {
  key: string;
  icon: typeof Layers;
  label: string;
  value: string;
  detail: string;
  tone: 'accent' | 'success' | 'warning' | 'neutral';
  /** 0..1;undefined 表示该块不渲染墨条。 */
  ratio?: number;
}

export function KnowledgePulse(props: KnowledgePulseProps) {
  const reducedMotion = useReducedMotion();
  const {
    searchableChunks,
    queryableBaseCount,
    readyFiles,
    totalFiles,
    failedFiles,
    noteTotal,
    readableCarriers,
    carrierTotal,
    graph,
  } = props;

  const readyRatio = totalFiles > 0 ? Math.min(1, Math.max(0, readyFiles / totalFiles)) : 0;

  const tiles: PulseTile[] = [
    {
      key: 'chunks',
      icon: Layers,
      label: '可检索片段',
      value: formatCount(searchableChunks),
      detail:
        queryableBaseCount > 0
          ? `来自 ${formatCount(queryableBaseCount)} 个就绪知识库`
          : '还没有就绪的知识库',
      tone: queryableBaseCount > 0 ? 'accent' : 'neutral',
    },
    {
      key: 'readiness',
      icon: FileCheck2,
      label: '资料就绪',
      value: totalFiles > 0 ? `${formatCount(readyFiles)}/${formatCount(totalFiles)}` : '0',
      detail:
        failedFiles > 0
          ? `${formatCount(failedFiles)} 份处理失败，待处理`
          : totalFiles > 0
            ? '全部资料可用于求证'
            : '添加资料后开始索引',
      tone: failedFiles > 0 ? 'warning' : totalFiles > 0 ? 'success' : 'neutral',
      ratio: readyRatio,
    },
    {
      key: 'graph',
      icon: Network,
      label: '知识图谱',
      value: graph ? formatCount(graph.activeKpCount) : '—',
      detail: graph
        ? `${formatCount(graph.relationCount)} 条关系 · ${formatCount(graph.orphanKpCount)} 个孤点`
        : '图谱统计暂不可用',
      tone: graph ? 'accent' : 'neutral',
    },
    {
      key: 'notes',
      icon: NotebookPen,
      label: '笔记 · 读物',
      value: formatCount(noteTotal),
      detail:
        carrierTotal > 0
          ? `${formatCount(readableCarriers)}/${formatCount(carrierTotal)} 份读物可读`
          : '暂无 Atlas 读物',
      tone: 'neutral',
    },
  ];

  return (
    <motion.section
      aria-label="知识资产总览"
      className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      initial="initial"
      animate="animate"
      variants={{ initial: {}, animate: { transition: reducedMotion ? undefined : stagger(45) } }}
    >
      {tiles.map((tile) => (
        <motion.div
          key={tile.key}
          className="intelligence-metric"
          data-tone={tile.tone}
          variants={reducedMotion ? variants.fade : variants.fadeUp}
          transition={transition.quick}
        >
          <div className="flex items-center gap-2 text-xs text-[var(--intelligence-muted)]">
            <tile.icon className="h-4 w-4" aria-hidden="true" />
            <span className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.16em]">
              {tile.label}
            </span>
          </div>
          <div className="intelligence-metric-value">{tile.value}</div>
          {tile.ratio !== undefined && (
            <div
              className="intelligence-pulse-bar"
              role="progressbar"
              aria-valuenow={Math.round(tile.ratio * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="资料就绪率"
            >
              <motion.span
                className={cn(
                  'intelligence-pulse-bar-fill',
                  tile.tone === 'warning' && 'intelligence-pulse-bar-fill-warning',
                )}
                initial={reducedMotion ? false : { scaleX: 0 }}
                animate={{ scaleX: tile.ratio }}
                transition={transition.flow}
                style={{ transformOrigin: 'left center' }}
              />
            </div>
          )}
          <div className="intelligence-metric-detail">{tile.detail}</div>
        </motion.div>
      ))}
    </motion.section>
  );
}
