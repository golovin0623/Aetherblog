import { motion } from 'framer-motion';
import {
  Lightbulb,
  ListTree,
  FileEdit,
  Sparkles,
  CheckCircle2,
  Eye,
  Send,
  ChevronRight,
  Check,
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WritingStage, StageConfig } from '@/types/writing-workflow';

/**
 * 写作工作流导航面板
 *
 * 功能：
 * 1. 显示当前进度
 * 2. 可跳转到任意已完成阶段
 * 3. 提供阶段说明和建议
 * 4. 可收起/展开
 */

interface WorkflowNavigationProps {
  currentStage: WritingStage;
  completedStages: WritingStage[];
  progress: { current: number; total: number; percentage: number };
  onStageClick: (stage: WritingStage) => void;
  canJumpTo: (stage: WritingStage) => boolean;
  className?: string;
}

const STAGE_CONFIGS: Record<WritingStage, StageConfig> = {
  'topic-selection': {
    id: 'topic-selection',
    label: '选题',
    description: 'AI帮你找到灵感，确定写作方向',
    icon: 'lightbulb',
    aiCapabilities: [],
    canSkip: true,
    autoNext: false,
  },
  'outline-planning': {
    id: 'outline-planning',
    label: '大纲',
    description: '规划文章结构，明确要点',
    icon: 'list-tree',
    aiCapabilities: [],
    canSkip: true,
    autoNext: false,
  },
  'draft-generation': {
    id: 'draft-generation',
    label: '初稿',
    description: 'AI生成初稿或自由创作',
    icon: 'file-edit',
    aiCapabilities: [],
    canSkip: false,
    autoNext: false,
  },
  'refinement': {
    id: 'refinement',
    label: '精修',
    description: '润色文字，优化表达',
    icon: 'sparkles',
    aiCapabilities: [],
    canSkip: true,
    autoNext: false,
  },
  'batch-optimization': {
    id: 'batch-optimization',
    label: '批量优化',
    description: '批量应用AI建议',
    icon: 'check-circle',
    aiCapabilities: [],
    canSkip: true,
    autoNext: false,
  },
  'final-review': {
    id: 'final-review',
    label: '检查',
    description: '全文检查，查缺补漏',
    icon: 'eye',
    aiCapabilities: [],
    canSkip: true,
    autoNext: false,
  },
  'publication': {
    id: 'publication',
    label: '发布',
    description: '完善元数据，准备发布',
    icon: 'send',
    aiCapabilities: [],
    canSkip: false,
    autoNext: false,
  },
  'free-writing': {
    id: 'free-writing',
    label: '自由写作',
    description: '跳过工作流，自由创作',
    icon: 'more-horizontal',
    aiCapabilities: [],
    canSkip: true,
    autoNext: false,
  },
};

export function WorkflowNavigation({
  currentStage,
  completedStages,
  progress,
  onStageClick,
  canJumpTo,
  className,
}: WorkflowNavigationProps) {
  const stages = Object.values(STAGE_CONFIGS).filter(s => s.id !== 'free-writing');

  return (
    <div className={cn('space-y-4', className)}>
      {/* 进度条 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>写作进度</span>
          <span className="font-medium text-[var(--text-primary)]">{progress.percentage}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-primary to-purple-500"
            initial={{ width: 0 }}
            animate={{ width: `${progress.percentage}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
        <div className="text-xs text-[var(--text-muted)]">
          第 {progress.current} / {progress.total} 阶段
        </div>
      </div>

      {/* 阶段列表 */}
      <div className="space-y-1">
        {stages.map((stage, index) => {
          const isCompleted = completedStages.includes(stage.id);
          const isCurrent = currentStage === stage.id;
          const canClick = canJumpTo(stage.id);
          const Icon = getStageIcon(stage.icon);

          return (
            <button
              key={stage.id}
              onClick={() => canClick && onStageClick(stage.id)}
              disabled={!canClick}
              className={cn(
                'w-full group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left',
                isCurrent && 'bg-primary/10 border border-primary/30',
                !isCurrent && canClick && 'hover:bg-[var(--bg-card-hover)]',
                !canClick && 'opacity-50 cursor-not-allowed'
              )}
            >
              {/* 步骤指示器 */}
              <div
                className={cn(
                  'flex items-center justify-center w-7 h-7 rounded-full border-2 transition-all shrink-0',
                  isCompleted && 'border-primary bg-primary text-white',
                  isCurrent && !isCompleted && 'border-primary text-primary',
                  !isCurrent && !isCompleted && 'border-[var(--border-subtle)] text-[var(--text-muted)]'
                )}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </div>

              {/* 内容 */}
              <div className="flex-1 min-w-0">
                <div
                  className={cn(
                    'text-sm font-medium',
                    isCurrent ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                  )}
                >
                  {stage.label}
                </div>
                <div className="text-xs text-[var(--text-muted)] truncate">
                  {stage.description}
                </div>
              </div>

              {/* 箭头 */}
              {canClick && !isCurrent && (
                <ChevronRight
                  className={cn(
                    'w-4 h-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity'
                  )}
                />
              )}

              {/* 当前阶段指示器 */}
              {isCurrent && (
                <motion.div
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r"
                  layoutId="current-stage-indicator"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 快捷操作 */}
      <div className="pt-3 border-t border-[var(--border-subtle)]">
        <button
          onClick={() => onStageClick('free-writing')}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm',
            'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
            'hover:bg-[var(--bg-card-hover)]',
            currentStage === 'free-writing' && 'bg-[var(--bg-card-hover)] text-[var(--text-primary)]'
          )}
        >
          <MoreHorizontal className="w-4 h-4" />
          <span>自由写作模式</span>
        </button>
      </div>
    </div>
  );
}

function getStageIcon(iconName: string) {
  const iconMap: Record<string, any> = {
    lightbulb: Lightbulb,
    'list-tree': ListTree,
    'file-edit': FileEdit,
    sparkles: Sparkles,
    'check-circle': CheckCircle2,
    eye: Eye,
    send: Send,
    'more-horizontal': MoreHorizontal,
  };
  return iconMap[iconName] || Lightbulb;
}
