/**
 * 内容版本控制系统类型定义
 *
 * 核心功能：
 * 1. 内容快照管理
 * 2. 版本差异对比
 * 3. 撤销/重做支持
 * 4. 时间轴导航
 */

// ==================== 内容快照 ====================

export interface ContentSnapshot {
  id: string;
  timestamp: number;

  // 内容字段
  title: string;
  content: string;
  summary: string;

  // 元数据
  source: SnapshotSource;
  sourceName?: string; // AI工具名称 或 用户操作描述

  // 差异信息
  changeType: ChangeType;
  changedChars: number; // 变化的字符数 (正数=增加, 负数=减少)

  // 关联信息
  userId?: string;
  aiModel?: string; // 使用的AI模型

  // 标记
  isBookmark?: boolean; // 是否为书签版本
  bookmarkNote?: string; // 书签备注
}

export type SnapshotSource =
  | 'user-edit'      // 用户手动编辑
  | 'ai-suggestion'  // AI建议修改
  | 'auto-save'      // 自动保存
  | 'manual-save'    // 手动保存
  | 'workflow-stage' // 工作流阶段完成
  | 'import';        // 导入内容

export type ChangeType =
  | 'create'    // 新建
  | 'modify'    // 修改
  | 'major'     // 重大修改 (>30%内容变化)
  | 'minor'     // 小修改 (<10%内容变化)
  | 'ai-polish' // AI润色
  | 'ai-expand' // AI扩写
  | 'rollback'; // 回滚操作

// ==================== 差异对比 ====================

export interface DiffResult {
  additions: DiffChunk[];
  deletions: DiffChunk[];
  modifications: DiffChunk[];

  stats: {
    totalAdded: number;
    totalDeleted: number;
    totalModified: number;
  };
}

export interface DiffChunk {
  position: number;
  length: number;
  oldText?: string;
  newText?: string;
  type: 'add' | 'delete' | 'modify';
}

// ==================== 历史管理器状态 ====================

export interface HistoryState {
  snapshots: ContentSnapshot[];
  currentIndex: number; // 当前所在快照索引

  // 能力标记
  canUndo: boolean;
  canRedo: boolean;

  // 统计信息
  totalSnapshots: number;
  totalSize: number; // 占用存储空间 (bytes)
  oldestSnapshot?: ContentSnapshot;
  newestSnapshot?: ContentSnapshot;
}

// ==================== 历史管理器配置 ====================

export interface HistoryConfig {
  maxSnapshots: number;           // 最大快照数量 (默认 100)
  autoSaveInterval: number;       // 自动保存间隔 (秒, 默认 30)
  enableAutoSave: boolean;        // 是否启用自动保存

  snapshotTriggers: {
    onAiModification: boolean;    // AI修改后自动快照
    onSignificantChange: boolean; // 重大编辑后自动快照 (>100字符)
    onWorkflowStage: boolean;     // 工作流阶段完成后快照
  };

  compression: {
    enabled: boolean;              // 是否压缩存储
    minSize: number;               // 最小压缩体积 (bytes)
  };

  storage: {
    provider: 'indexeddb' | 'localstorage'; // 存储提供者
    dbName: string;                         // 数据库名称
    storeName: string;                      // 存储对象名称
  };
}

// ==================== 历史管理器操作 ====================

export interface HistoryActions {
  // 快照管理
  createSnapshot(metadata: CreateSnapshotOptions): Promise<ContentSnapshot>;
  deleteSnapshot(snapshotId: string): Promise<void>;
  clearHistory(): Promise<void>;

  // 导航
  undo(): Promise<ContentSnapshot | null>;
  redo(): Promise<ContentSnapshot | null>;
  jumpTo(snapshotId: string): Promise<ContentSnapshot>;

  // 比较
  compareSnapshots(id1: string, id2: string): Promise<DiffResult>;
  compareWithCurrent(snapshotId: string): Promise<DiffResult>;

  // 书签
  toggleBookmark(snapshotId: string, note?: string): Promise<void>;
  getBookmarks(): ContentSnapshot[];

  // 导出/导入
  exportHistory(): Promise<Blob>;
  importHistory(data: Blob): Promise<void>;
}

export interface CreateSnapshotOptions {
  title: string;
  content: string;
  summary: string;
  source: SnapshotSource;
  sourceName?: string;
  aiModel?: string;
  force?: boolean; // 强制创建 (即使内容未变化)
}

// ==================== 时间轴分组 ====================

export interface HistoryTimeline {
  today: ContentSnapshot[];
  yesterday: ContentSnapshot[];
  thisWeek: ContentSnapshot[];
  thisMonth: ContentSnapshot[];
  older: ContentSnapshot[];
}

// ==================== 历史事件 ====================

export type HistoryEvent =
  | { type: 'snapshot-created'; snapshot: ContentSnapshot }
  | { type: 'snapshot-deleted'; snapshotId: string }
  | { type: 'history-cleared' }
  | { type: 'undo'; snapshot: ContentSnapshot }
  | { type: 'redo'; snapshot: ContentSnapshot }
  | { type: 'jumped'; snapshot: ContentSnapshot }
  | { type: 'bookmark-toggled'; snapshotId: string; isBookmark: boolean };

export type HistoryEventHandler = (event: HistoryEvent) => void;
