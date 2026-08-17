// 统一检索模型 —— 知识工作台「跨域聚合检索」的纯逻辑层。
//
// 把三条已存在的检索链路（知识库向量检索 / Atlas 关键词+语义 / 笔记关键词）
// 归一成同一种「知识原子」呈现，并对每条泳道的降级状态负责：
// 任何一路失败都必须转成可见的泳道状态，不允许静默丢失。
//
// ref: 系统需求企划书及详细设计.md §RAG 检索链路；契约见
// services/knowledgeWorkspaceHandoff.ts（pin 产出的 KnowledgeContextRef
// 必须能原样进入既有 handoff 校验）。

import type { AtlasCarrier, AtlasSearchResponse } from '@aetherblog/types';
import type {
  KnowledgeBase,
  KnowledgeBaseRetrievalResponse,
} from '@/services/knowledgeBaseService';
import type { KnowledgeContextRef } from '@/services/knowledgeWorkspaceHandoff';
import type { NoteListItem } from '@/types/note';
import { carrierReaderHref } from '@/pages/atlas/carrierReaderHref';
import { kpTypeLabel } from '@/pages/atlas/atlasLabels';
import {
  canUseKnowledgeBase,
  getKnowledgeBaseReadiness,
} from '@/pages/knowledge/knowledgeBaseReadiness';

export type RetrievalLane = 'kb' | 'atlas' | 'notes';

export type KnowledgeAtomKind =
  | 'kb-chunk'
  | 'atlas-kp'
  | 'atlas-annotation'
  | 'atlas-carrier'
  | 'note';

/**
 * 知识原子 —— 一次统一检索命中的最小可操作单元。
 * 无论来自哪条链路，都携带同样的四件事:出处、内容、可信度、下一步动作。
 */
export interface KnowledgeAtom {
  key: string;
  lane: RetrievalLane;
  kind: KnowledgeAtomKind;
  title: string;
  snippet: string;
  /** 归一化相似度(0..1);未知量纲一律置 null,绝不显示臆造数字。 */
  score: number | null;
  sourceLabel: string;
  href: string | null;
  /** 可固定为本次任务来源时给出既有契约的 ref;否则为 null。 */
  pinRef: KnowledgeContextRef | null;
  /** 「就此提问」引用的原文短句。 */
  quote: string | null;
}

export type RetrievalLaneState = 'ready' | 'empty' | 'degraded' | 'error';

export interface RetrievalLaneOutcome {
  lane: RetrievalLane;
  state: RetrievalLaneState;
  atoms: KnowledgeAtom[];
  /** 状态说明:degraded/error 必填,ready/empty 视信息量而定。 */
  detail: string | null;
}

/** 单次统一检索最多并行探询的知识库数 —— 限制扇出成本。 */
export const MAX_KB_RETRIEVAL_TARGETS = 6;
export const KB_HITS_PER_BASE = 4;
export const ATLAS_SEARCH_LIMIT = 8;
export const NOTE_SEARCH_LIMIT = 6;

const SNIPPET_MAX_LENGTH = 220;
const QUOTE_MAX_LENGTH = 160;
const ASK_SEED_MAX_LENGTH = 600;

export type QueryableKnowledgeBaseInput = Pick<
  KnowledgeBase,
  | 'kind'
  | 'fileCount'
  | 'vectorizedCount'
  | 'failedCount'
  | 'chunkCount'
  | 'activeProfileId'
  | 'activeProfile'
  | 'effectivePermission'
>;

/** USE 权限 + 索引就绪才允许对该库发起检索(与既有工作台契约一致)。 */
export function isKnowledgeBaseQueryable(kb: QueryableKnowledgeBaseInput): boolean {
  return (
    canUseKnowledgeBase(kb.effectivePermission) &&
    getKnowledgeBaseReadiness({
      kind: kb.kind,
      fileCount: kb.fileCount,
      vectorizedCount: kb.vectorizedCount,
      failedCount: kb.failedCount,
      chunkCount: kb.chunkCount,
      hasActiveProfile: Boolean(kb.activeProfileId || kb.activeProfile),
    }) === 'ready'
  );
}

export interface KbRetrievalTarget {
  id: number;
  slug: string;
  name: string;
}

export interface KbRetrievalPlan {
  targets: KbRetrievalTarget[];
  /** 因扇出上限被跳过的就绪库数量 —— UI 必须如实展示,不许静默截断。 */
  skippedReadyCount: number;
}

type KbPlanInput = Pick<KnowledgeBase, 'id' | 'slug' | 'name' | 'updatedAt'> &
  QueryableKnowledgeBaseInput;

/** 挑选本次扇出的知识库:仅就绪库,最近活跃优先,超出上限的如实计数。 */
export function planKbRetrievalTargets(bases: readonly KbPlanInput[]): KbRetrievalPlan {
  const queryable = bases
    .filter(isKnowledgeBaseQueryable)
    .slice()
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt);
      const rightTime = Date.parse(right.updatedAt);
      const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
      const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
      return safeRight - safeLeft;
    });
  return {
    targets: queryable
      .slice(0, MAX_KB_RETRIEVAL_TARGETS)
      .map((kb) => ({ id: kb.id, slug: kb.slug, name: kb.name })),
    skippedReadyCount: Math.max(0, queryable.length - MAX_KB_RETRIEVAL_TARGETS),
  };
}

/** 相似度只信任 0..1 的量纲;其余(含负数、>1、NaN)一律 null。 */
export function normalizeRetrievalScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

function clampText(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/** 摘要场景的轻量 Markdown 去噪 —— 只求可读,不做完整解析。 */
export function stripMarkdownLite(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildKbAtoms(
  base: KbRetrievalTarget,
  response: KnowledgeBaseRetrievalResponse,
): KnowledgeAtom[] {
  if (response.status !== 'matched') return [];
  return response.hits.map((hit) => {
    const snippet = clampText(hit.snippet, SNIPPET_MAX_LENGTH);
    return {
      key: `kb:${base.id}:${hit.fileId}:${hit.chunkIndex}`,
      lane: 'kb' as const,
      kind: 'kb-chunk' as const,
      title: hit.title.trim() || base.name,
      snippet,
      score: normalizeRetrievalScore(hit.score),
      sourceLabel: `${base.name} · 片段 ${hit.chunkIndex + 1}`,
      href: `/intelligence/knowledge/${base.slug}`,
      pinRef: { kind: 'knowledge-base', id: base.id, label: base.name },
      quote: clampText(hit.snippet, QUOTE_MAX_LENGTH) || null,
    };
  });
}

const CARRIER_TYPE_LABELS: Record<AtlasCarrier['type'], string> = {
  pdf: 'PDF 文档',
  epub: '电子书',
  markdown: 'Markdown',
  blog_post: '博客文章',
  web: '网页',
  video: '视频转写',
  audio: '音频转写',
  image: '图像',
};

export function buildAtlasAtoms(response: AtlasSearchResponse): KnowledgeAtom[] {
  const carriersById = new Map(response.carriers.map((carrier) => [carrier.id, carrier]));

  const kpAtoms: KnowledgeAtom[] = response.knowledgePoints.map((kp) => {
    const evidence = kp.evidencePreview ?? null;
    const body = stripMarkdownLite(kp.bodyMarkdown);
    return {
      key: `atlas-kp:${kp.id}`,
      lane: 'atlas' as const,
      kind: 'atlas-kp' as const,
      title: kp.title,
      snippet: clampText(body || evidence?.quote || '', SNIPPET_MAX_LENGTH),
      score: normalizeRetrievalScore(kp.searchScore),
      sourceLabel: evidence
        ? `知识点 · ${kpTypeLabel(kp.type)} · 证据自《${evidence.carrierTitle}》`
        : `知识点 · ${kpTypeLabel(kp.type)}`,
      href: `/atlas/kp/${kp.id}`,
      pinRef: { kind: 'atlas-kp', id: kp.id, label: kp.title },
      quote: evidence?.quote ? clampText(evidence.quote, QUOTE_MAX_LENGTH) : null,
    };
  });

  const annotationAtoms: KnowledgeAtom[] = response.annotations
    .filter((annotation) => Boolean(annotation.bodyText?.trim()))
    .map((annotation) => {
      const carrier = carriersById.get(annotation.carrierId);
      const text = annotation.bodyText?.trim() ?? '';
      return {
        key: `atlas-annotation:${annotation.id}`,
        lane: 'atlas' as const,
        kind: 'atlas-annotation' as const,
        title: carrier ? `《${carrier.title}》中的批注` : '阅读批注',
        snippet: clampText(text, SNIPPET_MAX_LENGTH),
        score: null,
        sourceLabel: carrier
          ? `批注 · ${CARRIER_TYPE_LABELS[carrier.type] ?? carrier.type}`
          : '批注',
        href: carrier ? carrierReaderHref(carrier) : null,
        pinRef: null,
        quote: clampText(text, QUOTE_MAX_LENGTH) || null,
      };
    });

  const carrierAtoms: KnowledgeAtom[] = response.carriers.map((carrier) => ({
    key: `atlas-carrier:${carrier.id}`,
    lane: 'atlas' as const,
    kind: 'atlas-carrier' as const,
    title: carrier.title,
    snippet: carrier.author ? `作者:${carrier.author}` : '',
    score: null,
    sourceLabel: `读物 · ${CARRIER_TYPE_LABELS[carrier.type] ?? carrier.type}`,
    href: carrierReaderHref(carrier),
    pinRef: null,
    quote: null,
  }));

  return [...kpAtoms, ...annotationAtoms, ...carrierAtoms];
}

export function buildNoteAtoms(notes: readonly NoteListItem[]): KnowledgeAtom[] {
  return notes.map((note) => ({
    key: `note:${note.id}`,
    lane: 'notes' as const,
    kind: 'note' as const,
    title: note.title.trim() || '未命名笔记',
    snippet: clampText(note.summary ?? '', SNIPPET_MAX_LENGTH),
    score: null,
    sourceLabel: note.folderName ? `笔记 · ${note.folderName}` : '笔记',
    href: `/notes/${note.id}/edit`,
    pinRef: null,
    quote: note.summary ? clampText(note.summary, QUOTE_MAX_LENGTH) : null,
  }));
}

/** 有分数者按分数降序,无分数者保持原有顺序排在其后。 */
export function rankAtoms(atoms: readonly KnowledgeAtom[]): KnowledgeAtom[] {
  const scored = atoms.filter((atom) => atom.score !== null);
  const unscored = atoms.filter((atom) => atom.score === null);
  scored.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  return [...scored, ...unscored];
}

export type KbLaneSettledResult =
  | { target: KbRetrievalTarget; ok: true; response: KnowledgeBaseRetrievalResponse }
  | { target: KbRetrievalTarget; ok: false };

export function resolveKbLaneOutcome(
  results: readonly KbLaneSettledResult[],
  skippedReadyCount: number,
): RetrievalLaneOutcome {
  if (results.length === 0) {
    return {
      lane: 'kb',
      state: 'empty',
      atoms: [],
      detail: '当前没有就绪的知识库可供检索。',
    };
  }
  const atoms = rankAtoms(
    results.flatMap((item) =>
      item.ok ? buildKbAtoms(item.target, item.response) : [],
    ),
  );
  const failedNames = results
    .filter((item) => !item.ok || item.response.status === 'unavailable')
    .map((item) => item.target.name);
  const skippedNote =
    skippedReadyCount > 0
      ? `本次仅检索最近活跃的 ${results.length} 个知识库，另有 ${skippedReadyCount} 个就绪库未参与。`
      : null;

  if (failedNames.length === results.length) {
    return {
      lane: 'kb',
      state: 'error',
      atoms: [],
      detail: '知识库检索暂时不可用，请稍后重试。',
    };
  }
  if (failedNames.length > 0) {
    return {
      lane: 'kb',
      state: 'degraded',
      atoms,
      detail: [`${failedNames.join('、')} 本次未完成检索，结果不含其内容。`, skippedNote]
        .filter(Boolean)
        .join(' '),
    };
  }
  if (atoms.length === 0) {
    return {
      lane: 'kb',
      state: 'empty',
      atoms: [],
      detail: skippedNote ?? '已就绪的资料中没有达到相关度门槛的片段。',
    };
  }
  return { lane: 'kb', state: 'ready', atoms, detail: skippedNote };
}

export type AtlasLaneSettledResult =
  | { ok: true; response: AtlasSearchResponse }
  | { ok: false };

export function resolveAtlasLaneOutcome(result: AtlasLaneSettledResult): RetrievalLaneOutcome {
  if (!result.ok) {
    return {
      lane: 'atlas',
      state: 'error',
      atoms: [],
      detail: '知识图集检索暂时不可用，请稍后重试。',
    };
  }
  const atoms = rankAtoms(buildAtlasAtoms(result.response));
  const semanticFellBack =
    result.response.semanticEnabled === true && result.response.semanticAvailable === false;
  if (atoms.length === 0) {
    return {
      lane: 'atlas',
      state: 'empty',
      atoms: [],
      detail: semanticFellBack ? '语义检索暂不可用，本次仅做了关键词匹配。' : null,
    };
  }
  if (semanticFellBack) {
    return {
      lane: 'atlas',
      state: 'degraded',
      atoms,
      detail: '语义检索暂不可用，以下为关键词匹配结果。',
    };
  }
  return { lane: 'atlas', state: 'ready', atoms, detail: null };
}

export type NotesLaneSettledResult =
  | { ok: true; notes: readonly NoteListItem[] }
  | { ok: false };

export function resolveNotesLaneOutcome(result: NotesLaneSettledResult): RetrievalLaneOutcome {
  if (!result.ok) {
    return {
      lane: 'notes',
      state: 'error',
      atoms: [],
      detail: '笔记检索暂时不可用，请稍后重试。',
    };
  }
  const atoms = buildNoteAtoms(result.notes);
  if (atoms.length === 0) {
    return { lane: 'notes', state: 'empty', atoms: [], detail: null };
  }
  return { lane: 'notes', state: 'ready', atoms, detail: null };
}

/**
 * 「就此提问」的目标草稿:引用出处与原文短句,把补完问题留给用户。
 * 不预设结论,不替用户发明意图。
 */
export function buildAskSeed(atom: Pick<KnowledgeAtom, 'title' | 'sourceLabel' | 'quote' | 'snippet'>): string {
  const excerpt = atom.quote ?? atom.snippet;
  const lines = [`关于「${atom.title}」（${atom.sourceLabel}）:`];
  if (excerpt) lines.push(`「${excerpt}」`);
  lines.push('', '我想确认:');
  return clampText2(lines.join('\n'), ASK_SEED_MAX_LENGTH);
}

/** clampText 的多行版本:保留换行,仅限制总长。 */
function clampText2(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}
