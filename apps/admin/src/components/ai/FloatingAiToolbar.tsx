import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EditorView } from '@aetherblog/editor';
import {
  Sparkles,
  Wand2,
  FileText,
  Languages,
  Lightbulb,
  RefreshCw,
  X,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AiCapability, WritingStage } from '@/types/writing-workflow';

/**
 * 跟随光标的智能 AI 工具栏
 *
 * 特性：
 * 1. 自动跟随编辑光标位置
 * 2. 保持安全距离避免干扰
 * 3. 无选中时自动隐藏
 * 4. 支持工具配置和过滤
 * 5. 根据当前阶段智能推荐工具
 */

interface FloatingAiToolbarProps {
  editorViewRef: React.RefObject<EditorView | null>;
  currentStage: WritingStage;
  availableTools: AiCapability[];
  onToolExecute: (toolId: string, selectedText: string) => void;
  className?: string;
}

interface Position {
  x: number;
  y: number;
}

const OFFSET_Y = -60; // 光标上方偏移
const OFFSET_X = 0;   // 水平居中

export function FloatingAiToolbar({
  editorViewRef,
  currentStage,
  availableTools,
  onToolExecute,
  className,
}: FloatingAiToolbarProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // 过滤适用于当前阶段的工具
  const filteredTools = availableTools.filter(tool =>
    tool.type === 'floating' &&
    tool.applicableStages.includes(currentStage)
  );

  // 更新位置和选中文本
  const updatePosition = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const { from, to } = view.state.selection.main;

    // 无选中内容时隐藏
    if (from === to) {
      setPosition(null);
      setSelectedText('');
      setIsExpanded(false);
      return;
    }

    const text = view.state.sliceDoc(from, to);
    if (!text.trim()) {
      setPosition(null);
      setSelectedText('');
      return;
    }

    setSelectedText(text);

    // 计算位置
    const coords = view.coordsAtPos(from);
    if (!coords) return;

    // 确保工具栏不超出视口
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const toolbarWidth = 280; // 预估宽度
    const toolbarHeight = 48;

    let x = coords.left + OFFSET_X;
    let y = coords.top + OFFSET_Y;

    // 水平居中对齐
    x = x - toolbarWidth / 2;

    // 边界检测
    if (x < 16) x = 16;
    if (x + toolbarWidth > viewportWidth - 16) {
      x = viewportWidth - toolbarWidth - 16;
    }

    if (y < 16) {
      // 光标上方空间不足，放到下方
      y = coords.bottom + 8;
    }
    if (y + toolbarHeight > viewportHeight - 16) {
      y = viewportHeight - toolbarHeight - 16;
    }

    setPosition({ x, y });
  }, [editorViewRef]);

  // 监听编辑器事件
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const handleUpdate = () => {
      requestAnimationFrame(updatePosition);
    };

    // 监听选中、滚动、窗口大小变化
    view.dom.addEventListener('mouseup', handleUpdate);
    view.dom.addEventListener('keyup', handleUpdate);
    view.scrollDOM.addEventListener('scroll', handleUpdate, { passive: true });
    window.addEventListener('resize', handleUpdate);

    // 初始更新
    handleUpdate();

    return () => {
      view.dom.removeEventListener('mouseup', handleUpdate);
      view.dom.removeEventListener('keyup', handleUpdate);
      view.scrollDOM.removeEventListener('scroll', handleUpdate);
      window.removeEventListener('resize', handleUpdate);
    };
  }, [editorViewRef, updatePosition]);

  // 执行工具
  const handleToolClick = useCallback(async (toolId: string) => {
    if (!selectedText || loading) return;

    setLoading(true);
    try {
      await onToolExecute(toolId, selectedText);
    } finally {
      setLoading(false);
    }
  }, [selectedText, loading, onToolExecute]);

  // 点击外部关闭展开
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded]);

  if (!position || filteredTools.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        ref={toolbarRef}
        initial={{ opacity: 0, y: 10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className={cn(
          'fixed z-[9999] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur-xl shadow-2xl',
          className
        )}
        style={{
          left: position.x,
          top: position.y,
        }}
      >
        {/* 顶部指示器 */}
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-[var(--bg-card)] border-l border-t border-[var(--border-subtle)]" />

        <div className="relative">
          {/* 主工具栏 */}
          <div className="flex items-center gap-1 px-2 py-1.5">
            {/* AI 图标 */}
            <div className="flex items-center gap-1.5 px-2 text-xs text-[var(--text-muted)]">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span className="font-medium">AI助手</span>
            </div>

            {/* 分隔线 */}
            <div className="w-px h-5 bg-[var(--border-subtle)]" />

            {/* 快捷工具（前3个） */}
            {filteredTools.slice(0, 3).map((tool) => {
              const Icon = getToolIcon(tool.id);
              return (
                <button
                  key={tool.id}
                  onClick={() => handleToolClick(tool.id)}
                  disabled={loading}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-all',
                    'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                    'hover:bg-[var(--bg-card-hover)]',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                  title={tool.description}
                >
                  {loading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                  <span>{tool.label}</span>
                </button>
              );
            })}

            {/* 更多工具按钮 */}
            {filteredTools.length > 3 && (
              <>
                <div className="w-px h-5 bg-[var(--border-subtle)]" />
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className={cn(
                    'p-1.5 rounded-md transition-colors',
                    'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                    'hover:bg-[var(--bg-card-hover)]',
                    isExpanded && 'bg-[var(--bg-card-hover)] text-[var(--text-primary)]'
                  )}
                  title="更多工具"
                >
                  <ChevronRight
                    className={cn(
                      'w-4 h-4 transition-transform',
                      isExpanded && 'rotate-90'
                    )}
                  />
                </button>
              </>
            )}

            {/* 关闭按钮 */}
            <button
              onClick={() => setPosition(null)}
              className={cn(
                'ml-1 p-1.5 rounded-md transition-colors',
                'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--bg-card-hover)]'
              )}
              title="关闭"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 展开的工具列表 */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="border-t border-[var(--border-subtle)] overflow-hidden"
              >
                <div className="p-2 space-y-1 max-h-64 overflow-y-auto">
                  {filteredTools.slice(3).map((tool) => {
                    const Icon = getToolIcon(tool.id);
                    return (
                      <button
                        key={tool.id}
                        onClick={() => {
                          handleToolClick(tool.id);
                          setIsExpanded(false);
                        }}
                        disabled={loading}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors',
                          'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                          'hover:bg-[var(--bg-card-hover)]',
                          'disabled:opacity-50 disabled:cursor-not-allowed'
                        )}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{tool.label}</div>
                          <div className="text-xs text-[var(--text-muted)] truncate">
                            {tool.description}
                          </div>
                        </div>
                        {tool.hotkey && (
                          <kbd className="px-1.5 py-0.5 text-xs rounded bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                            {tool.hotkey}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 底部提示 */}
        {selectedText && (
          <div className="px-3 py-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
              <span>已选中 {selectedText.length} 字</span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-1 h-1 rounded-full bg-primary animate-pulse" />
                {currentStage === 'refinement' ? '精修模式' : '自由写作'}
              </span>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// 工具图标映射
function getToolIcon(toolId: string) {
  const iconMap: Record<string, any> = {
    polish: Sparkles,
    expand: Wand2,
    summarize: FileText,
    translate: Languages,
    suggest: Lightbulb,
  };
  return iconMap[toolId] || Sparkles;
}
