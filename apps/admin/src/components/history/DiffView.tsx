import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, ArrowLeft, ArrowRight, Code } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContentSnapshot, DiffResult } from '@/types/content-history';
import { diffLines, diffWords, Change } from 'diff';

interface DiffViewProps {
  snapshot1: ContentSnapshot;
  snapshot2: ContentSnapshot;
  onClose: () => void;
}

export function DiffView({ snapshot1, snapshot2, onClose }: DiffViewProps) {
  // 计算差异
  const lineDiff = useMemo(() => {
    return diffLines(snapshot1.content, snapshot2.content);
  }, [snapshot1.content, snapshot2.content]);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    let unchanged = 0;

    lineDiff.forEach(change => {
      const lines = change.value.split('\n').filter(l => l.trim()).length;
      if (change.added) {
        added += lines;
      } else if (change.removed) {
        removed += lines;
      } else {
        unchanged += lines;
      }
    });

    return { added, removed, unchanged, total: added + removed + unchanged };
  }, [lineDiff]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-6xl h-[90vh] bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] shadow-2xl flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Code className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">版本对比</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 版本信息 */}
          <div className="flex items-center gap-4">
            <div className="flex-1 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-center gap-2 mb-1">
                <ArrowLeft className="w-4 h-4 text-red-500" />
                <span className="text-sm font-medium text-red-500">原版本</span>
              </div>
              <p className="text-sm text-[var(--text-primary)] truncate">{snapshot1.title}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {new Date(snapshot1.timestamp).toLocaleString('zh-CN')}
              </p>
            </div>

            <div className="flex-1 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center gap-2 mb-1">
                <ArrowRight className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-medium text-emerald-500">新版本</span>
              </div>
              <p className="text-sm text-[var(--text-primary)] truncate">{snapshot2.title}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {new Date(snapshot2.timestamp).toLocaleString('zh-CN')}
              </p>
            </div>
          </div>

          {/* 统计信息 */}
          <div className="flex items-center gap-6 mt-3 px-4 py-2 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)]">总行数:</span>
              <span className="text-sm font-medium text-[var(--text-primary)]">{stats.total}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-emerald-500">+{stats.added}</span>
              <span className="text-xs text-[var(--text-muted)]">新增</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-500">-{stats.removed}</span>
              <span className="text-xs text-[var(--text-muted)]">删除</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)]">{stats.unchanged} 未变</span>
            </div>
          </div>
        </div>

        {/* 差异内容 */}
        <div className="flex-1 overflow-auto">
          <div className="min-h-full bg-[var(--bg-primary)]">
            <DiffContent changes={lineDiff} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ==================== 差异内容组件 ====================

interface DiffContentProps {
  changes: Change[];
}

function DiffContent({ changes }: DiffContentProps) {
  let oldLineNum = 1;
  let newLineNum = 1;

  return (
    <div className="font-mono text-sm">
      {changes.map((change, index) => {
        const lines = change.value.split('\n');

        return lines.map((line, lineIndex) => {
          // 跳过空行（除非是最后一行的换行符）
          if (!line && lineIndex === lines.length - 1) return null;

          let oldNum = '';
          let newNum = '';
          let bgColor = '';
          let textColor = 'text-[var(--text-primary)]';
          let borderColor = 'border-transparent';
          let prefix = ' ';

          if (change.added) {
            newNum = String(newLineNum++);
            bgColor = 'bg-emerald-500/10';
            borderColor = 'border-l-emerald-500';
            textColor = 'text-emerald-600 dark:text-emerald-400';
            prefix = '+';
          } else if (change.removed) {
            oldNum = String(oldLineNum++);
            bgColor = 'bg-red-500/10';
            borderColor = 'border-l-red-500';
            textColor = 'text-red-600 dark:text-red-400';
            prefix = '-';
          } else {
            oldNum = String(oldLineNum++);
            newNum = String(newLineNum++);
            bgColor = 'bg-transparent';
            textColor = 'text-[var(--text-secondary)]';
          }

          return (
            <div
              key={`${index}-${lineIndex}`}
              className={cn(
                'flex items-start border-l-2 transition-colors',
                bgColor,
                borderColor,
                'hover:bg-[var(--bg-card-hover)]'
              )}
            >
              {/* 行号 */}
              <div className="flex shrink-0">
                <div className="w-12 px-2 py-1 text-right text-xs text-[var(--text-muted)] select-none">
                  {oldNum}
                </div>
                <div className="w-12 px-2 py-1 text-right text-xs text-[var(--text-muted)] select-none border-r border-[var(--border-subtle)]">
                  {newNum}
                </div>
              </div>

              {/* 内容 */}
              <div className="flex-1 px-4 py-1 overflow-x-auto">
                <span className={cn('select-none mr-2', textColor)}>{prefix}</span>
                <span className={textColor}>{line || ' '}</span>
              </div>
            </div>
          );
        });
      })}
    </div>
  );
}
