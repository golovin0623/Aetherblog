import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowUpRight, Code, FileText, CheckCircle2, Square, Sliders, ChevronDown, ChevronRight, Download, Check, Search, Loader2, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PromptEditor } from './PromptEditor';
import { ToolParamsPanel, useToolParams } from './ToolParamsPanel';
import { ToolResultRenderer } from './results/ToolResultRenderer';
import { apiClient as api } from '@/services/api';
import { toast } from 'sonner';
import ModelSelector from '@/components/ai/ModelSelector';
import { useStreamResponse } from '@/hooks/useStreamResponse';
import type { AiToolTargetApi } from '@/hooks/useAiToolTarget';
import { useTheme, useDebounce } from '@/hooks';
import { ThinkingBlock } from './ThinkingBlock';
import { markdownPreviewStyles } from '@aetherblog/editor';
import { postService, type PostListItem } from '@/services/postService';

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
  target: AiToolTargetApi;
}

// AI 服务直连地址 (通过 Nginx 代理)
const AI_SERVICE_URL = '/api/v1/ai';

export const AIToolsWorkspace: React.FC<AIToolsWorkspaceProps> = ({
  selectedTool,
  allConfigs,
  onConfigUpdated,
  isGlobalLoading,
  isMobileSidebarOpen = false,
  target,
}) => {
  const [input, setInput] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedProviderCode, setSelectedProviderCode] = useState<string>('');
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [showConfig, setShowConfig] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const TARGET_PAGE_SIZE = 20;
  const [showTargetDropdown, setShowTargetDropdown] = useState(false);
  const [targetSearch, setTargetSearch] = useState('');
  const [targetPageNum, setTargetPageNum] = useState(1);
  const [targetList, setTargetList] = useState<PostListItem[]>([]);
  const [targetTotal, setTargetTotal] = useState(0);
  const [targetLoading, setTargetLoading] = useState(false);
  const debouncedTargetSearch = useDebounce(targetSearch, 300);
  const targetDropdownRef = useRef<HTMLDivElement>(null);
  const targetSearchInputRef = useRef<HTMLInputElement>(null);

  // 点击外部关闭目标文章下拉
  useEffect(() => {
    if (!showTargetDropdown) return;
    const onMouseDown = (e: MouseEvent) => {
      if (targetDropdownRef.current && !targetDropdownRef.current.contains(e.target as Node)) {
        setShowTargetDropdown(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showTargetDropdown]);

  // 打开 dropdown 时自动聚焦搜索框；关闭时重置搜索 + 分页
  useEffect(() => {
    if (showTargetDropdown) {
      setTimeout(() => targetSearchInputRef.current?.focus(), 50);
    } else {
      setTargetSearch('');
      setTargetPageNum(1);
      setTargetList([]);
      setTargetTotal(0);
    }
  }, [showTargetDropdown]);

  // 关键词变化时自动翻回第一页 —— 否则改了搜索词但 pageNum 还停在第 N 页会
  // 出现"搜出来 5 条但显示在第 3 页"的怪状态
  useEffect(() => {
    setTargetPageNum(1);
  }, [debouncedTargetSearch]);

  // 拉取当前页（受 keyword + pageNum 联动）；dropdown 关闭时不调
  useEffect(() => {
    if (!showTargetDropdown) return;
    const keyword = debouncedTargetSearch.trim();
    let active = true;
    setTargetLoading(true);
    postService
      .getList({
        pageNum: targetPageNum,
        pageSize: TARGET_PAGE_SIZE,
        keyword: keyword || undefined,
      })
      .then((res) => {
        if (!active) return;
        if (res.code === 200 && res.data) {
          setTargetList(res.data.list || []);
          setTargetTotal(res.data.total || 0);
        } else {
          setTargetList([]);
          setTargetTotal(0);
        }
      })
      .catch(() => {
        if (!active) return;
        setTargetList([]);
        setTargetTotal(0);
      })
      .finally(() => {
        if (active) setTargetLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debouncedTargetSearch, targetPageNum, showTargetDropdown]);

  // 当前页 + targetPost 兜底（深链 ?postId=X 命中的文章可能不在当前 keyword/page 里）
  const targetPostOptions = useMemo<PostListItem[]>(() => {
    const list: PostListItem[] = [...targetList];
    if (
      target.targetPost &&
      targetPageNum === 1 &&
      !debouncedTargetSearch.trim() &&
      !list.some((p) => p.id === target.targetPost?.id)
    ) {
      list.push({
        id: target.targetPost.id,
        title: target.targetPost.title || `#${target.targetPost.id}`,
      } as PostListItem);
    }
    return list;
  }, [targetList, targetPageNum, debouncedTargetSearch, target.targetPost]);

  const targetTotalPages = Math.max(1, Math.ceil(targetTotal / TARGET_PAGE_SIZE));
  const currentTargetTitle = target.targetPost?.title || (target.targetPostId ? `#${target.targetPostId}` : '');
  const { resolvedTheme } = useTheme();

  // 各工具独立参数（持久化到 localStorage）
  const [toolParams, setToolParams] = useToolParams(selectedTool.id);

  // 流式状态
  const {
    content: streamContent,
    thinkContent,
    isThinking,
    isLoading: isStreaming,
    isDone,
    error: streamError,
    result: streamResult,
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

    // 根据工具准备请求数据 — 使用可配置参数（ToolParamsPanel）而非硬编码。
    // providerCode 只在真正非空时才发送：后端 ProviderRegistry 会把空字符串
    // 当作"code = ''"的精确过滤，从而让模型路由查不到任何候选。PR #435 C12。
    const trimmedProviderCode = selectedProviderCode.trim();
    const reqData: Record<string, unknown> = {
      content: input,
      promptTemplate: promptConfig?.custom_prompt || undefined,
      modelId: selectedModelId,
      ...(trimmedProviderCode ? { providerCode: trimmedProviderCode } : {}),
    };

    switch (selectedTool.id) {
      case 'summary':
        reqData.maxLength = Number(toolParams.maxLength ?? 200);
        break;
      case 'tags':
        reqData.maxTags = Number(toolParams.maxTags ?? 5);
        break;
      case 'titles':
        reqData.maxTitles = Number(toolParams.maxTitles ?? 5);
        break;
      case 'polish':
        reqData.tone = String(toolParams.tone ?? '专业');
        break;
      case 'outline':
        reqData.topic = input;
        reqData.depth = Number(toolParams.depth ?? 2);
        reqData.style = String(toolParams.style ?? 'professional');
        delete reqData.content;
        break;
      case 'translate': {
        reqData.targetLanguage = String(toolParams.targetLanguage ?? 'en');
        const source = String(toolParams.sourceLanguage ?? '').trim();
        if (source) reqData.sourceLanguage = source;
        break;
      }
      default:
        break;
    }

    // 使用流式端点
    const streamUrl = `${AI_SERVICE_URL}/${selectedTool.id}/stream`;

    try {
      await stream(streamUrl, reqData);
    } catch {
      toast.error('流式请求失败');
    }
  }, [input, selectedModelId, selectedProviderCode, selectedTool.id, promptConfig?.custom_prompt, stream, toolParams]);

  // 从目标文章导入正文到输入框
  const handleImportFromTarget = useCallback(() => {
    if (!target.targetPost) {
      toast.error('请先在右上角选择目标文章');
      return;
    }
    const content = target.targetPost.content || '';
    if (!content.trim()) {
      toast.error('目标文章没有正文可导入');
      return;
    }
    setInput(content);
    toast.success(`已导入《${target.targetPost.title || '无标题'}》的正文`);
  }, [target.targetPost]);

  // 是否禁用运行按钮
  const isRunDisabled = !input.trim() || isGlobalLoading;

  // 键盘快捷键处理 (Cmd/Ctrl + Enter)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isRunDisabled) {
        handleRunTest();
      }
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
  const previewStyles = `${markdownPreviewStyles}
.markdown-preview a { text-decoration: none; }
.markdown-preview a:hover { text-decoration: none; }
`;

  return (
    <div className="h-full flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-6 animate-in fade-in duration-500 overflow-y-auto md:overflow-hidden">
      {/* 注入 Markdown 样式 */}
      <style dangerouslySetInnerHTML={{ __html: previewStyles }} />

      {/* 输入列（中间） */}
      <div className="flex flex-col min-h-[50vh] md:min-h-0 md:h-full bg-[var(--bg-card)] rounded-2xl md:rounded-3xl border border-[var(--border-subtle)] shadow-sm min-w-0 relative">
        {/* 顶部光泽效果 */}
        <div className="absolute inset-0 rounded-[inherit] pointer-events-none z-30 overflow-hidden">
          <div
            className={cn(
              "absolute inset-0 rounded-[inherit] border-t border-l border-r border-[var(--border-subtle)]"
            )}
            style={{
              maskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 60%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 60%)',
            }}
          />
        </div>

        {/* 头部 - 桌面端 */}
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
          <div className="flex items-center gap-2">
            {/* 从目标文章导入正文 */}
            <button
              onClick={handleImportFromTarget}
              disabled={!target.targetPost}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border',
                target.targetPost
                  ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)] opacity-50 cursor-not-allowed',
              )}
              title={target.targetPost ? `导入《${target.targetPost.title || '无标题'}》正文` : '请先选择目标文章'}
            >
              <Download className="w-3.5 h-3.5" />
              导入正文
            </button>
            {/* 工具参数入口 */}
            <button
              onClick={() => setShowParams((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border',
                showParams
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]',
              )}
              title="工具参数"
              aria-expanded={showParams}
            >
              <Sliders className="w-3.5 h-3.5" />
              参数
              {showParams ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* 头部 - 移动端：仅显示标题 */}
        <div className="md:hidden p-3 border-b border-[var(--border-subtle)] flex items-center gap-2 bg-[var(--bg-card)] rounded-t-2xl z-20 flex-shrink-0">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <FileText className="w-4 h-4 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex-1">测试内容</h2>
          <button
            onClick={handleImportFromTarget}
            disabled={!target.targetPost}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border',
              target.targetPost
                ? 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)] opacity-50',
            )}
            aria-label="从目标文章导入"
          >
            <Download className="w-3 h-3" />
            导入
          </button>
          <button
            onClick={() => setShowParams((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border',
              showParams
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]',
            )}
            aria-label="工具参数"
          >
            <Sliders className="w-3 h-3" />
            参数
          </button>
        </div>

        {/* 可折叠参数面板 */}
        {showParams && (
          <div className="px-4 md:px-5 py-3 md:py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30 animate-in fade-in slide-in-from-top-2 duration-200 z-10 flex-shrink-0">
            <ToolParamsPanel
              toolId={selectedTool.id}
              value={toolParams}
              onChange={setToolParams}
            />
          </div>
        )}

        <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
          {/* 主内容区：堆叠或可切换 */}
          <div className="flex-1 relative flex flex-col min-h-0">
            {/* 输入区 */}
            <div className={cn(
              "flex-1 relative transition-all duration-500 ease-in-out origin-top",
              // PC 端：使用透明度/缩放动画，移动端：使用 hidden/block
              showConfig 
                ? "md:h-0 md:opacity-0 md:scale-95 md:pointer-events-none hidden md:block" 
                : "h-full opacity-100 scale-100"
            )}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selectedTool.id === 'outline' ? "输入文章主题 (例如: 如何写一个优秀的代码)" : "粘贴文章内容到这里进行测试..."}
                aria-label="输入测试内容"
                className="w-full h-full min-h-[200px] p-4 pb-24 md:p-8 md:pb-24 bg-transparent border-none focus:ring-0 focus:outline-none text-[var(--text-primary)] resize-none leading-relaxed text-base font-light no-scrollbar placeholder:text-[var(--text-muted)] placeholder:opacity-70"
              />
              {input.length === 0 && (
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center opacity-[0.06] dark:opacity-[0.08]">
                  <FileText className="w-20 h-20 md:w-24 md:h-24 mb-3" />
                  <p className="text-lg md:text-xl font-medium tracking-widest uppercase">点击输入内容</p>
                </div>
              )}
            </div>

            {/* Prompt 区 - PC 端：使用位移动画，移动端：条件渲染 */}
            {promptConfig && !isGlobalLoading && (
              <>
                {/* 桌面端版本 - 使用位移动画 */}
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
                {/* 移动端版本 - 条件渲染以保证正常显示 */}
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
          {/* 统一执行入口 - 悬浮于底部居中 */}
          <div className={cn(
            "absolute bottom-4 md:bottom-8 left-1/2 -translate-x-1/2 z-40 transition-all duration-500",
            isMobileSidebarOpen ? "translate-y-40 opacity-0 pointer-events-none" : "translate-y-0 opacity-100",
            showConfig && "hidden md:flex"  // 移动端配置打开时隐藏，PC 端显示
          )}>
            <div className="flex items-center gap-2 sm:gap-3">
              {/* 切换配置按钮 */}
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
                modelType="chat"
              />

              {isStreaming ? (
                <button
                  onClick={abort}
                  className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[var(--bg-secondary)] text-status-danger shadow-md hover:bg-status-danger-light hover:shadow-lg transition-all flex items-center justify-center animate-pulse"
                  title="停止生成"
                  aria-label="停止生成"
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
                  aria-label={`执行 (${isMac ? 'Command' : 'Ctrl'} + Enter)`}
                >
                  <ArrowUpRight className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 结果列（右侧） */}
      <div className="flex flex-col min-h-[45vh] md:min-h-0 md:h-full overflow-hidden bg-[var(--bg-card)] rounded-2xl md:rounded-3xl border border-[var(--border-subtle)] shadow-sm relative group">
        {/* 顶部光泽效果 */}
        <div className="absolute inset-0 rounded-[inherit] pointer-events-none z-30 overflow-hidden">
          <div
            className={cn(
              "absolute inset-0 rounded-[inherit] border-t border-l border-r border-[var(--border-subtle)]"
            )}
            style={{
              maskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 60%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 60%)',
            }}
          />
        </div>

        <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-colors duration-700 -z-10 pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-status-success/5 rounded-full blur-3xl group-hover:bg-status-success-light transition-colors duration-700 -z-10 pointer-events-none" />

        <div className="p-4 md:p-6 md:pb-4 border-b border-[var(--border-subtle)] flex flex-col md:flex-row md:items-center md:justify-between flex-shrink-0 z-10 bg-[var(--bg-card)]/80 backdrop-blur-sm gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 md:p-2 rounded-lg bg-black text-white dark:bg-white dark:text-black transition-colors flex-shrink-0">
              <CheckCircle2 className="w-4 h-4 md:w-5 md:h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm md:text-lg font-bold tracking-tight bg-gradient-to-r from-[var(--text-primary)] via-[var(--text-primary)] to-[var(--text-muted)] bg-clip-text text-transparent truncate">生成结果</h2>
              <div className="flex items-center gap-1 mt-0.5 min-w-0">
                <span className="w-1 h-1 rounded-full bg-status-success animate-pulse flex-shrink-0" />
                <span className="text-[10px] text-[var(--text-muted)] uppercase font-medium tracking-tighter truncate">
                  {target.targetPost
                    ? `目标：${target.targetPost.title || `#${target.targetPost.id}`}`
                    : '未选择目标文章'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3 md:flex-shrink-0 min-w-0 w-full md:w-auto">
             {/* 目标文章选择器 —— 自定义 dropdown 替代原生 <select>，避免浏览器原生菜单样式割裂 */}
             <div ref={targetDropdownRef} className="relative flex-1 md:flex-none min-w-0">
               <button
                 type="button"
                 onClick={() => setShowTargetDropdown((v) => !v)}
                 title="选择应用目标文章"
                 className={cn(
                   'w-full md:w-[220px] md:max-w-[220px] text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-primary/30',
                   'flex items-center justify-between gap-2 hover:bg-[var(--bg-card-hover)] transition-colors',
                   showTargetDropdown && 'ring-2 ring-primary/30 border-primary',
                 )}
               >
                 <span className={cn('truncate', !target.targetPostId && 'text-[var(--text-muted)]')}>
                   {target.targetPostId ? currentTargetTitle : '— 无目标文章 —'}
                 </span>
                 <ChevronDown
                   className={cn(
                     'w-3.5 h-3.5 text-[var(--text-muted)] transition-transform shrink-0',
                     showTargetDropdown && 'rotate-180 text-primary',
                   )}
                 />
               </button>
               <AnimatePresence>
                 {showTargetDropdown && (
                   <motion.div
                     initial={{ opacity: 0, y: -8, scale: 0.96 }}
                     animate={{ opacity: 1, y: 0, scale: 1 }}
                     exit={{ opacity: 0, y: -8, scale: 0.96 }}
                     transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                     className="absolute left-0 right-0 md:left-auto md:right-0 md:w-[320px] top-full mt-2 z-30 rounded-xl border border-[var(--border-default)] bg-[var(--bg-popover)] shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden"
                   >
                     {/* 搜索框 */}
                     <div className="relative p-2 border-b border-[var(--border-subtle)] shrink-0">
                       <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
                       <input
                         ref={targetSearchInputRef}
                         type="text"
                         value={targetSearch}
                         onChange={(e) => setTargetSearch(e.target.value)}
                         placeholder="搜索文章标题…"
                         className="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                       />
                       {targetSearch && (
                         <button
                           type="button"
                           onClick={() => setTargetSearch('')}
                           className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                           aria-label="清空搜索"
                         >
                           <XIcon className="w-3 h-3" />
                         </button>
                       )}
                     </div>

                     {/* 选项列表 */}
                     <div className="max-h-56 md:max-h-72 overflow-auto py-1">
                       {/* 清除选项 */}
                       <button
                         type="button"
                         onClick={() => {
                           target.setTargetPostId(null);
                           setShowTargetDropdown(false);
                         }}
                         className={cn(
                           'w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-3 transition-colors',
                           !target.targetPostId
                             ? 'bg-primary/10 text-primary font-medium'
                             : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]',
                         )}
                       >
                         <span>— 无目标文章 —</span>
                         {!target.targetPostId && <Check className="w-3.5 h-3.5 shrink-0" />}
                       </button>

                       {/* 列表分组头：搜索时显示「搜索结果」+ 总数；否则「全部文章」+ 总数 */}
                       {targetTotal > 0 && (
                         <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium flex items-center justify-between">
                           <span>{debouncedTargetSearch.trim() ? '搜索结果' : '全部文章'}</span>
                           <span className="font-mono normal-case tracking-normal">{targetTotal}</span>
                         </div>
                       )}

                       {targetLoading && (
                         <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-[var(--text-muted)]">
                           <Loader2 className="w-3.5 h-3.5 animate-spin" />
                           {debouncedTargetSearch.trim() ? '搜索中…' : '加载中…'}
                         </div>
                       )}
                       {!targetLoading && targetPostOptions.length === 0 && (
                         <div className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">
                           {debouncedTargetSearch.trim() ? '未找到匹配文章' : '暂无文章'}
                         </div>
                       )}

                       {!targetLoading &&
                         targetPostOptions.map((p) => {
                           const isSelected = p.id === target.targetPostId;
                           return (
                             <button
                               key={p.id}
                               type="button"
                               onClick={() => {
                                 target.setTargetPostId(p.id);
                                 setShowTargetDropdown(false);
                               }}
                               className={cn(
                                 'w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-3 transition-colors',
                                 isSelected
                                   ? 'bg-primary/10 text-primary font-medium'
                                   : 'text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
                               )}
                             >
                               <span className="truncate">{p.title || `#${p.id}`}</span>
                               {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                             </button>
                           );
                         })}
                     </div>

                     {/* 分页栏 —— 多于一页时显示 */}
                     {targetTotalPages > 1 && (
                       <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border-subtle)] shrink-0 bg-[var(--bg-secondary)]/40">
                         <button
                           type="button"
                           onClick={() => setTargetPageNum((n) => Math.max(1, n - 1))}
                           disabled={targetPageNum === 1 || targetLoading}
                           className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
                         >
                           上一页
                         </button>
                         <span className="text-[10px] text-[var(--text-muted)] font-mono tnum">
                           {targetPageNum} / {targetTotalPages}
                         </span>
                         <button
                           type="button"
                           onClick={() => setTargetPageNum((n) => Math.min(targetTotalPages, n + 1))}
                           disabled={targetPageNum >= targetTotalPages || targetLoading}
                           className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
                         >
                           下一页
                         </button>
                       </div>
                     )}
                   </motion.div>
                 )}
               </AnimatePresence>
             </div>

             <div className={cn(
               "px-2 py-1 rounded-md text-[10px] font-mono border transition-all flex-shrink-0",
               isDone ? "bg-status-success-light text-status-success border-status-success-border" :
               isStreaming ? "bg-status-info-light text-status-info border-status-info-border animate-pulse" :
               "bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]"
             )}>
               {isDone ? '已完成' : isStreaming ? '生成中' : '预览'}
             </div>

             <button
               onClick={() => setViewMode(prev => prev === 'preview' ? 'code' : 'preview')}
               className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-primary transition-all active:scale-95 flex-shrink-0"
               title={viewMode === 'preview' ? "查看源码" : "查看结构化视图"}
             >
               <Code className="w-4 h-4" />
             </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 no-scrollbar z-0">
          {streamError ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
              <div className="p-4 rounded-full bg-status-danger-light border border-status-danger-border animate-in zoom-in-50 duration-300">
                <Sparkles className="w-8 h-8 text-status-danger" />
              </div>
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <p className="text-status-danger font-medium">生成失败</p>
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

              {/* 流式/结构化内容 */}
              <div className="relative min-h-[200px]">
                {viewMode === 'preview' ? (
                  isStreaming && !streamResult ? (
                    // 正在流式:ai-stream 背景渲染 + ink-cursor 极光光标
                    <div className="ai-stream text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed text-[15px]">
                      {streamContent || (
                        <span className="text-[var(--text-muted)] italic">正在生成...</span>
                      )}
                      {streamContent && (
                        <span className="ink-cursor" aria-hidden="true" />
                      )}
                    </div>
                  ) : (
                    // 流式完成或已有结构化 result：使用分发式渲染（提供"应用"按钮）
                    <ToolResultRenderer
                      toolId={selectedTool.id}
                      streamContent={streamContent}
                      result={streamResult}
                      target={target}
                      previewTheme={previewTheme}
                    />
                  )
                ) : (
                  <div className="relative rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/80 p-4">
                    <div className="absolute left-0 top-4 bottom-4 w-1 bg-gradient-to-b from-transparent via-status-success to-transparent rounded-full" />
                    <div className="pl-4 text-[var(--text-primary)] leading-relaxed font-mono whitespace-pre-wrap text-[13px]">
                      {streamContent || (isStreaming && !isThinking && (
                        <span className="text-[var(--text-muted)] italic">正在生成...</span>
                      ))}
                      {streamResult && (
                        <>
                          {'\n\n// ─── structured result ───\n'}
                          {JSON.stringify(streamResult, null, 2)}
                        </>
                      )}
                      {isStreaming && !isThinking && streamContent && (
                        <span className="ink-cursor" aria-hidden="true" />
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
                <span className="w-1.5 h-1.5 rounded-full bg-status-success shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                {streamContent.length} 字符
              </span>
              <span className="hidden sm:inline opacity-60">类型: {selectedTool.label}工具</span>
            </div>
            <span className="text-[10px] text-[var(--text-muted)] opacity-60">
              使用上方按钮将结果应用到文章
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIToolsWorkspace;
