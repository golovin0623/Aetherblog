import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  isMobileSidebarOpen?: boolean;
}

// AI 服务直连地址 (通过 Nginx 代理)
const AI_SERVICE_URL = '/api/v1/ai';

export const AIToolsWorkspace: React.FC<AIToolsWorkspaceProps> = ({ 
  selectedTool, 
  allConfigs, 
  onConfigUpdated,
  isGlobalLoading,
  isMobileSidebarOpen = false
}) => {
  const [input, setInput] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedProviderCode, setSelectedProviderCode] = useState<string>('');
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [showConfig, setShowConfig] = useState(false);
  const { resolvedTheme } = useTheme();

  // 流式状态
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

  // 从预加载列表中获取当前工具的 Prompt 配置
  const promptConfig = allConfigs.find(c => c.task_type === selectedTool.id) || null;

  // 工具切换时清除结果
  useEffect(() => {
    resetStream();
  }, [selectedTool.id, resetStream]);

  // 检测操作系统
  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  }, []);

  const handleRunTest = useCallback(async () => {
    if (!input.trim()) {
      toast.error('请输入测试内容');
      return;
    }

    if (!selectedModelId) {
      toast.error('请先选择一个模型');
      return;
    }

    // 根据工具准备请求数据
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
      reqData.targetLanguage = 'en'; // 默认为英语
    }

    // 使用流式端点
    const streamUrl = `${AI_SERVICE_URL}/${selectedTool.id}/stream`;
    
    try {
      await stream(streamUrl, reqData);
    } catch {
      toast.error('流式请求失败');
    }
  }, [input, selectedModelId, selectedProviderCode, selectedTool.id, promptConfig?.custom_prompt, stream]);

  // 是否禁用运行按钮
  const isRunDisabled = !input.trim() || isGlobalLoading;

  // 键盘快捷键处理 (Cmd/Ctrl + Enter)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isRunDisabled) {
        handleRunTest();
      }
    }
  }, [isRunDisabled, handleRunTest]);

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
  const previewStyles = `${markdownPreviewStyles}
.markdown-preview a { text-decoration: none; }
.markdown-preview a:hover { text-decoration: none; }
`;

  return (
    <div className="h-full flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-6 animate-in fade-in duration-500 overflow-y-auto md:overflow-hidden">
      {/* Inject Markdown Styles */}
      <style dangerouslySetInnerHTML={{ __html: previewStyles }} />

      {/* Input Column (Middle) */}
      <div className="flex flex-col min-h-[50vh] md:min-h-0 md:h-full bg-[var(--bg-card)] rounded-2xl md:rounded-3xl border border-[var(--border-subtle)] shadow-sm min-w-0 relative">
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

        {/* Header - Desktop */}
        <div className="hidden md:flex p-4 border-b border-[var(--border-subtle)] items-center justify-between bg-[var(--bg-card)] rounded-t-3xl z-10 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">测试内容</h2>
              <p className="text-xs text-[var(--text-muted)]">输入原始文本以验证效果</p>
            </div>
          </div>
        </div>

        {/* Header - Mobile: Title only */}
        <div className="md:hidden p-3 border-b border-[var(--border-subtle)] flex items-center gap-2 bg-[var(--bg-card)] rounded-t-2xl z-20 flex-shrink-0">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <FileText className="w-4 h-4 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">测试内容</h2>
        </div>

        <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
          {/* Main Content Areas: Stacked or Togglable */}
          <div className="flex-1 relative flex flex-col min-h-0">
            {/* Input Section */}
            <div className={cn(
              "flex-1 relative transition-all duration-500 ease-in-out origin-top",
              // PC: use opacity/scale animation, Mobile: use hidden/block
              showConfig 
                ? "md:h-0 md:opacity-0 md:scale-95 md:pointer-events-none hidden md:block" 
                : "h-full opacity-100 scale-100"
            )}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selectedTool.id === 'outline' ? "输入文章主题 (例如: 如何写一个优秀的代码)" : "粘贴文章内容到这里进行测试..."}
                className="w-full h-full min-h-[200px] p-4 md:p-8 bg-transparent border-none focus:ring-0 focus:outline-none text-[var(--text-primary)] resize-none leading-relaxed text-base font-light no-scrollbar placeholder:text-[var(--text-muted)] placeholder:opacity-70"
              />
              {input.length === 0 && (
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center opacity-[0.06] dark:opacity-[0.08]">
                  <FileText className="w-20 h-20 md:w-24 md:h-24 mb-3" />
                  <p className="text-lg md:text-xl font-medium tracking-widest uppercase">点击输入内容</p>
                </div>
              )}
            </div>

            {/* Prompt Section - PC: translate animation, Mobile: conditional render */}
            {promptConfig && !isGlobalLoading && (
              <>
                {/* Desktop version - uses translate animation */}
                <div className={cn(
                  "hidden md:flex absolute inset-0 z-10 bg-[var(--bg-secondary)] flex-col overflow-hidden transition-all duration-500 ease-in-out",
                  showConfig ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none"
                )}>
                  <PromptEditor
                    taskType={selectedTool.id}
                    defaultPrompt={promptConfig.default_prompt}
                    customPrompt={promptConfig.custom_prompt || ''}
                    onSave={handleSavePrompt}
                    isLoading={isStreaming}
                    onClose={() => setShowConfig(false)}
                  />
                </div>
                {/* Mobile version - conditional render for proper display */}
                {showConfig && (
                  <div className="md:hidden absolute inset-0 z-10 bg-[var(--bg-secondary)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <PromptEditor
                      taskType={selectedTool.id}
                      defaultPrompt={promptConfig.default_prompt}
                      customPrompt={promptConfig.custom_prompt || ''}
                      onSave={handleSavePrompt}
                      isLoading={isStreaming}
                      onClose={() => setShowConfig(false)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
          {/* Unified Execution Hub - Floating at bottom center */}
          <div className={cn(
            "absolute bottom-4 md:bottom-8 left-1/2 -translate-x-1/2 z-40 transition-all duration-500",
            isMobileSidebarOpen ? "translate-y-40 opacity-0 pointer-events-none" : "translate-y-0 opacity-100",
            showConfig && "hidden md:flex"  // Hide on mobile when config is open, show on PC
          )}>
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Toggle Config Button */}
              <button
                onClick={() => setShowConfig(!showConfig)}
                className={cn(
                  "w-11 h-11 sm:w-12 sm:h-12 rounded-full transition-all duration-300 flex items-center justify-center",
                  "bg-[var(--bg-secondary)] text-[var(--text-muted)] shadow-md",
                  "hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] hover:shadow-lg",
                  showConfig && "bg-black text-white dark:bg-white dark:text-black shadow-lg"
                )}
                title={showConfig ? "返回输入" : "专家配置"}
              >
                <Code className="w-5 h-5" />
              </button>

              <ModelSelector
                value={selectedModelId}
                onChange={(modelId, provider) => {
                  setSelectedModelId(modelId);
                  setSelectedProviderCode(provider);
                }}
                className="w-[140px] sm:w-[200px]"
                triggerClassName="h-11 sm:h-12 rounded-full bg-[var(--bg-secondary)] shadow-md hover:bg-[var(--bg-card-hover)] hover:shadow-lg border-none"
                selectedProviderCode={selectedProviderCode}
                menuPlacement="top"
              />

              {isStreaming ? (
                <button
                  onClick={abort}
                  className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[var(--bg-secondary)] text-red-500 shadow-md hover:bg-red-500/10 hover:shadow-lg transition-all flex items-center justify-center animate-pulse"
                  title="停止生成"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  onClick={handleRunTest}
                  disabled={isRunDisabled}
                  className={cn(
                    "w-11 h-11 sm:w-12 sm:h-12 rounded-full transition-all duration-300 flex items-center justify-center active:scale-95",
                    "bg-[var(--bg-secondary)] text-[var(--text-muted)] shadow-md",
                    "hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] hover:shadow-lg",
                    isRunDisabled && "opacity-30 cursor-not-allowed"
                  )}
                  title={`执行 (${isMac ? '⌘' : 'Ctrl'} + Enter)`}
                >
                  <ArrowUpRight className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Result Column (Right) */}
      <div className="flex flex-col min-h-[45vh] md:min-h-0 md:h-full overflow-hidden bg-[var(--bg-card)] rounded-2xl md:rounded-3xl border border-[var(--border-subtle)] shadow-sm relative group">
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

        <div className="p-4 md:p-6 md:pb-4 border-b border-[var(--border-subtle)] flex items-center justify-between flex-shrink-0 z-10 bg-[var(--bg-card)]/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="p-1.5 md:p-2 rounded-lg bg-black text-white dark:bg-white dark:text-black transition-colors">
              <CheckCircle2 className="w-4 h-4 md:w-5 md:h-5" />
            </div>
            <div>
              <h2 className="text-sm md:text-lg font-bold tracking-tight bg-gradient-to-r from-[var(--text-primary)] via-[var(--text-primary)] to-[var(--text-muted)] bg-clip-text text-transparent">生成结果</h2>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-[var(--text-muted)] uppercase font-medium tracking-tighter">AI Generator v2</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
             <div className={cn(
               "px-2 py-1 rounded-md text-[10px] font-mono border transition-all",
               isDone ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
               isStreaming ? "bg-blue-500/10 text-blue-500 border-blue-500/20 animate-pulse" :
               "bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]"
             )}>
               {isDone ? '已完成' : isStreaming ? '生成中' : '预览'}
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

        <div className="flex-1 overflow-y-auto p-4 md:p-6 no-scrollbar z-0">
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
              {/* 思考块 */}
              {(thinkContent || isThinking) && (
                <ThinkingBlock 
                  content={thinkContent} 
                  isActive={isThinking && isStreaming}
                />
              )}
              
              {/* 流式内容 */}
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
                      {/* 打字机光标 */}
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
