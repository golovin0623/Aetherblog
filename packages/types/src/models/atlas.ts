// Atlas (Aether Knowledge) 共享类型。
//
// 与 apps/server-go/internal/knowledge/model 的 Go 结构体一一对应。
// 落地手册：docs/plan/task-aether-knowledge-system.md §2 数据骨架。
//
// 命名约定（不要破坏）：
//   * 所有 Atlas 类型一律以 Atlas 前缀；避免与既有 Note / KnowledgeBase 冲突。
//   * 字段使用 camelCase（与现有 NoteListItem 等保持一致）。
//   * 枚举值用字符串字面量联合，与 PG CHECK 约束严格对齐——后端拒绝任何越界值。

// ============================================================
// 枚举
// ============================================================

export type AtlasCarrierType =
  | 'pdf'
  | 'epub'
  | 'markdown'
  | 'web'
  | 'video'
  | 'audio'
  | 'image';

export type AtlasCarrierStatus = 'ingesting' | 'ready' | 'failed';

export type AtlasAnchorState = 'anchored' | 'soft_anchored' | 'orphan';

export type AtlasAnnotationBodyType =
  | 'highlight'
  | 'note'
  | 'image'
  | 'link'
  | 'sticker';

export type AtlasKnowledgePointType =
  | 'claim'
  | 'concept'
  | 'question'
  | 'definition'
  | 'method'
  | 'example'
  | 'person'
  | 'source';

export type AtlasKnowledgePointStatus = 'seed' | 'growing' | 'evergreen' | 'archived';

export type AtlasProvenance = 'user' | 'ai_suggested' | 'imported';

/**
 * 9 种 typed relation 全集（手册 §3 Phase 2 C2-1 严格限定，不允许扩展）。
 */
export const ATLAS_RELATION_TYPES = [
  'supports',
  'refutes',
  'specializes',
  'generalizes',
  'precedes',
  'causes',
  'similar_to',
  'cites',
  'instance_of',
] as const;
export type AtlasRelationType = (typeof ATLAS_RELATION_TYPES)[number];

// ============================================================
// W3C Web Annotation 选择器（多选择器组合）
// ============================================================

export interface TextQuoteSelector {
  type: 'TextQuoteSelector';
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface TextPositionSelector {
  type: 'TextPositionSelector';
  start: number;
  end: number;
}

export interface CssSelector {
  type: 'CssSelector';
  value: string;
}

export interface XPathSelector {
  type: 'XPathSelector';
  value: string;
}

export interface FragmentSelector {
  type: 'FragmentSelector';
  value: string;
  conformsTo?: string;
}

export interface PageRectSelector {
  type: 'PageRectSelector';
  page: number;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
}

export type AtlasSelector =
  | TextQuoteSelector
  | TextPositionSelector
  | CssSelector
  | XPathSelector
  | FragmentSelector
  | PageRectSelector;

// ============================================================
// 实体
// ============================================================

export interface AtlasCarrier {
  id: number;
  type: AtlasCarrierType;
  sourceUri: string;
  contentHash: string;
  title: string;
  author?: string | null;
  language?: string | null;
  metadata: Record<string, unknown>;
  ownerId?: number | null;
  status: AtlasCarrierStatus;
  statusMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AtlasCarrierVersion {
  id: number;
  carrierId: number;
  versionNo: number;
  contentHash: string;
  storageUri: string;
  diffFromPrev: Record<string, unknown>;
  reason: string;
  createdAt: string;
}

export interface AtlasAnnotation {
  id: number;
  carrierId: number;
  carrierVersionId?: number | null;
  selectors: AtlasSelector[];
  /** Y.RelativePosition 字节编码的 base64 表示（仅在 D1=Tiptap 时存在）。 */
  relPosition?: string | null;
  bodyType: AtlasAnnotationBodyType;
  bodyText?: string | null;
  bodyMeta: Record<string, unknown>;
  anchorState: AtlasAnchorState;
  anchorScore: number;
  authorId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AtlasKnowledgePoint {
  id: number;
  uuid: string;
  title: string;
  bodyMarkdown: string;
  type: AtlasKnowledgePointType;
  confidence: number;
  status: AtlasKnowledgePointStatus;
  authorId?: number | null;
  provenance: AtlasProvenance;
  aiSuggestionId?: number | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AtlasTypedRelation {
  id: number;
  fromKpId: number;
  toKpId: number;
  type: AtlasRelationType;
  strength: number;
  bodyMarkdown?: string | null;
  provenance: AtlasProvenance;
  aiSuggestionId?: number | null;
  authorId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AtlasRelationEvidence {
  relationId: number;
  annotationId: number;
  createdAt: string;
}

export interface AtlasSearchResponse {
  query: string;
  limit: number;
  total: number;
  knowledgePoints: AtlasKnowledgePoint[];
  annotations: AtlasAnnotation[];
  carriers: AtlasCarrier[];
}

// ============================================================
// REST 请求 / 响应
// ============================================================

export interface AtlasHealthResponse {
  ok: boolean;
  module: 'atlas';
  phase: number;
  reason?: string;
}
