import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowLeft, Save, Settings, X } from 'lucide-react';
import { EditorWithPreview, EditorView } from '@aetherblog/editor';
import { useNavigate, useParams } from 'react-router-dom';
import { useTheme } from '@aetherblog/hooks';
import { cn } from '@/lib/utils';

// 新组件
import { useWritingWorkflow } from '@/hooks/useWritingWorkflow';
import { FloatingAiToolbar } from '@/components/ai/FloatingAiToolbar';
import { WorkflowNavigation } from '@/components/ai/WorkflowNavigation';
import type { AiCapability, WritingStage } from '@/types/writing-workflow';

/**
 * AI 协同写作页面
 *
 * 核心特性：
 * 1. 工作流驱动的创作流程
 * 2. 跟随光标的智能AI工具
 * 3. 阶段化的AI辅助
 * 4. 学习用户偏好
 */

// 定义所有可用的 AI 工具
const AI_CAPABILITIES: AiCapability[] = [
  // 随行工具
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
    id: 'expand',
    label: '扩写',
    description: '扩展选中内容',
    type: 'floating',
    icon: 'wand',
    applicableStages: ['draft-generation', 'refinement', 'free-writing'],
    requiresSelection: true,
    cost: 'medium',
    hotkey: '⌘⇧E',
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
  {
    id: 'translate',
    label: '翻译',
    description: '翻译选中文本',
    type: 'floating',
    icon: 'languages',
    applicableStages: ['draft-generation', 'refinement', 'free-writing'],
    requiresSelection: true,
    cost: 'low',
  },

  // 全局工具
  {
    id: 'generate-title',
    label: '生成标题',
    description: '基于内容生成标题建议',
    type: 'global',
    icon: 'heading',
    applicableStages: ['publication', 'free-writing'],
    requiresSelection: false,
    cost: 'low',
  },
  {
    id: 'extract-tags',
    label: '提取标签',
    description: '智能提取文章标签',
    type: 'global',
    icon: 'hash',
    applicableStages: ['publication', 'free-writing'],
    requiresSelection: false,
    cost: 'low',
  },
  {
    id: 'generate-summary',
    label: '生成摘要',
    description: '生成文章摘要',
    type: 'global',
    icon: 'file-text',
    applicableStages: ['final-review', 'publication', 'free-writing'],
    requiresSelection: false,
    cost: 'medium',
  },

  // 工作流钩子
  {
    id: 'suggest-topics',
    label: '选题建议',
    description: 'AI提供写作方向建议',
    type: 'hook',
    icon: 'lightbulb',
    applicableStages: ['topic-selection'],
    requiresSelection: false,
    cost: 'medium',
  },
  {
    id: 'generate-outline',
    label: '生成大纲',
    description: '基于主题生成文章结构',
    type: 'hook',
    icon: 'list-tree',
    applicableStages: ['outline-planning'],
    requiresSelection: false,
    cost: 'medium',
  },
];

export function AiWritingWorkspacePage() {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  const postId = id ? parseInt(id, 10) : null;

  // 编辑器状态
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const editorViewRef = useRef<EditorView | null>(null);

  // UI 状态
  const [showWorkflowNav, setShowWorkflowNav] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // 工作流
  const workflow = useWritingWorkflow({
    postId: postId?.toString(),
    onEvent: (event) => {
      console.log('Workflow event:', event);
      // 可以在这里处理事件，如保存记录、上报分析等
    },
  });

  // 处理 AI 工具执行
  const handleToolExecute = useCallback(async (toolId: string, selectedText: string) => {
    console.log('Executing tool:', toolId, 'on text:', selectedText.slice(0, 50) + '...');

    // 记录工具使用
    workflow.recordToolUsage(toolId);

    // TODO: 调用实际的 AI 服务
    // const result = await aiService.executeCapability(toolId, { text: selectedText });

    // 示例：模拟 AI 响应
    await new Promise(resolve => setTimeout(resolve, 1000));
    alert(`AI ${toolId} 执行完成！\n选中文本: ${selectedText.slice(0, 100)}...`);
  }, [workflow]);

  // 处理阶段切换
  const handleStageClick = useCallback((stage: WritingStage) => {
    workflow.enterStage(stage);
  }, [workflow]);

  // 判断是否可以跳转到某个阶段
  const canJumpToStage = useCallback((stage: WritingStage) => {
    // 可以跳转到：当前阶段、已完成阶段、下一阶段
    const stageIndex = workflow.config.enabledStages.indexOf(stage);
    const currentIndex = workflow.config.enabledStages.indexOf(workflow.context.currentStage);
    return stageIndex <= currentIndex + 1;
  }, [workflow]);

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)]">
      {/* 顶部栏 */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/posts')}
            className="p-2 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-lg font-semibold text-[var(--text-primary)]">
              AI 协同写作
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 工作流导航切换 */}
          <button
            onClick={() => setShowWorkflowNav(!showWorkflowNav)}
            className={cn(
              'px-3 py-2 rounded-lg transition-colors text-sm',
              showWorkflowNav
                ? 'bg-primary/10 text-primary'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
            )}
          >
            工作流 {workflow.progress.percentage}%
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <Settings className="w-5 h-5" />
          </button>

          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90">
            <Save className="w-4 h-4" />
            保存
          </button>
        </div>
      </header>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 工作流导航（左侧） */}
        <AnimatePresence>
          {showWorkflowNav && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-r border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden"
            >
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">创作流程</h3>
                  <button
                    onClick={() => setShowWorkflowNav(false)}
                    className="p-1 rounded hover:bg-[var(--bg-card-hover)]"
                  >
                    <X className="w-4 h-4 text-[var(--text-muted)]" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <WorkflowNavigation
                    currentStage={workflow.context.currentStage}
                    completedStages={workflow.context.stageHistory}
                    progress={workflow.progress}
                    onStageClick={handleStageClick}
                    canJumpTo={canJumpToStage}
                  />
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* 编辑器区域 */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* 标题输入 */}
          <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入文章标题..."
              className="w-full text-3xl font-bold bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
            />
          </div>

          {/* 编辑器 */}
          <div className="flex-1 relative overflow-hidden">
            <EditorWithPreview
              value={content}
              onChange={setContent}
              viewMode="split"
              editorViewRef={editorViewRef}
              theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            />

            {/* 跟随光标的 AI 工具栏 */}
            <FloatingAiToolbar
              editorViewRef={editorViewRef}
              currentStage={workflow.context.currentStage}
              availableTools={AI_CAPABILITIES}
              onToolExecute={handleToolExecute}
            />
          </div>
        </main>
      </div>

      {/* 阶段提示（底部） */}
      <AnimatePresence>
        {workflow.context.currentStage !== 'free-writing' && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="px-6 py-3 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm text-[var(--text-secondary)]">
                  当前阶段：
                  <span className="ml-1 font-medium text-[var(--text-primary)]">
                    {getStageName(workflow.context.currentStage)}
                  </span>
                </span>
                {workflow.canSkip && (
                  <>
                    <div className="w-px h-4 bg-[var(--border-subtle)]" />
                    <button
                      onClick={workflow.skipStage}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      跳过此阶段
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function getStageName(stage: WritingStage): string {
  const names: Record<WritingStage, string> = {
    'topic-selection': '选题',
    'outline-planning': '大纲规划',
    'draft-generation': '初稿创作',
    'refinement': '内容精修',
    'batch-optimization': '批量优化',
    'final-review': '全文检查',
    'publication': '发布准备',
    'free-writing': '自由写作',
  };
  return names[stage] || stage;
}
