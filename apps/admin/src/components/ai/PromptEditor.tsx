import React, { useState, useEffect } from 'react';
import { Save, RotateCcw, Info, Terminal, X, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@aetherblog/ui';
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
  const [showDefault, setShowDefault] = useState(false);

  useEffect(() => {
    setPrompt(initialCustomPrompt || '');
    setIsDirty(false);
  }, [initialCustomPrompt]);

  const handleSave = async () => {
    await onSave(prompt || null);
    setIsDirty(false);
  };

  const handleReset = () => {
    setPrompt(initialCustomPrompt || '');
    setIsDirty(false);
    toast.info('已重置更改');
  };

  return (
    <div className={cn("flex flex-col h-full bg-[var(--bg-secondary)] relative overflow-hidden", className)}>
      {/* Header Area */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/30 backdrop-blur-md z-20">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-black text-white dark:bg-zinc-800 dark:text-white border border-zinc-200 dark:border-zinc-700">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] tracking-tight">Prompt 专家配置</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-[var(--text-muted)] uppercase font-medium">Task: {taskType}</span>
              <ChevronRight className="w-2.5 h-2.5 text-[var(--text-muted)] opacity-50" />
              <span className="text-[10px] text-black dark:text-white font-black uppercase tracking-widest animate-pulse">Live Editor</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <button
            onClick={() => setShowDefault(!showDefault)}
            className={cn(
              "h-9 px-3 sm:px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border",
              showDefault
                ? "bg-black text-white dark:bg-white dark:text-black border-transparent shadow-lg"
                : "bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]"
            )}
          >
            {showDefault ? 'Exit Preview' : 'View Default'}
          </button>

          {/* Save/Reset Actions */}
          {isDirty && !showDefault && (
            <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-right-4 duration-300">
              <button
                onClick={handleReset}
                className="h-9 px-3 rounded-xl text-[10px] font-black bg-red-500/10 text-red-500 hover:bg-red-500/20 uppercase tracking-widest transition-all"
              >
                Discard
              </button>
              <button
                onClick={handleSave}
                disabled={isLoading}
                className="h-9 px-4 rounded-xl text-[10px] font-black bg-black text-white dark:bg-white dark:text-black shadow-xl hover:opacity-90 active:scale-95 uppercase tracking-widest transition-all"
              >
                Deploy
              </button>
            </div>
          )}

          <div className="w-px h-6 bg-[var(--border-subtle)] mx-1" />

          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 relative min-h-0 flex flex-col group/editor">
        {showDefault ? (
          <div className="h-full overflow-y-auto p-4 sm:p-8 bg-[var(--bg-card)]/20 animate-in fade-in zoom-in-95 duration-300 no-scrollbar">
            <div className="flex items-start gap-3 p-4 sm:p-5 rounded-2xl bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 mb-4 sm:mb-6">
              <Info className="w-4 h-4 text-black dark:text-white mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-black dark:text-white uppercase tracking-tighter">System Strategy Preview</p>
                <p className="text-[10px] sm:text-[11px] text-[var(--text-muted)] leading-relaxed">
                  当前为系统默认 Prompt，只读模式。自定义更改将覆盖此策略。
                </p>
              </div>
            </div>
            <div className="relative rounded-2xl border border-[var(--border-subtle)] bg-black/5 dark:bg-black/40 p-4 sm:p-6 mb-24">
              <div className="absolute top-0 bottom-0 left-0 w-1 bg-black/30 dark:bg-white/30 rounded-full" />
              <pre className="text-[12px] sm:text-[13px] font-mono text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                {defaultPrompt}
              </pre>
            </div>
          </div>
        ) : (
          <div className="flex-1 relative flex flex-col pt-4">
            {/* Textarea with gutter feel */}
            <div className="flex-1 px-4 sm:px-8 pb-32">
              <textarea
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setIsDirty(true);
                }}
                placeholder={`在此定义自定义 Prompt 策略...\n使用 {content} 作为输入变量占位符。`}
                className="w-full h-full bg-transparent border-none focus:ring-0 resize-none text-[13px] sm:text-[14px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/20 leading-[1.8] tracking-tight no-scrollbar"
              />
            </div>
          </div>
        )}

        {/* Floating Variable Badge */}
        {!showDefault && (
          <div className="absolute top-6 right-8 flex flex-col gap-2 pointer-events-none opacity-40 group-focus-within/editor:opacity-10 transition-opacity">
            <div className="px-2 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[9px] font-mono text-[var(--text-muted)] shadow-sm">
              {'{content}'} REQUIRED
            </div>
          </div>
        )}
      </div>

      {/* Floating Status Badge (Desktop only) */}
      <div className="hidden sm:flex absolute bottom-8 left-8 items-center gap-4 px-4 py-2 rounded-2xl bg-[var(--bg-card)]/50 backdrop-blur-md border border-[var(--border-subtle)] shadow-xl z-20 pointer-events-none">
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
    </div>  );
};
