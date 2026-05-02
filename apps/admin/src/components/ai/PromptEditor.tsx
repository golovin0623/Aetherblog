import React, { useMemo, useState, useEffect } from 'react';
import { Info, Terminal, X, ChevronRight, Undo2 } from 'lucide-react';
import { diffLines, type Change } from 'diff';
import { cn } from '@/lib/utils';
import { ConfirmModal } from '@aetherblog/ui';
import { toast } from 'sonner';

interface PromptEditorProps {
  taskType: string;
  defaultPrompt: string;
  customPrompt: string;
  onSave: (prompt: string | null) => Promise<void>;
  onClose: () => void;
  isLoading?: boolean;
  className?: string;
}

type ViewMode = 'edit' | 'default' | 'diff';

export const PromptEditor: React.FC<PromptEditorProps> = ({
  taskType,
  defaultPrompt,
  customPrompt: initialCustomPrompt,
  onSave,
  onClose,
  isLoading = false,
  className
}) => {
  const [prompt, setPrompt] = useState(initialCustomPrompt || '');
  const [isDirty, setIsDirty] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    setPrompt(initialCustomPrompt || '');
    setIsDirty(false);
  }, [initialCustomPrompt]);

  const handleSave = async () => {
    await onSave(prompt || null);
    setIsDirty(false);
  };

  const handleDiscard = () => {
    setPrompt(initialCustomPrompt || '');
    setIsDirty(false);
    toast.info('已撤销本地修改');
  };

  const handleRestoreDefault = async () => {
    setRestoreOpen(false);
    setRestoring(true);
    try {
      await onSave(null);
      // 父组件 onConfigUpdated() 会重新加载, customPrompt 将变为空
      // useEffect 监听 initialCustomPrompt 变化时把本地编辑器重置为空
      toast.success('已恢复为系统默认 Prompt');
      setViewMode('default');
    } catch {
      // onSave 内部已 toast 错误信息
    } finally {
      setRestoring(false);
    }
  };

  const hasOverride = (initialCustomPrompt || '').trim().length > 0;

  return (
    <div className={cn("flex flex-col h-full min-h-0 bg-[var(--bg-secondary)] relative overflow-hidden", className)}>
      {/* 头部区域 */}
      <div className="flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/30 backdrop-blur-md z-20 flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="p-1.5 sm:p-2 rounded-xl bg-primary text-white border border-[var(--border-default)] flex-shrink-0">
            <Terminal className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-[var(--text-primary)] tracking-tight truncate">Prompt 专家配置</h3>
            <div className="hidden sm:flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-[var(--text-muted)] uppercase font-medium">Task: {taskType}</span>
              <ChevronRight className="w-2.5 h-2.5 text-[var(--text-muted)] opacity-50" />
              <span className="text-[10px] text-primary font-black uppercase tracking-widest animate-pulse">Live Editor</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* 视图切换：Edit / Default / Diff */}
          <ViewModeSwitch value={viewMode} onChange={setViewMode} />

          {/* 恢复默认（仅在有自定义覆写时显示） */}
          {hasOverride && (
            <button
              onClick={() => setRestoreOpen(true)}
              disabled={restoring || isLoading}
              title="清除自定义覆写, 让本任务回到系统默认 Prompt"
              className="hidden sm:flex items-center gap-1.5 h-9 px-3 rounded-xl text-[10px] font-mono uppercase tracking-[0.18em]
                bg-[color-mix(in_oklch,var(--signal-warn)_14%,transparent)]
                hover:bg-[color-mix(in_oklch,var(--signal-warn)_24%,transparent)]
                text-[var(--signal-warn)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal-warn)]/40"
            >
              <Undo2 className="w-3.5 h-3.5" />
              恢复默认
            </button>
          )}

          {/* 保存 / 重置操作（仅 edit 模式有意义） */}
          {isDirty && viewMode === 'edit' && (
            <div className="flex items-center gap-1 sm:gap-1.5 animate-in fade-in slide-in-from-right-4 duration-300">
              <button
                onClick={handleDiscard}
                className="h-8 sm:h-9 px-2 sm:px-3 rounded-xl text-[9px] sm:text-[10px] font-black bg-status-danger-light text-status-danger hover:bg-status-danger/20 uppercase tracking-widest transition-all"
              >
                Discard
              </button>
              <button
                onClick={handleSave}
                disabled={isLoading}
                className="h-8 sm:h-9 px-3 sm:px-4 rounded-xl text-[9px] sm:text-[10px] font-black bg-primary text-white shadow-xl hover:opacity-90 active:scale-95 uppercase tracking-widest transition-all"
              >
                Deploy
              </button>
            </div>
          )}

          <div className="w-px h-5 sm:h-6 bg-[var(--border-subtle)] mx-0.5 sm:mx-1" />

          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-full hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 编辑器正文 */}
      <div className="flex-1 relative min-h-0 flex flex-col group/editor overflow-hidden">
        {viewMode === 'default' && (
          <div className="flex-1 overflow-y-auto p-3 sm:p-8 bg-[var(--bg-card)]/20 animate-in fade-in zoom-in-95 duration-300 no-scrollbar">
            <div className="flex items-start gap-2 sm:gap-3 p-3 sm:p-5 rounded-2xl bg-[var(--bg-tertiary)] dark:bg-[var(--bg-secondary)]/50 border border-[var(--border-default)] mb-3 sm:mb-6">
              <Info className="w-4 h-4 text-black dark:text-white mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-[11px] sm:text-xs font-bold text-black dark:text-white uppercase tracking-tighter">System Strategy Preview</p>
                <p className="text-[10px] sm:text-[11px] text-[var(--text-muted)] leading-relaxed">
                  当前为系统默认 Prompt, 只读模式。自定义更改将覆盖此策略; 「恢复默认」会清除覆写让本任务回到这里。
                </p>
              </div>
            </div>
            <div className="relative rounded-2xl border border-[var(--border-subtle)] bg-black/5 dark:bg-black/40 p-3 sm:p-6 mb-16 sm:mb-24">
              <div className="absolute top-0 bottom-0 left-0 w-1 bg-black/30 dark:bg-white/30 rounded-full" />
              <pre className="text-[11px] sm:text-[13px] font-mono text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed pl-3">
                {defaultPrompt}
              </pre>
            </div>
          </div>
        )}

        {viewMode === 'diff' && (
          <PromptDiffView
            defaultPrompt={defaultPrompt}
            currentPrompt={prompt}
            isDirty={isDirty}
          />
        )}

        {viewMode === 'edit' && (
          <div className="flex-1 relative flex flex-col pt-2 sm:pt-4 overflow-hidden">
            {/* 带 gutter 视觉感的 textarea */}
            <div className="flex-1 px-3 sm:px-8 pb-20 sm:pb-32 overflow-y-auto no-scrollbar">
              <textarea
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setIsDirty(true);
                }}
                placeholder={`在此定义自定义 Prompt 策略...\n使用 {content} 作为输入变量占位符。`}
                className="w-full h-full min-h-[200px] bg-transparent border-none focus:ring-0 resize-none text-[12px] sm:text-[14px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/20 leading-[1.8] tracking-tight no-scrollbar"
              />
            </div>
          </div>
        )}

        {/* 悬浮变量徽章 */}
        {viewMode === 'edit' && (
          <div className="absolute top-6 right-8 flex flex-col gap-2 pointer-events-none opacity-40 group-focus-within/editor:opacity-10 transition-opacity">
            <div className="px-2 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[9px] font-mono text-[var(--text-muted)] shadow-sm">
              {'{content}'} REQUIRED
            </div>
          </div>
        )}
      </div>

      {/* 悬浮状态徽章（仅桌面端 / 仅 edit 模式）—— 位于工具栏上方 */}
      {viewMode === 'edit' && (
        <div className="hidden sm:flex absolute bottom-24 left-8 items-center gap-4 px-4 py-2 rounded-2xl bg-[var(--bg-card)]/50 backdrop-blur-md border border-[var(--border-subtle)] shadow-xl z-20 pointer-events-none">
          <div className="flex flex-col">
            <span className="text-[9px] font-black italic text-[var(--text-muted)] uppercase tracking-tighter">Status</span>
            <span className="text-[10px] font-bold text-[var(--text-primary)]">
              {prompt.length} CHARS
            </span>
          </div>
          <div className="w-px h-6 bg-[var(--border-subtle)]" />
          <div className="flex flex-col">
            <span className="text-[9px] font-black italic text-[var(--text-muted)] uppercase tracking-tighter">Storage</span>
            <span className="text-[10px] font-medium text-[var(--text-muted)]">
              {prompt ? 'OVERRIDE' : 'SYSTEM'}
            </span>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={restoreOpen}
        title="确认恢复为系统默认 Prompt?"
        message={
          `这将立即清除本任务 (${taskType}) 的自定义覆写, AI 服务下次调用时会回到 migration 中的系统默认策略。\n\n` +
          `· 此操作仅清除本机环境共用的覆写, 不影响 migration 内置的默认 prompt\n` +
          `· 操作不可撤销, 但你可以在「Default」视图复制默认内容后再次粘贴回编辑器`
        }
        confirmText="恢复默认"
        cancelText="取消"
        variant="warning"
        onConfirm={handleRestoreDefault}
        onCancel={() => setRestoreOpen(false)}
      />
    </div>
  );
};

// ==================== 视图切换 ====================

interface ViewModeSwitchProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

function ViewModeSwitch({ value, onChange }: ViewModeSwitchProps) {
  const items: Array<{ id: ViewMode; label: string }> = [
    { id: 'edit', label: 'Edit' },
    { id: 'default', label: 'Default' },
    { id: 'diff', label: 'Diff' },
  ];
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
      {items.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              'h-7 sm:h-8 px-2.5 sm:px-3 rounded-lg text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.18em] transition-colors',
              active
                ? 'bg-primary text-white shadow-md'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// ==================== Diff 预览 ====================

interface PromptDiffViewProps {
  defaultPrompt: string;
  currentPrompt: string;
  isDirty: boolean;
}

function PromptDiffView({ defaultPrompt, currentPrompt, isDirty }: PromptDiffViewProps) {
  const changes = useMemo<Change[]>(
    () => diffLines(defaultPrompt || '', currentPrompt || ''),
    [defaultPrompt, currentPrompt],
  );

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    changes.forEach((c) => {
      const lines = c.value.split('\n').filter((l, idx, arr) => l.length > 0 || idx < arr.length - 1).length;
      if (c.added) added += lines;
      else if (c.removed) removed += lines;
      else unchanged += lines;
    });
    return { added, removed, unchanged };
  }, [changes]);

  const isIdentical = stats.added === 0 && stats.removed === 0;

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg-card)]/20 animate-in fade-in zoom-in-95 duration-300 no-scrollbar pb-16 sm:pb-24">
      {/* 信息条 */}
      <div className="px-3 sm:px-8 pt-3 sm:pt-6">
        <div className="flex items-start gap-2 sm:gap-3 p-3 sm:p-5 rounded-2xl bg-[var(--bg-tertiary)] dark:bg-[var(--bg-secondary)]/50 border border-[var(--border-default)] mb-3 sm:mb-5">
          <Info className="w-4 h-4 text-black dark:text-white mt-0.5 shrink-0" />
          <div className="space-y-1 flex-1 min-w-0">
            <p className="text-[11px] sm:text-xs font-bold text-black dark:text-white uppercase tracking-tighter">
              Diff: System Default ↔ {isDirty ? 'Editor (unsaved)' : 'Saved Override'}
            </p>
            <p className="text-[10px] sm:text-[11px] text-[var(--text-muted)] leading-relaxed">
              {isIdentical
                ? '当前内容与系统默认 Prompt 完全一致 —— 没有可见差异。'
                : `+${stats.added} 新增 · -${stats.removed} 删除 · ${stats.unchanged} 行未变`}
            </p>
          </div>
        </div>
      </div>

      {/* 差异内容 */}
      <div className="mx-3 sm:mx-8 rounded-2xl border border-[var(--border-subtle)] bg-black/5 dark:bg-black/40 overflow-hidden">
        {isIdentical ? (
          <div className="px-4 py-8 text-center text-xs font-mono uppercase tracking-[0.2em] text-[var(--text-muted)]">
            no changes to display
          </div>
        ) : (
          <DiffBody changes={changes} />
        )}
      </div>
    </div>
  );
}

interface DiffBodyProps {
  changes: Change[];
}

function DiffBody({ changes }: DiffBodyProps) {
  let oldLineNum = 1;
  let newLineNum = 1;
  return (
    <div className="font-mono text-[11px] sm:text-[13px]">
      {changes.map((change, idx) => {
        const lines = change.value.split('\n');
        return lines.map((line, lineIdx) => {
          if (line === '' && lineIdx === lines.length - 1) return null;

          let oldNum = '';
          let newNum = '';
          let bg = 'bg-transparent';
          let strip = 'border-l-transparent';
          let textColor = 'text-[var(--text-secondary)]';
          let prefix = ' ';

          if (change.added) {
            newNum = String(newLineNum++);
            bg = 'bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)]';
            strip = 'border-l-[var(--signal-success)]';
            textColor = 'text-[var(--signal-success)]';
            prefix = '+';
          } else if (change.removed) {
            oldNum = String(oldLineNum++);
            bg = 'bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)]';
            strip = 'border-l-[var(--signal-danger)]';
            textColor = 'text-[var(--signal-danger)]';
            prefix = '-';
          } else {
            oldNum = String(oldLineNum++);
            newNum = String(newLineNum++);
          }

          return (
            <div
              key={`${idx}-${lineIdx}`}
              className={cn('flex items-start border-l-2 transition-colors hover:bg-[var(--bg-card-hover)]/40', bg, strip)}
            >
              <div className="flex shrink-0">
                <div className="w-10 px-2 py-1 text-right text-[10px] text-[var(--text-muted)]/60 select-none">
                  {oldNum}
                </div>
                <div className="w-10 px-2 py-1 text-right text-[10px] text-[var(--text-muted)]/60 select-none border-r border-[var(--border-subtle)]">
                  {newNum}
                </div>
              </div>
              <div className="flex-1 px-3 py-1 overflow-x-auto whitespace-pre">
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
