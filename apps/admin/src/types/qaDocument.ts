/**
 * QA 文档工作流程类型
 * 镜像 docs/features/qa-document-workflow.md 中定义的合同
 */

// §1 状态机
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

// §2 分割粒度
export type SplitGranularity = 'COARSE' | 'STANDARD' | 'FINE' | 'ULTRA_FINE';

export const SPLIT_GRANULARITY_LABELS: Record<SplitGranularity, string> = {
  COARSE: '粗略',
  STANDARD: '标准',
  FINE: '精细',
  ULTRA_FINE: '极精细',
};

// block_type 全套 (§2)
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

// §3 规范文档树节点
export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** 与合约'bbox'形状匹配的别名*/
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

// 注释类别
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

// §4 补丁提案
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

// §5 差异
export type DiffLevel = 'CHAR' | 'FIELD' | 'STRUCTURE';

export interface CharDiffToken {
  t: string;
  op: '=' | '-' | '+';
}

/** 别名匹配 docs/features/qa-document-workflow.md §5 */
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

// 管道作业
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

// QA 文档主要实体
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

// 来自 qa_questions 的已发布问题
export interface QaQuestion {
  id: string;
  documentId: string;
  stableKey: string;
  versionId: string;
  fieldPath: string;
  content: Record<string, unknown>;
  createdAt: string;
}

// 审核日志条目
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

// 列表/过滤参数
export interface QaDocumentListParams {
  pageNum?: number;
  pageSize?: number;
  status?: QaDocumentStatus;
  keyword?: string;
}
