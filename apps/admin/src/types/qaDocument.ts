/**
 * QA Document Workflow types
 * Mirrors the contract defined in docs/features/qa-document-workflow.md
 */

// §1 Status Machine
export type QaDocumentStatus =
  | 'UPLOADED'
  | 'PREPROCESSING'
  | 'SEGMENTED'
  | 'OCR_DONE'
  | 'STRUCTURED'
  | 'REVIEW_READY'
  | 'ANNOTATED'
  | 'AGENT_RUNNING'
  | 'PATCH_PROPOSED'
  | 'MERGED'
  | 'DIFF_READY'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'FAILED';

// §2 Split Granularity
export type SplitGranularity = 'COARSE' | 'STANDARD' | 'FINE' | 'ULTRA_FINE';

export const SPLIT_GRANULARITY_LABELS: Record<SplitGranularity, string> = {
  COARSE: '粗略',
  STANDARD: '标准',
  FINE: '精细',
  ULTRA_FINE: '极精细',
};

// block_type full set (§2)
export type BlockType =
  | 'PAGE'
  | 'BLOCK'
  | 'QUESTION'
  | 'STEM'
  | 'OPTION'
  | 'ANSWER'
  | 'ANALYSIS'
  | 'SUB_QUESTION'
  | 'FORMULA'
  | 'TABLE'
  | 'TABLE_CELL';

// §3 Canonical Document Tree Node
export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Alias matching the contract's 'bbox' shape */
export type BBox = BoundingBox;

export interface CanonicalNode {
  id?: string;
  stableKey: string;
  blockType: BlockType;
  pageNo: number;
  bbox: BoundingBox;
  text: string;
  confidence: number;
  sourceCropUrl: string;
  orderIndex: number;
  fieldPath: string;
  children: CanonicalNode[];
}

// Annotation category
export type AnnotationCategory =
  | '错字'
  | '漏字'
  | '公式错'
  | '表格错'
  | '题号错'
  | '拆分错'
  | '答案错'
  | '解析错';

export type AnnotationStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

export interface QaAnnotation {
  id: string;
  documentId: string;
  blockId: string;
  stableKey: string;
  category: AnnotationCategory;
  originalText?: string;
  correctedText?: string;
  note?: string;
  status: AnnotationStatus;
  createdAt: string;
  updatedAt: string;
}

// §4 Patch Proposal
export type PatchOp =
  | 'replace_text'
  | 'update_field'
  | 'insert_block'
  | 'delete_block'
  | 'split_block'
  | 'merge_block';

export interface PatchOperation {
  op: PatchOp;
  stableKey: string;
  fieldPath?: string;
  oldValue?: string;
  newValue?: string;
  reason: string;
  confidence: number;
}

export interface QaPatch {
  id: string;
  documentId: string;
  summary: string;
  operations: PatchOperation[];
  status: 'PROPOSED' | 'MERGED' | 'APPROVED' | 'REJECTED' | 'CONFLICT';
  createdAt: string;
  updatedAt: string;
}

// §5 Diff
export type DiffLevel = 'CHAR' | 'FIELD' | 'STRUCTURE';

export interface CharDiffToken {
  t: string;
  op: '=' | '-' | '+';
}

/** Alias matching docs/features/qa-document-workflow.md §5 */
export type CharDiffEntry = CharDiffToken;

export interface DiffChange {
  stableKey: string;
  fieldPath?: string;
  kind: 'modified' | 'added' | 'deleted' | 'moved';
  before?: string;
  after?: string;
  charDiff?: CharDiffToken[];
}

export interface DiffConflict {
  stableKey: string;
  reason: string;
}

export interface QaDiff {
  id: string;
  documentId: string;
  level: DiffLevel;
  fromVersion: number;
  toVersion: number;
  changes: DiffChange[];
  conflicts: DiffConflict[];
  hasConflict: boolean;
  createdAt: string;
}

// Pipeline Job
export interface QaJob {
  id: string;
  documentId: string;
  stage: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  attempt: number;
  log?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

// QA Document main entity
export interface QaDocument {
  id: string;
  title: string;
  status: QaDocumentStatus;
  splitGranularity: SplitGranularity;
  currentVersion: number;
  mediaFileId?: string;
  fileUrl?: string;
  pageCount?: number;
  createdAt: string;
  updatedAt: string;
  jobs?: QaJob[];
}

// Published question from qa_questions
export interface QaQuestion {
  id: string;
  documentId: string;
  stableKey: string;
  versionId: string;
  fieldPath: string;
  content: Record<string, unknown>;
  createdAt: string;
}

// Audit log entry
export interface QaAuditLog {
  id: string;
  documentId: string;
  action: string;
  fromStatus?: QaDocumentStatus;
  toStatus?: QaDocumentStatus;
  userId?: string;
  detail?: string;
  createdAt: string;
}

// List/filter params
export interface QaDocumentListParams {
  pageNum?: number;
  pageSize?: number;
  status?: QaDocumentStatus;
  keyword?: string;
}
