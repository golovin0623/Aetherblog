import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  WritingStage,
  WorkflowContext,
  WorkflowConfig,
  WorkflowEvent,
  WorkflowEventHandler,
  Annotation,
  TopicSuggestion,
  OutlineStructure,
} from '@/types/writing-workflow';

/**
 * 写作工作流核心 Hook
 *
 * 功能：
 * 1. 阶段状态管理
 * 2. 上下文持久化
 * 3. 事件系统
 * 4. 学习用户偏好
 */

const DEFAULT_CONFIG: WorkflowConfig = {
  enabledStages: [
    'topic-selection',
    'outline-planning',
    'draft-generation',
    'refinement',
    'batch-optimization',
    'final-review',
    'publication',
  ],
  stageConfigs: {
    'topic-selection': {},
    'outline-planning': {},
    'draft-generation': {},
    refinement: {},
    'batch-optimization': {},
    'final-review': {},
    publication: {},
    'free-writing': {},
  },
  toolVisibility: {},
  autoSaveInterval: 30,
};

interface UseWritingWorkflowOptions {
  postId?: string;
  initialContext?: Partial<WorkflowContext>;
  config?: Partial<WorkflowConfig>;
  onEvent?: WorkflowEventHandler;
}

export function useWritingWorkflow(options: UseWritingWorkflowOptions = {}) {
  const { postId, initialContext, config: userConfig, onEvent } = options;

  // 合并配置
  const config: WorkflowConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
  };

  // 工作流上下文
  const [context, setContext] = useState<WorkflowContext>(() => {
    // 尝试从 localStorage 恢复
    const cached = postId ? loadContextFromCache(postId) : null;
    return {
      currentStage: 'topic-selection',
      stageHistory: [],
      ...cached,
      ...initialContext,
    };
  });

  // 事件监听器
  const eventHandlers = useRef<WorkflowEventHandler[]>([]);
  if (onEvent) {
    eventHandlers.current = [onEvent];
  }

  // 触发事件
  const emitEvent = useCallback((event: WorkflowEvent) => {
    eventHandlers.current.forEach(handler => handler(event));
  }, []);

  // ==================== 阶段控制 ====================

  const enterStage = useCallback((stage: WritingStage) => {
    setContext(prev => ({
      ...prev,
      currentStage: stage,
      stageHistory: [...prev.stageHistory, prev.currentStage],
    }));
    emitEvent({ type: 'stage-enter', stage });
  }, [emitEvent]);

  const completeStage = useCallback((output: any) => {
    const stage = context.currentStage;
    emitEvent({ type: 'stage-complete', stage, output });

    // 根据阶段保存产出
    setContext(prev => {
      const updated = { ...prev };
      switch (stage) {
        case 'topic-selection':
          updated.selectedTopic = output as TopicSuggestion;
          break;
        case 'outline-planning':
          updated.outline = output as OutlineStructure;
          break;
        case 'refinement':
          updated.annotations = output as Annotation[];
          break;
      }
      return updated;
    });

    // 自动进入下一阶段（可配置）
    const stageIndex = config.enabledStages.indexOf(stage);
    if (stageIndex >= 0 && stageIndex < config.enabledStages.length - 1) {
      const nextStage = config.enabledStages[stageIndex + 1];
      enterStage(nextStage);
    }
  }, [context.currentStage, config.enabledStages, emitEvent, enterStage]);

  const skipStage = useCallback(() => {
    const stageIndex = config.enabledStages.indexOf(context.currentStage);
    if (stageIndex >= 0 && stageIndex < config.enabledStages.length - 1) {
      const nextStage = config.enabledStages[stageIndex + 1];
      enterStage(nextStage);
    }
  }, [context.currentStage, config.enabledStages, enterStage]);

  const goBackToPreviousStage = useCallback(() => {
    const prevStage = context.stageHistory[context.stageHistory.length - 1];
    if (prevStage) {
      setContext(prev => ({
        ...prev,
        currentStage: prevStage,
        stageHistory: prev.stageHistory.slice(0, -1),
      }));
    }
  }, [context.stageHistory]);

  // ==================== 对话系统 ====================

  const addConversation = useCallback((role: 'user' | 'ai', content: string, metadata?: any) => {
    const message = {
      id: `msg-${Date.now()}-${Math.random()}`,
      role,
      content,
      timestamp: Date.now(),
      stage: context.currentStage,
      metadata,
    };

    setContext(prev => ({
      ...prev,
      conversationHistory: [...(prev.conversationHistory || []), message],
    }));

    return message;
  }, [context.currentStage]);

  // ==================== 批注系统 ====================

  const addAnnotation = useCallback((annotation: Omit<Annotation, 'id' | 'timestamp'>) => {
    const newAnnotation: Annotation = {
      ...annotation,
      id: `anno-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      accepted: false,
    };

    setContext(prev => ({
      ...prev,
      annotations: [...(prev.annotations || []), newAnnotation],
    }));

    emitEvent({ type: 'annotation-add', annotation: newAnnotation });
    return newAnnotation;
  }, [emitEvent]);

  const acceptAnnotation = useCallback((annotationId: string) => {
    setContext(prev => ({
      ...prev,
      annotations: prev.annotations?.map(a =>
        a.id === annotationId ? { ...a, accepted: true } : a
      ),
    }));
    emitEvent({ type: 'annotation-accept', annotationId });
  }, [emitEvent]);

  const rejectAnnotation = useCallback((annotationId: string) => {
    setContext(prev => ({
      ...prev,
      annotations: prev.annotations?.filter(a => a.id !== annotationId),
    }));
  }, []);

  // ==================== 学习系统 ====================

  const recordToolUsage = useCallback((toolId: string) => {
    setContext(prev => ({
      ...prev,
      writingHabits: {
        ...prev.writingHabits,
        favoriteTools: [
          toolId,
          ...(prev.writingHabits?.favoriteTools || []).filter(t => t !== toolId),
        ].slice(0, 10), // 保留前10个常用工具
      } as any,
    }));
  }, []);

  const updatePreferences = useCallback((preferences: Partial<WorkflowContext>) => {
    setContext(prev => ({
      ...prev,
      ...preferences,
    }));
  }, []);

  // ==================== 持久化 ====================

  useEffect(() => {
    if (!postId) return;

    const timer = setInterval(() => {
      saveContextToCache(postId, context);
    }, config.autoSaveInterval * 1000);

    return () => clearInterval(timer);
  }, [postId, context, config.autoSaveInterval]);

  // 手动保存
  const saveContext = useCallback(() => {
    if (postId) {
      saveContextToCache(postId, context);
    }
  }, [postId, context]);

  // 重置工作流
  const resetWorkflow = useCallback(() => {
    setContext({
      currentStage: 'topic-selection',
      stageHistory: [],
    });
    if (postId) {
      localStorage.removeItem(`workflow-context-${postId}`);
    }
  }, [postId]);

  // ==================== 工具方法 ====================

  const canGoBack = context.stageHistory.length > 0;
  const canSkip = config.enabledStages.indexOf(context.currentStage) <
    config.enabledStages.length - 1;

  const progress = {
    current: config.enabledStages.indexOf(context.currentStage) + 1,
    total: config.enabledStages.length,
    percentage: Math.round(
      ((config.enabledStages.indexOf(context.currentStage) + 1) /
        config.enabledStages.length) *
        100
    ),
  };

  return {
    // 状态
    context,
    config,
    progress,

    // 阶段控制
    enterStage,
    completeStage,
    skipStage,
    goBackToPreviousStage,
    canGoBack,
    canSkip,

    // 对话
    addConversation,

    // 批注
    addAnnotation,
    acceptAnnotation,
    rejectAnnotation,

    // 学习
    recordToolUsage,
    updatePreferences,

    // 持久化
    saveContext,
    resetWorkflow,

    // 事件
    emitEvent,
  };
}

// ==================== 辅助函数 ====================

function loadContextFromCache(postId: string): Partial<WorkflowContext> | null {
  try {
    const cached = localStorage.getItem(`workflow-context-${postId}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function saveContextToCache(postId: string, context: WorkflowContext) {
  try {
    localStorage.setItem(`workflow-context-${postId}`, JSON.stringify(context));
  } catch (error) {
    console.error('Failed to save workflow context:', error);
  }
}
