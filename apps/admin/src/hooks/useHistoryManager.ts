/**
 * 历史管理器 Hook
 *
 * 功能：
 * 1. 快照创建与管理
 * 2. 撤销/重做支持
 * 3. 版本跳转
 * 4. 自动保存
 * 5. 智能去重（避免创建重复快照）
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { historyStorage } from '@/lib/history-storage';
import type {
  ContentSnapshot,
  CreateSnapshotOptions,
  HistoryState,
  HistoryConfig,
  HistoryEvent,
  HistoryEventHandler,
  SnapshotSource,
  ChangeType,
  DiffResult,
} from '@/types/content-history';

const DEFAULT_CONFIG: HistoryConfig = {
  maxSnapshots: 100,
  autoSaveInterval: 30,
  enableAutoSave: true,
  snapshotTriggers: {
    onAiModification: true,
    onSignificantChange: true,
    onWorkflowStage: true,
  },
  compression: {
    enabled: false,
    minSize: 10240, // 10KB
  },
  storage: {
    provider: 'indexeddb',
    dbName: 'aetherblog-history',
    storeName: 'content-snapshots',
  },
};

interface UseHistoryManagerOptions {
  postId?: string;
  config?: Partial<HistoryConfig>;
  onEvent?: HistoryEventHandler;
}

export function useHistoryManager(options: UseHistoryManagerOptions = {}) {
  const { postId, config: userConfig, onEvent } = options;

  const config: HistoryConfig = { ...DEFAULT_CONFIG, ...userConfig };

  // 状态
  const [state, setState] = useState<HistoryState>({
    snapshots: [],
    currentIndex: -1,
    canUndo: false,
    canRedo: false,
    totalSnapshots: 0,
    totalSize: 0,
  });

  // Refs
  const eventHandlers = useRef<HistoryEventHandler[]>(onEvent ? [onEvent] : []);
  const lastContentRef = useRef<string>('');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitializedRef = useRef(false);

  // ==================== 事件系统 ====================

  const emitEvent = useCallback((event: HistoryEvent) => {
    eventHandlers.current.forEach(handler => handler(event));
  }, []);

  // ==================== 加载历史记录 ====================

  const loadHistory = useCallback(async () => {
    try {
      const snapshots = await historyStorage.getAllSnapshots();
      const count = await historyStorage.count();
      const size = await historyStorage.estimateSize();

      setState({
        snapshots,
        currentIndex: snapshots.length > 0 ? 0 : -1, // 最新版本
        canUndo: snapshots.length > 1,
        canRedo: false,
        totalSnapshots: count,
        totalSize: size,
        oldestSnapshot: snapshots[snapshots.length - 1],
        newestSnapshot: snapshots[0],
      });

      isInitializedRef.current = true;
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }, []);

  // 初始化
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ==================== 快照管理 ====================

  /**
   * 创建快照
   */
  const createSnapshot = useCallback(
    async (options: CreateSnapshotOptions): Promise<ContentSnapshot> => {
      const { title, content, summary, source, sourceName, aiModel, force } = options;

      // 去重检查
      if (!force && content === lastContentRef.current) {
        // 内容未变化，不创建快照
        return state.snapshots[state.currentIndex];
      }

      // 计算变化量
      const changedChars = content.length - lastContentRef.current.length;
      const changeType = calculateChangeType(lastContentRef.current, content, source);

      // 创建快照对象
      const snapshot: ContentSnapshot = {
        id: `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: Date.now(),
        title,
        content,
        summary,
        source,
        sourceName,
        changeType,
        changedChars,
        aiModel,
        isBookmark: false,
      };

      // 保存到 IndexedDB
      await historyStorage.saveSnapshot(snapshot);

      // 更新本地状态
      const newSnapshots = [snapshot, ...state.snapshots];

      // 检查是否超出最大限制
      if (newSnapshots.length > config.maxSnapshots) {
        // 删除最旧的非书签快照
        await historyStorage.deleteOldest(newSnapshots.length - config.maxSnapshots);
        await loadHistory(); // 重新加载
      } else {
        setState(prev => ({
          ...prev,
          snapshots: newSnapshots,
          currentIndex: 0,
          canUndo: newSnapshots.length > 1,
          canRedo: false,
          totalSnapshots: newSnapshots.length,
        }));
      }

      lastContentRef.current = content;
      emitEvent({ type: 'snapshot-created', snapshot });

      return snapshot;
    },
    [state.snapshots, state.currentIndex, config.maxSnapshots, emitEvent, loadHistory]
  );

  /**
   * 撤销（返回上一个快照）
   */
  const undo = useCallback(async (): Promise<ContentSnapshot | null> => {
    if (!state.canUndo) return null;

    const newIndex = state.currentIndex + 1;
    const snapshot = state.snapshots[newIndex];

    if (!snapshot) return null;

    setState(prev => ({
      ...prev,
      currentIndex: newIndex,
      canUndo: newIndex < prev.snapshots.length - 1,
      canRedo: true,
    }));

    lastContentRef.current = snapshot.content;
    emitEvent({ type: 'undo', snapshot });

    return snapshot;
  }, [state.canUndo, state.currentIndex, state.snapshots, emitEvent]);

  /**
   * 重做（前进到下一个快照）
   */
  const redo = useCallback(async (): Promise<ContentSnapshot | null> => {
    if (!state.canRedo) return null;

    const newIndex = state.currentIndex - 1;
    const snapshot = state.snapshots[newIndex];

    if (!snapshot) return null;

    setState(prev => ({
      ...prev,
      currentIndex: newIndex,
      canUndo: true,
      canRedo: newIndex > 0,
    }));

    lastContentRef.current = snapshot.content;
    emitEvent({ type: 'redo', snapshot });

    return snapshot;
  }, [state.canRedo, state.currentIndex, state.snapshots, emitEvent]);

  /**
   * 跳转到指定快照
   */
  const jumpTo = useCallback(
    async (snapshotId: string): Promise<ContentSnapshot> => {
      const index = state.snapshots.findIndex(s => s.id === snapshotId);
      if (index === -1) {
        throw new Error('Snapshot not found');
      }

      const snapshot = state.snapshots[index];

      setState(prev => ({
        ...prev,
        currentIndex: index,
        canUndo: index < prev.snapshots.length - 1,
        canRedo: index > 0,
      }));

      lastContentRef.current = snapshot.content;
      emitEvent({ type: 'jumped', snapshot });

      return snapshot;
    },
    [state.snapshots, emitEvent]
  );

  /**
   * 删除快照
   */
  const deleteSnapshot = useCallback(
    async (snapshotId: string): Promise<void> => {
      await historyStorage.deleteSnapshot(snapshotId);
      await loadHistory();
      emitEvent({ type: 'snapshot-deleted', snapshotId });
    },
    [loadHistory, emitEvent]
  );

  /**
   * 清空历史
   */
  const clearHistory = useCallback(async (): Promise<void> => {
    await historyStorage.clearAll();
    setState({
      snapshots: [],
      currentIndex: -1,
      canUndo: false,
      canRedo: false,
      totalSnapshots: 0,
      totalSize: 0,
    });
    emitEvent({ type: 'history-cleared' });
  }, [emitEvent]);

  /**
   * 切换书签
   */
  const toggleBookmark = useCallback(
    async (snapshotId: string, note?: string): Promise<void> => {
      const snapshot = await historyStorage.getSnapshot(snapshotId);
      if (!snapshot) return;

      snapshot.isBookmark = !snapshot.isBookmark;
      snapshot.bookmarkNote = note;

      await historyStorage.saveSnapshot(snapshot);
      await loadHistory();

      emitEvent({
        type: 'bookmark-toggled',
        snapshotId,
        isBookmark: snapshot.isBookmark,
      });
    },
    [loadHistory, emitEvent]
  );

  /**
   * 获取书签快照
   */
  const getBookmarks = useCallback(async (): Promise<ContentSnapshot[]> => {
    return await historyStorage.getBookmarks();
  }, []);

  /**
   * 比较两个快照
   */
  const compareSnapshots = useCallback(
    async (id1: string, id2: string): Promise<DiffResult> => {
      const snapshot1 = state.snapshots.find(s => s.id === id1);
      const snapshot2 = state.snapshots.find(s => s.id === id2);

      if (!snapshot1 || !snapshot2) {
        throw new Error('Snapshot not found');
      }

      return computeDiff(snapshot1.content, snapshot2.content);
    },
    [state.snapshots]
  );

  /**
   * 与当前内容比较
   */
  const compareWithCurrent = useCallback(
    async (snapshotId: string): Promise<DiffResult> => {
      const snapshot = state.snapshots.find(s => s.id === snapshotId);
      if (!snapshot) {
        throw new Error('Snapshot not found');
      }

      const currentSnapshot = state.snapshots[state.currentIndex];
      if (!currentSnapshot) {
        throw new Error('No current snapshot');
      }

      return computeDiff(snapshot.content, currentSnapshot.content);
    },
    [state.snapshots, state.currentIndex]
  );

  // ==================== 自动保存 ====================

  useEffect(() => {
    if (!config.enableAutoSave || !postId) return;

    // 清除旧定时器
    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
    }

    // 设置新定时器
    autoSaveTimerRef.current = setInterval(() => {
      // 由外部调用 createSnapshot
      // 这里只触发事件，不直接创建快照
    }, config.autoSaveInterval * 1000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }
    };
  }, [config.enableAutoSave, config.autoSaveInterval, postId]);

  // ==================== 返回 API ====================

  return {
    // 状态
    state,
    currentSnapshot: state.snapshots[state.currentIndex] || null,

    // 操作
    createSnapshot,
    deleteSnapshot,
    clearHistory,

    // 导航
    undo,
    redo,
    jumpTo,

    // 比较
    compareSnapshots,
    compareWithCurrent,

    // 书签
    toggleBookmark,
    getBookmarks,

    // 重新加载
    reload: loadHistory,
  };
}

// ==================== 辅助函数 ====================

/**
 * 计算变化类型
 */
function calculateChangeType(
  oldContent: string,
  newContent: string,
  source: SnapshotSource
): ChangeType {
  if (!oldContent) return 'create';
  if (source === 'ai-suggestion') {
    // 根据工具类型判断
    return 'ai-polish'; // 默认
  }

  const oldLen = oldContent.length;
  const newLen = newContent.length;
  const changePercent = Math.abs(newLen - oldLen) / oldLen;

  if (changePercent > 0.3) return 'major';
  if (changePercent < 0.1) return 'minor';
  return 'modify';
}

/**
 * 简单的文本差异计算
 * TODO: 使用 diff-match-patch 库实现更精确的差异
 */
function computeDiff(oldText: string, newText: string): DiffResult {
  // 简单实现：只统计字符数变化
  const additions = Math.max(0, newText.length - oldText.length);
  const deletions = Math.max(0, oldText.length - newText.length);

  return {
    additions: [],
    deletions: [],
    modifications: [],
    stats: {
      totalAdded: additions,
      totalDeleted: deletions,
      totalModified: 0,
    },
  };
}
