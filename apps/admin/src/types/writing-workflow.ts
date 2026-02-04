/**
 * AI 协同写作工作流类型定义
 *
 * 核心概念：
 * 1. 写作阶段 (WritingStage) - 将创作过程分解为多个阶段
 * 2. AI 工具类型 (AiToolType) - 区分工具的使用场景
 * 3. 工作流上下文 (WorkflowContext) - 记录用户偏好和历史
 */

// ==================== 写作阶段定义 ====================

export type WritingStage =
  | 'topic-selection'    // 选题阶段
  | 'outline-planning'   // 大纲阶段
  | 'draft-generation'   // 初稿阶段
  | 'refinement'         // 精修阶段
  | 'batch-optimization' // 批量优化
  | 'final-review'       // 全文检查
  | 'publication'        // 发布准备
  | 'free-writing';      // 自由写作（跳过工作流）

export interface StageConfig {
  id: WritingStage;
  label: string;
  description: string;
  icon: string;
  aiCapabilities: AiCapability[];
  canSkip: boolean;
  autoNext: boolean; // 完成后是否自动进入下一阶段
}

// ==================== AI 工具分类 ====================

export type AiToolType =
  | 'floating'  // 随行工具 - 跟随光标，针对选中文本
  | 'global'    // 通用工具 - 在侧边栏，针对全文
  | 'hook'      // 工作流钩子 - 嵌入特定阶段
  | 'context';  // 上下文工具 - 基于当前阶段智能推荐

export interface AiCapability {
  id: string;
  label: string;
  description: string;
  type: AiToolType;
  icon: string;
  applicableStages: WritingStage[]; // 适用的阶段
  requiresSelection: boolean;        // 是否需要选中文本
  cost: 'low' | 'medium' | 'high';  // 成本估算
  hotkey?: string;                   // 快捷键
}

// ==================== 工作流上下文 ====================

export interface WorkflowContext {
  // 当前状态
  currentStage: WritingStage;
  stageHistory: WritingStage[];

  // 用户偏好（学习）
  preferredWritingStyle?: 'professional' | 'casual' | 'technical' | 'creative';
  topicPreferences?: string[]; // 用户感兴趣的主题
  writingHabits?: {
    averageWordCount: number;
    commonStructure: string[];
    favoriteTools: string[];
  };

  // 阶段产出
  selectedTopic?: TopicSuggestion;
  outline?: OutlineStructure;
  annotations?: Annotation[]; // 批注记录

  // 会话记录
  conversationHistory?: ConversationMessage[];
}

// ==================== 选题阶段 ====================

export interface TopicSuggestion {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  targetAudience: string;
  estimatedLength: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  sources?: NewsSource[]; // 相关资讯来源
  userInput?: string; // 用户输入的原始想法
}

export interface NewsSource {
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
}

// ==================== 大纲阶段 ====================

export interface OutlineStructure {
  mainTopic: string;
  keyPoints: OutlinePoint[];
  suggestedStructure: string[]; // ['引言', '主体1', '主体2', '结论']
  estimatedSections: number;
}

export interface OutlinePoint {
  id: string;
  title: string;
  description: string;
  order: number;
  subPoints?: OutlinePoint[];
  aiGenerated: boolean;
  userModified: boolean;
}

// ==================== 精修阶段 ====================

export interface Annotation {
  id: string;
  range: { from: number; to: number };
  type: 'suggestion' | 'grammar' | 'style' | 'fact-check';
  severity: 'info' | 'warning' | 'error';
  message: string;
  suggestion?: string; // AI 建议的改写
  accepted: boolean;
  timestamp: number;
}

// ==================== 批量优化 ====================

export interface BatchOptimizationTask {
  id: string;
  annotationIds: string[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
  progress: number; // 0-100
}

// ==================== AI 对话系统 ====================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'ai' | 'system';
  content: string;
  timestamp: number;
  stage: WritingStage;
  metadata?: {
    tool?: string;
    action?: string;
    result?: any;
  };
}

// ==================== 工作流配置 ====================

export interface WorkflowConfig {
  enabledStages: WritingStage[];
  stageConfigs: Record<WritingStage, Partial<StageConfig>>;
  toolVisibility: Record<string, boolean>; // 工具显示配置
  autoSaveInterval: number; // 自动保存间隔（秒）
  aiModelPreference?: {
    floatingTools: string;  // 随行工具使用的模型
    globalTools: string;    // 通用工具使用的模型
    hookTools: string;      // 工作流钩子使用的模型
  };
}

// ==================== 事件系统 ====================

export type WorkflowEvent =
  | { type: 'stage-enter'; stage: WritingStage }
  | { type: 'stage-complete'; stage: WritingStage; output: any }
  | { type: 'tool-execute'; tool: string; params: any }
  | { type: 'annotation-add'; annotation: Annotation }
  | { type: 'annotation-accept'; annotationId: string }
  | { type: 'batch-start'; taskId: string }
  | { type: 'batch-progress'; taskId: string; progress: number }
  | { type: 'batch-complete'; taskId: string; result: any };

export type WorkflowEventHandler = (event: WorkflowEvent) => void;
