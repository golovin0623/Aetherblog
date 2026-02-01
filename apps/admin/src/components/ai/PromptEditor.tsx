import React, { useState, useEffect } from 'react';
import { Save, RotateCcw, Info, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@aetherblog/ui';
import { toast } from 'sonner';

interface PromptEditorProps {
  taskType: string;
  defaultPrompt: string;
  customPrompt: string;
  onSave: (prompt: string | null) => Promise<void>;
  isLoading?: boolean;
  className?: string;
}

export const PromptEditor: React.FC<PromptEditorProps> = ({
  taskType,
  defaultPrompt,
  customPrompt: initialCustomPrompt,
  onSave,
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

  const handleClear = () => {
    setPrompt('');
    setIsDirty(true);
  };

  return (
    <div className={cn("flex flex-col h-full relative group", className)}>
      <div className="flex-1 relative min-h-0 flex flex-col">

        {showDefault ? (
          <div className="h-full overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-[var(--border-subtle)] scrollbar-track-transparent bg-[var(--bg-secondary)]">
            <div className="mr-[100px] flex items-start gap-2 p-4 rounded-xl bg-primary/5 border border-primary/10 mb-4 animate-in fade-in slide-in-from-top-1 duration-300">
              <Info className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                当前系统默认 Prompt。若要自定义，请关闭视图并在输入框修改。可用变量: {'{content}'}, {'{max_length}'}。
              </p>
            </div>
            <pre className="text-[11px] font-mono p-4 rounded-lg bg-black/5 dark:bg-black/20 text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed border border-[var(--border-subtle)]/50">
              {defaultPrompt}
            </pre>
          </div>
        ) : (
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setIsDirty(true);
            }}
            placeholder={`在此插入该功能的自定义 Prompt 模板...\n留空则使用系统默认策略。`}
            className="w-full h-full p-6 text-[13px] font-mono bg-transparent border-none focus:ring-0 resize-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/20 leading-relaxed overflow-y-auto scrollbar-thin scrollbar-thumb-[var(--border-subtle)] scrollbar-track-transparent transition-colors"
          />
        )}
      </div>

      {/* Subtle Floating Toolbar */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowDefault(!showDefault)}
          className={cn(
            "h-7 px-2 text-[10px] uppercase tracking-wider font-bold rounded-md border backdrop-blur-md transition-all",
            showDefault 
              ? "bg-primary text-white border-primary shadow-lg shadow-primary/20" 
              : "bg-[var(--bg-card)]/50 text-[var(--text-muted)] border-[var(--border-subtle)] hover:border-primary/50 hover:text-primary"
          )}
        >
          {showDefault ? '退出预览' : '查看默认'}
        </Button>
        {isDirty && !showDefault && (
          <div className="flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-200">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="h-7 px-2 text-[10px] uppercase tracking-wider font-bold bg-[var(--bg-card)]/50 border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-red-500 backdrop-blur-md"
            >
              重置
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isLoading}
              className="h-7 px-2 text-[10px] uppercase tracking-wider font-bold bg-black text-white dark:bg-white dark:text-black shadow-lg shadow-black/10 dark:shadow-white/5"
            >
              保存
            </Button>
          </div>
        )}
      </div>

      <div className="mx-4 mb-2 px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] flex items-center justify-between text-[10px] text-[var(--text-muted)] select-none backdrop-blur-sm shadow-sm">
        <div className="flex items-center gap-2">
          <Terminal className="w-3 h-3 opacity-60" />
          <span className="font-medium tracking-tight">内容上下文 / {prompt ? '自定义模板' : '系统默认'}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-medium tracking-tight truncate max-w-[80px]">{prompt.length} 字符</span>
          <span className={cn(
            "w-1.5 h-1.5 rounded-full",
            prompt ? "bg-primary shadow-[0_0_8px_rgba(var(--primary-rgb),0.5)] animate-pulse" : "bg-[var(--border-subtle)]"
          )} />
        </div>
      </div>
    </div>
  );
};
