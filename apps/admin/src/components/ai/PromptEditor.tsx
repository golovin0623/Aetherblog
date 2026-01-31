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
}

export const PromptEditor: React.FC<PromptEditorProps> = ({
  taskType,
  defaultPrompt,
  customPrompt: initialCustomPrompt,
  onSave,
  isLoading = false,
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
            Prompt 模板管理
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDefault(!showDefault)}
            className={cn(
              "text-xs gap-1.5 h-8 px-3 rounded-lg transition-colors",
              showDefault ? "bg-primary/10 text-primary" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            )}
          >
            <Info className="w-3.5 h-3.5" />
            查看默认
          </Button>
          {isDirty && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="text-xs h-8 px-3 text-[var(--text-muted)] hover:text-destructive"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                重置
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isLoading}
                className="text-xs h-8 px-3 gap-1.5 bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20"
              >
                <Save className="w-3.5 h-3.5" />
                保存配置
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="relative group">
        <div className="absolute -inset-[1px] bg-gradient-to-br from-primary/20 via-transparent to-primary/5 rounded-xl blur-sm opacity-0 group-focus-within:opacity-100 transition-opacity" />
        <div className="relative flex flex-col min-h-[200px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/50 backdrop-blur-md overflow-hidden transition-all duration-300 group-focus-within:border-primary/30 group-focus-within:shadow-2xl group-focus-within:shadow-primary/5">
          {showDefault ? (
            <div className="p-4 flex-1">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10 mb-3">
                <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  当前任务类型的系统默认 Prompt。若要自定义，请关闭此视图并在下方编辑器中修改。支持变量使用 <code>{'{'}variable_name{'}'}</code> 格式。
                </p>
              </div>
              <pre className="text-sm font-mono p-4 rounded-lg bg-black/5 dark:bg-black/20 text-[var(--text-primary)] overflow-auto whitespace-pre-wrap leading-relaxed">
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
              placeholder={`在此输入自定义 Prompt 模版... (留空则使用默认)\n可用变量: {content}, {max_length} 等`}
              className="flex-1 p-6 text-sm font-mono bg-transparent border-none focus:ring-0 resize-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 leading-relaxed min-h-[200px]"
            />
          )}

          <div className="px-4 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-muted)]/30 flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono uppercase tracking-widest">
            <span>{taskType.toUpperCase()} CONTEXT</span>
            <span>{prompt ? 'CUSTOM TEMPLATE' : 'SYSTEM DEFAULT'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
