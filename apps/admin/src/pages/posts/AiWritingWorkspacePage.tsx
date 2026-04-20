/**
 * AI 协同写作完整集成版本
 *
 * 已集成功能：
 * ✅ Phase 1: 版本控制系统（撤销/重做/历史/对比）
 * ✅ Phase 2: 实时 AI 预测（Ghost Text）
 * ✅ Phase 3: 批注/批量优化/对话面板
 * ✅ Phase 4: 工作流优化（自由/引导模式切换）
 * ✅ Phase 5: 移动端重构 —— Aether Codex 四层表面 + 双排头部 + 底抽屉面板
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  ArrowLeft,
  Save,
  X,
  History,
  RotateCcw,
  RotateCw,
  MessageSquare,
  Workflow,
  Pen,
  Edit3,
  Eye,
  Columns,
} from 'lucide-react';
import { EditorWithPreview, EditorView } from '@aetherblog/editor';
import { useNavigate, useParams } from 'react-router-dom';
import { useTheme, useMediaQuery } from '@aetherblog/hooks';
import { cn } from '@/lib/utils';

// Hook
import { useWritingWorkflow } from '@/hooks/useWritingWorkflow';
import { useHistoryManager } from '@/hooks/useHistoryManager';
import { useAiPrediction } from '@/hooks/useAiPrediction';

// 组件
import { FloatingAiToolbar } from '@/components/ai/FloatingAiToolbar';
import { WorkflowNavigation } from '@/components/ai/WorkflowNavigation';
import { HistoryPanel } from '@/components/history/HistoryPanel';
import { DiffView } from '@/components/history/DiffView';
import { AiChatPanel } from '@/components/ai/AiChatPanel';

// 类型定义
import type { AiCapability } from '@/types/writing-workflow';
import type { ContentSnapshot } from '@/types/content-history';

// 编辑器扩展
import { createGhostTextExtension } from '@/lib/ghost-text-extension';
import { aiService } from '@/services/aiService';
import { loadToolParams } from '@/components/ai/ToolParamsPanel';
import { toast } from 'sonner';

// AI 工具能力定义
//
// 注：此处只登记**已有真实后端支持**的能力。之前存在的 `expand` 工具是
// 前端 mock（直接返回 selectedText + 占位符），没有对应的 /api/v1/ai/expand
// 端点，因此已从列表中移除——避免给用户提供看似可用但实际无效的按钮。
// 如未来 AI 服务上线扩写端点，可在此处重新加入。
const AI_CAPABILITIES: AiCapability[] = [
  {
    id: 'polish',
    label: '润色',
    description: '优化选中文本的表达',
    type: 'floating',
    icon: 'sparkles',
    applicableStages: ['draft-generation', 'refinement', 'free-writing'],
    requiresSelection: true,
    cost: 'low',
    hotkey: '⌘⇧P',
  },
  {
    id: 'summarize',
    label: '总结',
    description: '总结选中段落',
    type: 'floating',
    icon: 'file-text',
    applicableStages: ['refinement', 'final-review', 'free-writing'],
    requiresSelection: true,
    cost: 'low',
  },
];

type EditorViewMode = 'edit' | 'preview' | 'split';
type MobilePanel = 'history' | 'chat' | 'workflow' | null;

export function AiWritingWorkspacePage() {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { id } = useParams<{ id: string }>();
  const postId = id ? parseInt(id, 10) : null;
  const isMobile = useMediaQuery('(max-width: 768px)');

  // 编辑器状态
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const editorViewRef = useRef<EditorView | null>(null);

  // UI 状态
  const [workflowMode, setWorkflowMode] = useState<'guided' | 'free'>('free');
  const [editorViewMode, setEditorViewMode] = useState<EditorViewMode>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
      ? 'edit'
      : 'split'
  );
  const [showWorkflowNav, setShowWorkflowNav] = useState(true);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [compareSnapshots, setCompareSnapshots] = useState<{
    snapshot1: ContentSnapshot;
    snapshot2: ContentSnapshot;
  } | null>(null);

  // 过 mobile 边界时自动迁移编辑器视图：移动端 split 不可用 → edit
  useEffect(() => {
    if (isMobile && editorViewMode === 'split') {
      setEditorViewMode('edit');
    }
  }, [isMobile, editorViewMode]);

  // 统一收口：移动端的各抽屉面板互斥；桌面端各用各的
  const openMobilePanel = useCallback((panel: MobilePanel) => {
    setMobilePanel(panel);
  }, []);
  const closeMobilePanel = useCallback(() => setMobilePanel(null), []);

  // 工作流
  const workflow = useWritingWorkflow({
    postId: postId?.toString(),
    onEvent: (event) => {
      if (event.type === 'stage-complete' && postId) {
        historyManager.createSnapshot({
          title,
          content,
          summary,
          source: 'workflow-stage',
          sourceName: `完成阶段: ${event.stage}`,
        });
      }
    },
  });

  // 历史管理
  const historyManager = useHistoryManager({
    postId: postId?.toString(),
    onEvent: (event) => {
      if (event.type === 'undo' || event.type === 'redo' || event.type === 'jumped') {
        setTitle(event.snapshot.title);
        setContent(event.snapshot.content);
        setSummary(event.snapshot.summary);
      }
    },
  });

  // Ghost Text 编辑器扩展
  const ghostTextExtensions = useMemo(() => {
    return createGhostTextExtension({
      onAccept: () => aiPrediction.handleAccept(),
      onReject: () => aiPrediction.handleReject(),
      onAcceptWord: () => aiPrediction.handleAcceptWord(),
      onAcceptLine: () => aiPrediction.handleAcceptLine(),
    });
  }, []);

  // AI 预测
  const aiPrediction = useAiPrediction({
    enabled: true,
    editorViewRef,
    documentTitle: title,
    writingStage: workflow.context.currentStage,
    onPredictionAccepted: (type) => {
      console.log('已接受预测:', type);
    },
  });

  // AI 工具执行
  const handleToolExecute = useCallback(
    async (toolId: string, selectedText: string) => {
      workflow.recordToolUsage(toolId);

      if (postId) {
        await historyManager.createSnapshot({
          title,
          content,
          summary,
          source: 'user-edit',
          sourceName: '修改前',
        });
      }

      try {
        let result: string = '';

        if (toolId === 'polish') {
          const polishParams = loadToolParams('polish');
          const res = await aiService.polishContent({
            content: selectedText,
            tone: String(polishParams.tone ?? '专业'),
          });
          if (res.code === 200 && res.data) {
            result = res.data.polishedContent;
          }
        } else if (toolId === 'summarize') {
          const summaryParams = loadToolParams('summary');
          const res = await aiService.generateSummary({
            content: selectedText,
            maxLength: Number(summaryParams.maxLength ?? 200),
          });
          if (res.code === 200 && res.data) {
            result = res.data.summary;
          }
        } else {
          toast.error(`未知的 AI 工具：${toolId}`);
          return;
        }

        if (!result.trim()) {
          toast.error('AI 未返回有效内容');
          return;
        }

        const newContent = content.replace(selectedText, result);
        setContent(newContent);

        if (postId) {
          await historyManager.createSnapshot({
            title,
            content: newContent,
            summary,
            source: 'ai-suggestion',
            sourceName: `AI ${toolId}`,
          });
        }

        toast.success(`AI ${toolId} 完成`);
      } catch (error) {
        toast.error('AI 处理失败');
        console.error('AI 工具执行失败:', error);
      }
    },
    [workflow, historyManager, title, content, summary, postId]
  );

  // 自动保存
  useEffect(() => {
    if (!postId || !content) return;

    const timer = setTimeout(() => {
      historyManager.createSnapshot({
        title,
        content,
        summary,
        source: 'auto-save',
        sourceName: '自动保存',
      });
    }, 3000);

    return () => clearTimeout(timer);
  }, [title, content, summary, postId, historyManager]);

  // 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        historyManager.undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        historyManager.redo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        if (isMobile) {
          setMobilePanel((p) => (p === 'history' ? null : 'history'));
        } else {
          setShowHistoryPanel((prev) => !prev);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyManager, isMobile]);

  const handleSave = useCallback(() => {
    if (postId) {
      historyManager.createSnapshot({
        title,
        content,
        summary,
        source: 'manual-save',
        sourceName: '手动保存',
      });
    }
    toast.success('保存成功');
  }, [postId, historyManager, title, content, summary]);

  return (
    <div className="absolute inset-0 flex flex-col bg-[var(--bg-void)]">
      {/* ============ 移动端头部：双排紧凑布局 ============ */}
      {isMobile ? (
        <header className="surface-raised !rounded-none border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] flex-shrink-0">
          {/* Row 1 · 导航条 */}
          <div className="flex items-center justify-between px-4 h-12">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => navigate('/posts')}
                aria-label="返回"
                className="-ml-2 p-2 rounded-lg text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles className="w-4 h-4 text-[var(--aurora-1)] flex-shrink-0" />
                <span className="font-display text-[var(--fs-body)] text-[var(--ink-primary)] truncate tracking-tight">
                  AI 协同写作
                </span>
              </div>
            </div>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-[var(--ink-primary)] text-[var(--bg-void)] text-[var(--fs-caption)] font-medium active:scale-95 transition-transform"
            >
              <Save className="w-3.5 h-3.5" />
              保存
            </button>
          </div>

          {/* Row 2 · 模式 + 控制条 */}
          <div className="flex items-center justify-between gap-3 px-3 pb-2">
            {/* 模式切换 pill */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
              <button
                onClick={() => setWorkflowMode('free')}
                className={cn(
                  'flex items-center gap-1 h-7 px-3 rounded-full text-[var(--fs-micro)] font-mono uppercase tracking-[0.14em] transition-all',
                  workflowMode === 'free'
                    ? 'bg-[var(--ink-primary)] text-[var(--bg-void)]'
                    : 'text-[var(--ink-secondary)]'
                )}
              >
                <Pen className="w-3 h-3" />
                自由
              </button>
              <button
                onClick={() => setWorkflowMode('guided')}
                className={cn(
                  'flex items-center gap-1 h-7 px-3 rounded-full text-[var(--fs-micro)] font-mono uppercase tracking-[0.14em] transition-all',
                  workflowMode === 'guided'
                    ? 'bg-[var(--ink-primary)] text-[var(--bg-void)]'
                    : 'text-[var(--ink-secondary)]'
                )}
              >
                <Workflow className="w-3 h-3" />
                引导
              </button>
            </div>

            {/* 控制图标组 */}
            <div className="flex items-center gap-0.5">
              <MobileIconButton
                onClick={() => historyManager.undo()}
                disabled={!historyManager.state.canUndo}
                label="撤销"
              >
                <RotateCcw className="w-[18px] h-[18px]" />
              </MobileIconButton>
              <MobileIconButton
                onClick={() => historyManager.redo()}
                disabled={!historyManager.state.canRedo}
                label="重做"
              >
                <RotateCw className="w-[18px] h-[18px]" />
              </MobileIconButton>
              <MobileIconButton
                onClick={() => openMobilePanel(mobilePanel === 'history' ? null : 'history')}
                active={mobilePanel === 'history'}
                label="历史"
              >
                <History className="w-[18px] h-[18px]" />
              </MobileIconButton>
              <MobileIconButton
                onClick={() => openMobilePanel(mobilePanel === 'chat' ? null : 'chat')}
                active={mobilePanel === 'chat'}
                label="对话"
              >
                <MessageSquare className="w-[18px] h-[18px]" />
              </MobileIconButton>
              {workflowMode === 'guided' && (
                <MobileIconButton
                  onClick={() => openMobilePanel(mobilePanel === 'workflow' ? null : 'workflow')}
                  active={mobilePanel === 'workflow'}
                  label="流程"
                >
                  <span className="font-mono text-[10px] tracking-tight tabular-nums">
                    {workflow.progress.percentage}%
                  </span>
                </MobileIconButton>
              )}
            </div>
          </div>
        </header>
      ) : (
        // ============ 桌面端头部 ============
        <header className="flex items-center justify-between px-6 py-3 surface-raised !rounded-none border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] flex-shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/posts')}
              className="p-2 rounded-lg text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[var(--aurora-1)]" />
              <span className="font-display text-[var(--fs-lede)] text-[var(--ink-primary)] tracking-tight">
                AI 协同写作
              </span>
            </div>

            <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
              <button
                onClick={() => setWorkflowMode('free')}
                className={cn(
                  'flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[var(--fs-caption)] font-mono uppercase tracking-[0.16em] transition-all',
                  workflowMode === 'free'
                    ? 'bg-[var(--ink-primary)] text-[var(--bg-void)]'
                    : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
                )}
              >
                <Pen className="w-3.5 h-3.5" />
                自由写作
              </button>
              <button
                onClick={() => setWorkflowMode('guided')}
                className={cn(
                  'flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[var(--fs-caption)] font-mono uppercase tracking-[0.16em] transition-all',
                  workflowMode === 'guided'
                    ? 'bg-[var(--ink-primary)] text-[var(--bg-void)]'
                    : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
                )}
              >
                <Workflow className="w-3.5 h-3.5" />
                引导模式
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
              <DesktopIconButton
                onClick={() => historyManager.undo()}
                disabled={!historyManager.state.canUndo}
                title="撤销 (Ctrl+Z)"
              >
                <RotateCcw className="w-4 h-4" />
              </DesktopIconButton>
              <DesktopIconButton
                onClick={() => historyManager.redo()}
                disabled={!historyManager.state.canRedo}
                title="重做 (Ctrl+Shift+Z)"
              >
                <RotateCw className="w-4 h-4" />
              </DesktopIconButton>
              <div className="w-px h-4 bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] mx-1" />
              <DesktopIconButton
                onClick={() => setShowHistoryPanel(!showHistoryPanel)}
                active={showHistoryPanel}
                title="历史版本 (Ctrl+H)"
              >
                <History className="w-4 h-4" />
              </DesktopIconButton>
            </div>

            <DesktopIconButton
              onClick={() => setShowChatPanel(!showChatPanel)}
              active={showChatPanel}
              title="AI 对话"
            >
              <MessageSquare className="w-5 h-5" />
            </DesktopIconButton>

            {workflowMode === 'guided' && (
              <button
                onClick={() => setShowWorkflowNav(!showWorkflowNav)}
                className={cn(
                  'flex items-center gap-1.5 h-9 px-3 rounded-full text-[var(--fs-caption)] font-mono uppercase tracking-[0.14em] transition-all',
                  showWorkflowNav
                    ? 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]'
                    : 'bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
                )}
              >
                工作流
                <span className="tabular-nums">{workflow.progress.percentage}%</span>
              </button>
            )}

            <button
              onClick={handleSave}
              className="flex items-center gap-2 h-9 px-4 rounded-full bg-[var(--ink-primary)] text-[var(--bg-void)] text-[var(--fs-caption)] font-medium hover:opacity-90 transition-opacity"
            >
              <Save className="w-4 h-4" />
              保存
            </button>
          </div>
        </header>
      )}

      {/* ============ 主内容区 ============ */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* 工作流导航（仅桌面） */}
        {!isMobile && (
          <AnimatePresence>
            {workflowMode === 'guided' && showWorkflowNav && (
              <motion.aside
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 280, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                className="border-r border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] overflow-hidden flex-shrink-0"
              >
                <div className="h-full flex flex-col w-[280px]">
                  <div className="flex items-center justify-between px-4 h-12 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                    <h3 className="font-mono text-[var(--fs-micro)] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                      创作流程
                    </h3>
                    <button
                      onClick={() => setShowWorkflowNav(false)}
                      className="p-1 rounded text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    <WorkflowNavigation
                      currentStage={workflow.context.currentStage}
                      completedStages={workflow.context.stageHistory}
                      progress={workflow.progress}
                      onStageClick={(stage) => workflow.enterStage(stage)}
                      canJumpTo={(stage) => {
                        const stageIndex = workflow.config.enabledStages.indexOf(stage);
                        const currentIndex = workflow.config.enabledStages.indexOf(workflow.context.currentStage);
                        return stageIndex <= currentIndex + 1;
                      }}
                    />
                  </div>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        )}

        {/* 编辑器主体 */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* 标题输入 */}
          <div className="px-4 md:px-6 py-3 md:py-4 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-void)] flex-shrink-0">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入文章标题…"
              className={cn(
                'w-full bg-transparent font-display tracking-tight text-[var(--ink-primary)]',
                'placeholder:text-[var(--ink-subtle)] placeholder:font-editorial placeholder:italic',
                'focus:outline-none',
                // 移动端 h4(24px) · 桌面端 h3(30px)
                'text-[var(--fs-h4)] md:text-[var(--fs-h3)] leading-[var(--lh-tight)]'
              )}
            />
          </div>

          {/* 视图模式 segmented tabs */}
          <div className="flex items-center gap-1 px-4 md:px-6 py-2 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] flex-shrink-0">
            <EditorModeTab
              active={editorViewMode === 'edit'}
              onClick={() => setEditorViewMode('edit')}
              icon={<Edit3 className="w-3.5 h-3.5" />}
              label="编辑"
            />
            <EditorModeTab
              active={editorViewMode === 'preview'}
              onClick={() => setEditorViewMode('preview')}
              icon={<Eye className="w-3.5 h-3.5" />}
              label="预览"
            />
            {!isMobile && (
              <EditorModeTab
                active={editorViewMode === 'split'}
                onClick={() => setEditorViewMode('split')}
                icon={<Columns className="w-3.5 h-3.5" />}
                label="分屏"
              />
            )}
          </div>

          {/* 编辑器 */}
          <div className="flex-1 relative overflow-hidden min-h-0">
            <EditorWithPreview
              value={content}
              onChange={setContent}
              viewMode={editorViewMode}
              onViewModeChange={setEditorViewMode}
              hideToolbar
              useCrossfade={isMobile}
              editorViewRef={editorViewRef}
              theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
              additionalExtensions={ghostTextExtensions}
            />

            {/* 浮动 AI 工具栏：仅桌面。移动端靠选中 → 长按原生菜单或 AI 对话面板触发 */}
            {!isMobile && (
              <FloatingAiToolbar
                editorViewRef={editorViewRef}
                currentStage={workflow.context.currentStage}
                availableTools={AI_CAPABILITIES}
                onToolExecute={handleToolExecute}
              />
            )}
          </div>
        </main>

        {/* 桌面端：历史面板（侧栏） */}
        {!isMobile && (
          <AnimatePresence>
            {showHistoryPanel && (
              <HistoryPanel
                state={historyManager.state}
                currentSnapshotId={historyManager.currentSnapshot?.id}
                onJumpTo={(id) => historyManager.jumpTo(id)}
                onUndo={() => historyManager.undo()}
                onRedo={() => historyManager.redo()}
                onToggleBookmark={(id, note) => historyManager.toggleBookmark(id, note)}
                onDelete={(id) => historyManager.deleteSnapshot(id)}
                onClear={() => historyManager.clearHistory()}
                onCompare={(id1, id2) => {
                  const snapshot1 = historyManager.state.snapshots.find((s) => s.id === id1);
                  const snapshot2 = historyManager.state.snapshots.find((s) => s.id === id2);
                  if (snapshot1 && snapshot2) {
                    setCompareSnapshots({ snapshot1, snapshot2 });
                  }
                }}
                onClose={() => setShowHistoryPanel(false)}
              />
            )}
          </AnimatePresence>
        )}

        {/* 桌面端：AI 对话面板（侧栏） */}
        {!isMobile && (
          <AnimatePresence>
            {showChatPanel && (
              <AiChatPanel
                messages={workflow.context.conversationHistory || []}
                onSendMessage={async (message, _includeContext) => {
                  workflow.addConversation('user', message);
                  setTimeout(() => {
                    workflow.addConversation('ai', '这是 AI 的回复示例');
                  }, 1000);
                }}
                onClearHistory={() => {
                  // 清空对话历史
                }}
                onClose={() => setShowChatPanel(false)}
                currentDocumentContext={{
                  title,
                  content,
                  wordCount: content.length,
                }}
              />
            )}
          </AnimatePresence>
        )}
      </div>

      {/* ============ 移动端：底部抽屉面板 ============ */}
      {isMobile && (
        <MobileBottomSheet open={mobilePanel !== null} onClose={closeMobilePanel}>
          {mobilePanel === 'history' && (
            <HistoryPanel
              state={historyManager.state}
              currentSnapshotId={historyManager.currentSnapshot?.id}
              onJumpTo={(id) => {
                historyManager.jumpTo(id);
                closeMobilePanel();
              }}
              onUndo={() => historyManager.undo()}
              onRedo={() => historyManager.redo()}
              onToggleBookmark={(id, note) => historyManager.toggleBookmark(id, note)}
              onDelete={(id) => historyManager.deleteSnapshot(id)}
              onClear={() => historyManager.clearHistory()}
              onCompare={(id1, id2) => {
                const snapshot1 = historyManager.state.snapshots.find((s) => s.id === id1);
                const snapshot2 = historyManager.state.snapshots.find((s) => s.id === id2);
                if (snapshot1 && snapshot2) {
                  setCompareSnapshots({ snapshot1, snapshot2 });
                  closeMobilePanel();
                }
              }}
              onClose={closeMobilePanel}
            />
          )}
          {mobilePanel === 'chat' && (
            <AiChatPanel
              messages={workflow.context.conversationHistory || []}
              onSendMessage={async (message, _includeContext) => {
                workflow.addConversation('user', message);
                setTimeout(() => {
                  workflow.addConversation('ai', '这是 AI 的回复示例');
                }, 1000);
              }}
              onClearHistory={() => {}}
              onClose={closeMobilePanel}
              currentDocumentContext={{
                title,
                content,
                wordCount: content.length,
              }}
            />
          )}
          {mobilePanel === 'workflow' && (
            <div className="h-full flex flex-col bg-[var(--bg-void)]">
              <div className="flex items-center justify-between px-4 h-12 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] flex-shrink-0">
                <h3 className="font-mono text-[var(--fs-micro)] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  创作流程
                </h3>
                <button
                  onClick={closeMobilePanel}
                  className="p-1 rounded text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
                  aria-label="关闭"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <WorkflowNavigation
                  currentStage={workflow.context.currentStage}
                  completedStages={workflow.context.stageHistory}
                  progress={workflow.progress}
                  onStageClick={(stage) => {
                    workflow.enterStage(stage);
                    closeMobilePanel();
                  }}
                  canJumpTo={(stage) => {
                    const stageIndex = workflow.config.enabledStages.indexOf(stage);
                    const currentIndex = workflow.config.enabledStages.indexOf(workflow.context.currentStage);
                    return stageIndex <= currentIndex + 1;
                  }}
                />
              </div>
            </div>
          )}
        </MobileBottomSheet>
      )}

      {/* 差异对比 */}
      <AnimatePresence>
        {compareSnapshots && (
          <DiffView
            snapshot1={compareSnapshots.snapshot1}
            snapshot2={compareSnapshots.snapshot2}
            onClose={() => setCompareSnapshots(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ==================== 移动端图标按钮 ====================
// 44×44 最小触控区，无障碍 label，活跃态用 aurora tint
function MobileIconButton({
  children,
  onClick,
  disabled,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center justify-center w-11 h-9 rounded-lg transition-all',
        active
          ? 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]'
          : 'text-[var(--ink-secondary)] active:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
        disabled && 'opacity-40 pointer-events-none'
      )}
    >
      {children}
    </button>
  );
}

// ==================== 桌面端图标按钮 ====================
function DesktopIconButton({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        'p-1.5 rounded-md transition-colors',
        active
          ? 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]'
          : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]',
        disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent'
      )}
    >
      {children}
    </button>
  );
}

// ==================== 编辑器视图模式 Tab ====================
function EditorModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[var(--fs-micro)] font-mono uppercase tracking-[0.18em] transition-all',
        active
          ? 'bg-[var(--ink-primary)] text-[var(--bg-void)]'
          : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ==================== 移动端底抽屉 ====================
// surface-overlay + 向上滑入 + 遮罩点击关闭 + safe-area 底内衬
function MobileBottomSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-[color-mix(in_oklch,var(--ink-primary)_40%,transparent)] backdrop-blur-sm"
            aria-hidden="true"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34, mass: 0.8 }}
            className={cn(
              'surface-overlay',
              'fixed left-0 right-0 bottom-0 z-50',
              '!rounded-b-none !rounded-t-2xl',
              'h-[82vh] max-h-[82dvh]',
              'flex flex-col overflow-hidden',
              'pb-[env(safe-area-inset-bottom)]'
            )}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]" />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden [&>*]:!w-full [&>*]:!h-full [&>*]:!border-l-0">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
