import React, { useState, useEffect } from 'react';
import { Sparkles, Send, Loader2, Code, FileText, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@aetherblog/ui';
import { PromptEditor } from './PromptEditor';
import { apiClient as api } from '@/services/api';
import { toast } from 'sonner';
import ModelSelector from '@/components/ai/ModelSelector';

interface Tool {
  id: string;
  label: string;
  desc: string;
}

interface PromptConfig {
  task_type: string;
  default_prompt: string;
  custom_prompt: string | null;
}

interface AIToolsWorkspaceProps {
  selectedTool: Tool;
  allConfigs: PromptConfig[];
  onConfigUpdated: () => void;
  isGlobalLoading: boolean;
}

export const AIToolsWorkspace: React.FC<AIToolsWorkspaceProps> = ({ 
  selectedTool, 
  allConfigs, 
  onConfigUpdated,
  isGlobalLoading
}) => {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedProviderCode, setSelectedProviderCode] = useState<string>('');

  // Get current tool's prompt config from the pre-loaded list
  const promptConfig = allConfigs.find(c => c.task_type === selectedTool.id) || null;

  // Clear result when tool changes
  useEffect(() => {
    setResult(null);
  }, [selectedTool.id]);

  const handleRunTest = async () => {
    if (!input.trim()) {
      toast.error('请输入测试内容');
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      // Use the specific endpoint for the tool
      const endpoint = `/v1/admin/ai/${selectedTool.id}`;
      
      // Prepare request data based on tool
      const reqData: any = {
        content: input,
        promptTemplate: promptConfig?.custom_prompt || undefined,
        // Optional: Send selected model override if backend supports it
        // model: selectedModelId,
        // provider: selectedProviderCode
      };

      if (selectedModelId) {
        reqData.modelId = selectedModelId;
        reqData.providerCode = selectedProviderCode;
      }

      if (selectedTool.id === 'outline') {
        reqData.topic = input;
        delete reqData.content;
      }

      const res = await api.post<any>(endpoint, reqData);
      
      if (res.success) {
        setResult(res.data);
        toast.success(`${selectedTool.label} 生成成功`);
      } else {
        toast.error(res.errorMessage || '生成失败');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.response?.data?.message || '请求服务出错');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSavePrompt = async (newPrompt: string | null) => {
    try {
      const res = await api.put<any>(`/v1/admin/ai/prompts/${selectedTool.id}`, {
        prompt_template: newPrompt
      });
      if (res.success) {
        toast.success('Prompt 配置已更新');
        onConfigUpdated();
      }
    } catch (_err) {
      toast.error('保存失败');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 animate-in fade-in duration-500">
      {/* Input Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">测试内容</h2>
              <p className="text-xs text-[var(--text-muted)]">输入原始文本以验证 AI 生成效果</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <ModelSelector 
                value={selectedModelId}
                onChange={(modelId, provider) => {
                  setSelectedModelId(modelId);
                  setSelectedProviderCode(provider);
                }}
             />
            <Button
              onClick={handleRunTest}
              disabled={isLoading || !input.trim()}
              className="rounded-full px-6 gap-2 bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 transition-all active:scale-95"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              生成测试
            </Button>
          </div>
        </div>

        <div className="relative group">
          <div className="absolute -inset-[1px] bg-gradient-to-br from-primary/20 via-transparent to-primary/5 rounded-2xl blur-sm opacity-0 group-focus-within:opacity-100 transition-opacity" />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={selectedTool.id === 'outline' ? "输入文章主题 (例如: 如何写一个优秀的代码)" : "粘贴文章内容到这里进行测试..."}
            className="w-full h-80 p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/50 backdrop-blur-md focus:outline-none focus:ring-0 focus:border-primary/50 text-[var(--text-primary)] transition-all resize-none leading-relaxed text-sm font-light ring-offset-bg duration-300"
          />
          <div className="absolute bottom-4 right-4 text-[10px] text-[var(--text-muted)] font-mono flex items-center gap-4">
             <span>{input.length} CHARS</span>
             <button onClick={() => setInput('')} className="hover:text-primary transition-colors">CLEAR</button>
          </div>
        </div>

        {promptConfig && !isGlobalLoading && (
          <div className="pt-2">
            <PromptEditor
              taskType={selectedTool.id}
              defaultPrompt={promptConfig.default_prompt}
              customPrompt={promptConfig.custom_prompt || ''}
              onSave={handleSavePrompt}
              isLoading={isLoading}
            />
          </div>
        )}
      </div>

      {/* Result Section */}
      <div className="flex flex-col space-y-6">
        <div className="flex items-center gap-2 h-10">
          <div className="p-2 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </div>
          <h2 className="text-lg font-semibold bg-gradient-to-r from-[var(--text-primary)] to-[var(--text-muted)] bg-clip-text text-transparent">生成结果预览</h2>
        </div>

        <div className="flex-1 min-h-[460px] border border-[var(--border-subtle)] rounded-3xl bg-[var(--bg-card)]/20 backdrop-blur-2xl p-8 relative overflow-hidden group shadow-2xl shadow-black/5">
          {/* Decorative background element */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-colors duration-700" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl group-hover:bg-emerald-500/10 transition-colors duration-700" />
          
          <div className="absolute top-4 right-6 flex items-center gap-2">
             <div className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] text-[var(--text-muted)] font-mono opacity-0 group-hover:opacity-100 transition-opacity">PREVIEW_MODE</div>
             <Code className="w-4 h-4 text-[var(--text-muted)]/30 group-hover:text-primary transition-colors cursor-pointer" />
          </div>

          {!result && !isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
              <div className="p-4 rounded-full bg-[var(--bg-muted)] border border-[var(--border-subtle)]">
                <Sparkles className="w-8 h-8 text-[var(--text-muted)]" />
              </div>
              <div>
                <p className="text-[var(--text-primary)] font-medium">等待生成中</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">点击上方“生成测试”按钮查看效果</p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="h-full flex flex-col items-center justify-center space-y-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                <Sparkles className="absolute inset-0 m-auto w-4 h-4 text-primary animate-pulse" />
              </div>
              <p className="text-sm font-medium text-primary animate-pulse">AI 思考中...</p>
            </div>
          ) : (
            <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
              {renderResult(selectedTool.id, result)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Helper to render Different types of results
function renderResult(taskId: string, data: any) {
  if (!data) return null;

  switch (taskId) {
    case 'summary':
      return (
        <div className="relative animate-in fade-in slide-in-from-right-4 duration-700">
          <div className="absolute -left-4 top-0 bottom-0 w-1 bg-gradient-to-b from-primary via-primary/50 to-transparent rounded-full shadow-[0_0_15px_rgba(var(--primary-rgb),0.3)]" />
          <div className="text-[var(--text-primary)] text-lg leading-relaxed font-light tracking-wide italic">
             “{data.summary}”
          </div>
          <div className="mt-8 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
            <div className="flex gap-4 text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-primary" /> {data.characterCount} CHARACTERS</span>
              <span>TYPE: AUTO_SUMMARY</span>
            </div>
            <button className="text-xs text-primary hover:underline font-medium">复制结果</button>
          </div>
        </div>
      );
    case 'tags':
      return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-700">
          <p className="text-xs text-[var(--text-muted)] font-mono tracking-tighter uppercase mb-4">Recommended Tags</p>
          <div className="flex flex-wrap gap-3">
            {data.tags?.map((tag: string, i: number) => (
              <button 
                key={tag} 
                className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-[var(--text-primary)] hover:bg-primary hover:text-white hover:border-primary transition-all duration-300 hover:scale-110 active:scale-95 animate-in zoom-in-50"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>
      );
    case 'titles':
      return (
        <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-700">
           <p className="text-xs text-[var(--text-muted)] font-mono tracking-tighter uppercase mb-2">Headline Suggestions</p>
          {data.titles?.map((title: string, i: number) => (
            <div 
              key={i} 
              className="group/item flex items-center justify-between p-5 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-primary/20 hover:shadow-xl transition-all cursor-pointer duration-500 animate-in slide-in-from-right-2"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <span className="text-[var(--text-primary)] font-medium leading-tight group-hover/item:text-primary transition-colors">{title}</span>
              <div className="opacity-0 group-hover/item:opacity-100 transition-opacity whitespace-nowrap ml-4">
                 <span className="text-[10px] bg-primary text-white px-2 py-0.5 rounded-full shadow-lg shadow-primary/20">COPY</span>
              </div>
            </div>
          ))}
        </div>
      );
    case 'polish':
      return (
        <div className="relative animate-in fade-in duration-1000">
          <div className="p-6 rounded-2xl bg-black/5 dark:bg-black/20 border border-white/5 font-light text-[var(--text-primary)] leading-loose whitespace-pre-wrap selection:bg-primary selection:text-white">
            {data.content}
          </div>
          <div className="mt-6 flex justify-end">
            <Button size="sm" variant="secondary" className="rounded-full text-xs border-primary/20 text-primary hover:bg-primary/10">应用修改</Button>
          </div>
        </div>
      );
    case 'outline': {
      const lines = data.outline?.split('\n') || [];
      return (
        <div className="space-y-2 animate-in fade-in slide-in-from-right-4 duration-700">
          {lines.map((line: string, i: number) => {
            const isHeader = line.startsWith('#') || line.match(/^[0-9]+\./);
            return (
              <div 
                key={i} 
                className={cn(
                  "p-2.5 rounded-lg border border-transparent transition-colors",
                  isHeader ? "text-[var(--text-primary)] font-bold text-base mt-4" : "text-[var(--text-muted)] font-light text-sm ml-4 border-l-border pl-4",
                  line.trim() === "" && "h-4"
                )}
              >
                {line}
              </div>
            );
          })}
        </div>
      );
    }
    default:
      return <pre className="text-xs text-[var(--text-primary)] opacity-50 font-mono p-4 rounded-xl bg-black/10">{JSON.stringify(data, null, 2)}</pre>;
  }
}
