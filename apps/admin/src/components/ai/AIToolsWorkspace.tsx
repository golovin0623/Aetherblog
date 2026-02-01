import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowUpRight, Code, FileText, CheckCircle2, Square, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PromptEditor } from './PromptEditor';
import { apiClient as api } from '@/services/api';
import { toast } from 'sonner';
import ModelSelector from '@/components/ai/ModelSelector';
import { useStreamResponse } from '@/hooks/useStreamResponse';
import { useTheme } from '@/hooks';
import { ThinkingBlock } from './ThinkingBlock';
import { MarkdownPreview, markdownPreviewStyles } from '@aetherblog/editor';

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

// AI 服务直连地址 (通过 Nginx 代理)
const AI_SERVICE_URL = '/api/v1/ai';

export const AIToolsWorkspace: React.FC<AIToolsWorkspaceProps> = ({ 
  selectedTool, 
  allConfigs, 
  onConfigUpdated,
  isGlobalLoading
}) => {
  const [input, setInput] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedProviderCode, setSelectedProviderCode] = useState<string>('');
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const { resolvedTheme } = useTheme();

  // Streaming state
  const {
    content: streamContent,
    thinkContent,
    isThinking,
    isLoading: isStreaming,
    isDone,
    error: streamError,
    stream,
    reset: resetStream,
    abort
  } = useStreamResponse();

  // Get current tool's prompt config from the pre-loaded list
  const promptConfig = allConfigs.find(c => c.task_type === selectedTool.id) || null;

  // Clear result when tool changes
  useEffect(() => {
    resetStream();
  }, [selectedTool.id, resetStream]);

  const handleRunTest = async () => {
    if (!input.trim()) {
      toast.error('请输入测试内容');
      return;
    }

    if (!selectedModelId) {
      toast.error('请先选择一个模型');
      return;
    }

    // Prepare request data based on tool
    const reqData: Record<string, unknown> = {
      content: input,
      promptTemplate: promptConfig?.custom_prompt || undefined,
    };

    if (selectedModelId) {
      reqData.modelId = selectedModelId;
      reqData.providerCode = selectedProviderCode;
    }

    if (selectedTool.id === 'outline') {
      reqData.topic = input;
      delete reqData.content;
    }

    if (selectedTool.id === 'translate') {
      reqData.targetLanguage = 'en'; // Default to English
    }

    // Use streaming endpoint
    const streamUrl = `${AI_SERVICE_URL}/${selectedTool.id}/stream`;
    
    try {
      await stream(streamUrl, reqData);
    } catch {
      toast.error('流式请求失败');
    }
  };

  const handleSavePrompt = async (newPrompt: string | null) => {
    try {
      const res = await api.put<{ code: number; message?: string }>(`/v1/admin/ai/prompts/${selectedTool.id}`, {
        prompt_template: newPrompt
      });
      if (res.code === 200) {
        toast.success('Prompt 配置已更新');
        onConfigUpdated();
      } else {
        toast.error(res.message || '保存失败');
      }
    } catch {
      toast.error('保存失败');
    }
  };

  const hasContent = streamContent.length > 0 || thinkContent.length > 0;
  const previewTheme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const isRunDisabled = !input.trim() || isGlobalLoading;
  const previewStyles = `${markdownPreviewStyles}
.markdown-preview a { text-decoration: none; }
.markdown-preview a:hover { text-decoration: none; }
`;

  return (
    <div className="h-full grid grid-cols-1 xl:grid-cols-2 gap-6 animate-in fade-in duration-500">
      {/* Inject Markdown Styles */}
      <style dangerouslySetInnerHTML={{ __html: previewStyles }} />

      {/* Input Column (Middle) */}
      <div className="flex flex-col h-full bg-[var(--bg-card)] rounded-3xl border border-[var(--border-subtle)] shadow-sm min-w-0 relative">
        {/* Top shine effect */}
        <div className="absolute inset-0 rounded-[inherit] pointer-events-none z-30 overflow-hidden">
          <div 
            className={cn(
              "absolute inset-0 rounded-[inherit] border-t border-l border-r border-white/40",
              "dark:border-white/10"
            )} 
            style={{
              maskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 60%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 60%)',
            }}
          />
        </div>

        <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-card)] rounded-t-3xl z-20 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">测试内容</h2>
              <p className="text-xs text-[var(--text-muted)]">输入原始文本以验证效果</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <ModelSelector
                value={selectedModelId}
                onChange={(modelId, provider) => {
                  setSelectedModelId(modelId);
                  setSelectedProviderCode(provider);
                }}
                className="w-[180px]"
                selectedProviderCode={selectedProviderCode}
             />
             
             {isStreaming ? (
                <button
                  onClick={abort}
                  type="button"
                  className="w-11 h-11 p-0 rounded-2xl border border-red-500/30 bg-[var(--bg-card)] text-red-500 hover:bg-red-500/10 transition-all active:scale-95 inline-flex items-center justify-center"
                  aria-label="停止生成"
                >
                  <Square className="w-4 h-4" />
                </button>
             ) : (
                <button
                  onClick={handleRunTest}
                  type="button"
                  disabled={isRunDisabled}
                  className={cn(
                    "group w-11 h-11 p-0 rounded-2xl border border-transparent bg-transparent transition-all active:scale-95 inline-flex items-center justify-center",
                    "hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-hover)]",
                    isRunDisabled && "opacity-60 cursor-not-allowed hover:bg-transparent hover:border-transparent"
                  )}
                  aria-label="生成测试"
                >
                  <ArrowUpRight
                    className={cn(
                      "w-6 h-6 transition-transform text-black dark:text-white",
                      isRunDisabled ? "text-[var(--text-muted)]" : "group-hover:scale-[1.05]"
                    )}
                  />
                </button>
             )}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 rounded-b-3xl overflow-hidden">
          {/* Input Section (1/2) */}
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={selectedTool.id === 'outline' ? "输入文章主题 (例如: 如何写一个优秀的代码)" : "粘贴文章内容到这里进行测试..."}
              className="w-full h-full p-6 bg-transparent border-none focus:ring-0 focus:outline-none text-[var(--text-primary)] resize-none leading-relaxed text-sm font-light ring-offset-bg overflow-y-auto scrollbar-thin scrollbar-thumb-[var(--border-subtle)] scrollbar-track-transparent"
            />
            {input.length === 0 && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-10">
                <FileText className="w-16 h-16 text-[var(--text-muted)]" />
              </div>
            )}
          </div>

          {/* Prompt Section (1/2) */}
          {promptConfig && !isGlobalLoading && (
            <>
              <div className="w-full border-t border-dashed border-[var(--border-default)] opacity-50 my-0" />
              <div className="flex-1 bg-[var(--bg-secondary)] relative">
                <PromptEditor
                  taskType={selectedTool.id}
                  defaultPrompt={promptConfig.default_prompt}
                  customPrompt={promptConfig.custom_prompt || ''}
                  onSave={handleSavePrompt}
                  isLoading={isStreaming}
                />
              </div>
            </>
          )}
          <div className="h-2 flex-none bg-[var(--bg-secondary)]" />
        </div>
      </div>

      {/* Result Column (Right) */}
      <div className="flex flex-col h-full overflow-hidden bg-[var(--bg-card)] rounded-3xl border border-[var(--border-subtle)] shadow-sm relative group">
        {/* Top shine effect */}
        <div className="absolute inset-0 rounded-[inherit] pointer-events-none z-30 overflow-hidden">
          <div 
            className={cn(
              "absolute inset-0 rounded-[inherit] border-t border-l border-r border-white/40",
              "dark:border-white/10"
            )} 
            style={{
              maskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 60%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 60%)',
            }}
          />
        </div>

        <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-colors duration-700 -z-10 pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl group-hover:bg-emerald-500/10 transition-colors duration-700 -z-10 pointer-events-none" />

        <div className="p-6 pb-4 border-b border-[var(--border-subtle)] flex items-center justify-between flex-shrink-0 z-10 bg-[var(--bg-card)]/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold bg-gradient-to-r from-[var(--text-primary)] to-[var(--text-muted)] bg-clip-text text-transparent">生成结果</h2>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
             <div className={cn(
               "px-2 py-1 rounded-md text-[10px] font-mono border transition-all",
               isDone ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : 
               isStreaming ? "bg-blue-500/10 text-blue-500 border-blue-500/20 animate-pulse" : 
               "bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]"
             )}>
               {isDone ? '已完成' : isStreaming ? '正在生成' : '预览'}
             </div>
             
             <button
               onClick={() => setViewMode(prev => prev === 'preview' ? 'code' : 'preview')}
               className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-primary transition-all active:scale-95"
               title={viewMode === 'preview' ? "查看源码" : "查看预览"}
             >
               {viewMode === 'preview' ? (
                 <Code className="w-4 h-4" />
               ) : (
                 <Eye className="w-4 h-4" />
               )}
             </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-[var(--border-subtle)]/30 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[var(--border-subtle)]/60 scrollbar-track-transparent z-0">
          {streamError ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
              <div className="p-4 rounded-full bg-red-500/10 border border-red-500/20 animate-in zoom-in-50 duration-300">
                <Sparkles className="w-8 h-8 text-red-500" />
              </div>
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <p className="text-red-500 font-medium">生成失败</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-[200px] break-words">{streamError}</p>
              </div>
            </div>
          ) : !hasContent && !isStreaming ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
              <div className="p-4 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                <Sparkles className="w-8 h-8 text-[var(--text-muted)]" />
              </div>
              <div>
                <p className="text-[var(--text-primary)] font-medium">等待生成中</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">点击左侧"生成测试"按钮</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 animate-in fade-in duration-300 relative">
              {/* Thinking Block */}
              {(thinkContent || isThinking) && (
                <ThinkingBlock 
                  content={thinkContent} 
                  isActive={isThinking && isStreaming}
                />
              )}
              
              {/* Stream Content */}
              <div className="relative min-h-[200px]">
                {viewMode === 'preview' ? (
                  <MarkdownPreview 
                    content={streamContent || (isStreaming && !isThinking ? '...' : '')} 
                    className="bg-transparent border-none p-0"
                    theme={previewTheme}
                    style={{ fontSize: '15px', color: 'var(--text-primary)' }}
                  />
                ) : (
                  <div className="relative rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/80 p-4">
                  <div className="absolute left-0 top-4 bottom-4 w-1 bg-gradient-to-b from-transparent via-emerald-500 to-transparent rounded-full" />
                    <div className={cn(
                      "pl-4 text-[var(--text-primary)] leading-relaxed font-mono whitespace-pre-wrap text-[13px]"
                    )}>
                      {streamContent || (isStreaming && !isThinking && (
                        <span className="text-[var(--text-muted)] italic">正在生成...</span>
                      ))}
                      {/* Typewriter Cursor */}
                      {isStreaming && !isThinking && streamContent && (
                        <span className="inline-block w-0.5 h-4 bg-emerald-500 ml-0.5 animate-pulse" />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        
        {isDone && hasContent && (
          <div className="p-3 mx-4 mb-4 border border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-secondary)] z-10 rounded-2xl backdrop-blur-sm shadow-sm animate-in slide-in-from-bottom-2 duration-500">
             <div className="flex gap-4 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
               <span className="flex items-center gap-1.5">
                 <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" /> 
                 {streamContent.length} 字符
               </span>
               <span className="hidden sm:inline opacity-60">类型: {selectedTool.label}工具</span>
             </div>
             <button 
               className="px-4 py-1.5 rounded-xl text-[11px] font-bold bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] transition-all shadow-sm active:scale-95"
               onClick={() => {
                 navigator.clipboard.writeText(streamContent);
                 toast.success('已复制到剪贴板');
               }}
             >
               复制结果
             </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIToolsWorkspace;
