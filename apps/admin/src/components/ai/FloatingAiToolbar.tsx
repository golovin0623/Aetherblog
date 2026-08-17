/**
 * 跟随选区的 AI 工具栏(Aether Codex)
 *
 * 交互:选中文本 → 光标上方浮出 surface-overlay 工具条;点击工具后由
 * 工作区打开 AiResultPreview 预览卡(本组件随即被卸载),不在此处等待请求。
 *
 * 视觉:mono 小写标签 + aurora 点缀;入场 dropDown + transition.quick,
 * 禁止裸 bezier / 重阴影(overlay 表面自带层级阴影)。
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EditorView } from '@aetherblog/editor';
import {
  Sparkles,
  Wand2,
  FileText,
  Languages,
  Lightbulb,
  X,
  ChevronRight,
} from 'lucide-react';
import { transition, variants } from '@aetherblog/ui';
import { cn } from '@/lib/utils';
import type { AiCapability, WritingStage } from '@/types/writing-workflow';

export interface SelectionRange {
  from: number;
  to: number;
}

interface FloatingAiToolbarProps {
  editorViewRef: React.RefObject<EditorView | null>;
  currentStage: WritingStage;
  availableTools: AiCapability[];
  onToolExecute: (toolId: string, selectedText: string, range: SelectionRange) => void;
  className?: string;
}

interface Position {
  x: number;
  y: number;
}

const OFFSET_Y = -56; // 光标上方偏移
const TOOLBAR_WIDTH = 300; // 预估宽度(边界检测用)
const TOOLBAR_HEIGHT = 72;

const STAGE_SHORT_LABELS: Partial<Record<WritingStage, string>> = {
  'topic-selection': '选题',
  'outline-planning': '大纲',
  'draft-generation': '初稿',
  refinement: '精修',
  'batch-optimization': '批量优化',
  'final-review': '全文检查',
  publication: '发布准备',
  'free-writing': '自由写作',
};

export function FloatingAiToolbar({
  editorViewRef,
  currentStage,
  availableTools,
  onToolExecute,
  className,
}: FloatingAiToolbarProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [range, setRange] = useState<SelectionRange>({ from: 0, to: 0 });
  const [isExpanded, setIsExpanded] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const filteredTools = availableTools.filter(
    (tool) => tool.type === 'floating' && tool.applicableStages.includes(currentStage)
  );

  // 跟随选区更新位置与选中文本
  const updatePosition = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const { from, to } = view.state.selection.main;

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
    setRange({ from, to });

    const coords = view.coordsAtPos(from);
    if (!coords) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = coords.left - TOOLBAR_WIDTH / 2;
    let y = coords.top + OFFSET_Y;

    if (x < 16) x = 16;
    if (x + TOOLBAR_WIDTH > viewportWidth - 16) {
      x = viewportWidth - TOOLBAR_WIDTH - 16;
    }
    if (y < 16) {
      y = coords.bottom + 8;
    }
    if (y + TOOLBAR_HEIGHT > viewportHeight - 16) {
      y = viewportHeight - TOOLBAR_HEIGHT - 16;
    }

    setPosition({ x, y });
  }, [editorViewRef]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const handleUpdate = () => {
      requestAnimationFrame(updatePosition);
    };

    view.dom.addEventListener('mouseup', handleUpdate);
    view.dom.addEventListener('keyup', handleUpdate);
    view.scrollDOM.addEventListener('scroll', handleUpdate, { passive: true });
    window.addEventListener('resize', handleUpdate);

    handleUpdate();

    return () => {
      view.dom.removeEventListener('mouseup', handleUpdate);
      view.dom.removeEventListener('keyup', handleUpdate);
      view.scrollDOM.removeEventListener('scroll', handleUpdate);
      window.removeEventListener('resize', handleUpdate);
    };
  }, [editorViewRef, updatePosition]);

  const handleToolClick = useCallback(
    (toolId: string) => {
      if (!selectedText) return;
      onToolExecute(toolId, selectedText, range);
      setIsExpanded(false);
    },
    [selectedText, range, onToolExecute]
  );

  // 点击外部收起展开列表
  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded]);

  if (!position || filteredTools.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        ref={toolbarRef}
        variants={variants.dropDown}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={transition.quick}
        className={cn('surface-overlay fixed z-[60] !rounded-xl overflow-hidden', className)}
        style={{ left: position.x, top: position.y }}
        role="toolbar"
        aria-label="AI 选区工具"
      >
        {/* 主工具行 */}
        <div className="flex items-center gap-0.5 px-1.5 py-1.5">
          <div className="flex items-center gap-1.5 pl-1.5 pr-2">
            <Sparkles className="w-3.5 h-3.5 text-[var(--aurora-1)]" />
            <span className="font-mono text-[var(--fs-micro)] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              AI
            </span>
          </div>

          <div className="w-px h-4 bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]" />

          {filteredTools.slice(0, 3).map((tool) => {
            const Icon = getToolIcon(tool.id);
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => handleToolClick(tool.id)}
                title={tool.description}
                className={cn(
                  'flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[var(--fs-caption)] transition-colors',
                  'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]',
                  'hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tool.label}
              </button>
            );
          })}

          {filteredTools.length > 3 && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              title="更多工具"
              aria-expanded={isExpanded}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
                isExpanded
                  ? 'bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] text-[var(--ink-primary)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]'
              )}
            >
              <ChevronRight className={cn('w-4 h-4 transition-transform', isExpanded && 'rotate-90')} />
            </button>
          )}

          <button
            type="button"
            onClick={() => setPosition(null)}
            title="关闭"
            aria-label="关闭 AI 工具栏"
            className="flex items-center justify-center w-8 h-8 ml-0.5 rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 展开的更多工具 */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={transition.quick}
              className="border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] overflow-hidden"
            >
              <div className="p-1.5 space-y-0.5 max-h-64 overflow-y-auto">
                {filteredTools.slice(3).map((tool) => {
                  const Icon = getToolIcon(tool.id);
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => handleToolClick(tool.id)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors',
                        'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]',
                        'hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]'
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-caption)]">{tool.label}</div>
                        <div className="text-[var(--fs-micro)] text-[var(--ink-muted)] truncate">
                          {tool.description}
                        </div>
                      </div>
                      {tool.hotkey && (
                        <kbd className="px-1.5 py-0.5 rounded font-mono text-[10px] text-[var(--ink-muted)] bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
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

        {/* 底部选区信息 */}
        <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
          <span className="font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
            已选 {selectedText.length} 字
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--ink-muted)]">
            <span className="inline-block w-1 h-1 rounded-full bg-[var(--aurora-1)]" />
            {STAGE_SHORT_LABELS[currentStage] ?? currentStage}
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// 工具图标映射
function getToolIcon(toolId: string) {
  const iconMap: Record<string, typeof Sparkles> = {
    polish: Sparkles,
    expand: Wand2,
    summarize: FileText,
    translate: Languages,
    suggest: Lightbulb,
  };
  return iconMap[toolId] || Sparkles;
}
