
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  ChevronsUpDown, 
  Search, 
  Check, 
  Settings, 
  Box,
  Zap,
  Eye,
  Brain,
  Globe,
  Terminal,
  Image,
  Paperclip,
  Brackets,
  Video,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { aiProviderService, AiProvider, AiModel } from '@/services/aiProviderService';
import ProviderIcon from '@/pages/ai-config/components/ProviderIcon';

interface ModelSelectorProps {
  value?: string;
  onChange: (modelId: string, provider: string) => void;
  className?: string;
  providerCode?: string;
  modelType?: string;
  variant?: 'default' | 'compact';
  selectedProviderCode?: string;
  menuAlign?: 'left' | 'right';
  menuClassName?: string;
  triggerClassName?: string;
  showArrow?: boolean;
}

interface GroupedModels {
  provider: AiProvider;
  models: AiModel[];
}

const resolveContextWindow = (model: AiModel) => {
  if (model.context_window) return model.context_window;
  const caps = (model.capabilities || {}) as Record<string, unknown>;
  const maxToken = caps.maxToken ?? caps.contextWindowTokens ?? caps.context_window;
  const parsed = typeof maxToken === 'string' ? Number.parseInt(maxToken, 10) : maxToken;
  return Number.isFinite(parsed as number) ? (parsed as number) : null;
};

const resolveAbilities = (model: AiModel) => {
  const caps = (model.capabilities || {}) as Record<string, unknown>;
  const abilities = (caps.abilities || {}) as Record<string, unknown>;
  const getBool = (value: unknown) => Boolean(value);

  return {
    vision: getBool(abilities.vision ?? caps.vision),
    reasoning: getBool(abilities.reasoning ?? caps.reasoning),
    search: getBool(abilities.search ?? caps.web_search ?? caps.search),
    functionCall: getBool(abilities.functionCall ?? caps.function_calling ?? caps.function_call),
    imageOutput: getBool(abilities.imageOutput ?? caps.image_generation ?? caps.image_output),
    files: getBool(abilities.files ?? caps.files),
    structuredOutput: getBool(abilities.structuredOutput ?? caps.structured_output),
    video: getBool(abilities.video ?? caps.video),
  };
};

// 能力徽章组件
const AbilityBadge: React.FC<{
  icon: React.FC<{ className?: string }>;
  color: string;
  title: string;
}> = ({ icon: Icon, color, title }) => (
  <span
    className={cn(
      "inline-flex items-center justify-center w-5 h-5 rounded-md",
      color
    )}
    title={title}
  >
    <Icon className="w-3 h-3" />
  </span>
);

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  value,
  onChange,
  className,
  providerCode,
  modelType,
  variant = 'default',
  selectedProviderCode,
  menuAlign = 'left',
  menuClassName = '',
  triggerClassName = '',
  showArrow = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  // 获取提供商
  const { data: providersResponse } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => aiProviderService.listProviders(true) // only enabled
  });

  // 获取模型
  const { data: modelsResponse } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => aiProviderService.listModels(undefined, undefined)
  });

  const providers = providersResponse?.data || [];
  const allModels = modelsResponse?.data || [];

  // 按提供商分组模型
  const groupedModels = useMemo(() => {
    const groups: GroupedModels[] = [];
    const filteredModels = allModels.filter((model) => {
      if (!model.is_enabled) return false;
      if (modelType && model.model_type !== modelType) return false;
      if (providerCode && model.provider_code !== providerCode) return false;
      return true;
    });
    
    // 按优先级排序提供商
    const sortedProviders = [...providers].sort((a, b) => b.priority - a.priority);

    sortedProviders.forEach(provider => {
      // 筛选该提供商的模型
      const providerModels = filteredModels.filter(
        m => m.provider_code === provider.code
      );

      if (providerModels.length > 0) {
        groups.push({
          provider,
          models: providerModels
        });
      }
    });

    // 如果提供商列表未包含筛选出的提供商（例如已禁用），
    // 仍将模型分组在占位符下返回。
    if (groups.length === 0 && filteredModels.length > 0 && providerCode) {
      const fallbackProvider = providers.find((p) => p.code === providerCode);
      if (fallbackProvider) {
        groups.push({ provider: fallbackProvider, models: filteredModels });
      }
    }

    return groups;
  }, [providers, allModels, modelType, providerCode]);

  // 基于搜索进行筛选
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groupedModels;

    const lowerSearch = search.toLowerCase();
    
    return groupedModels.map(group => {
      // 检查提供商是否匹配
      const providerMatch = 
        group.provider.name.toLowerCase().includes(lowerSearch) ||
        (group.provider.display_name && group.provider.display_name.toLowerCase().includes(lowerSearch));

      if (providerMatch) return group;

      // 筛选模型
      const filteredModels = group.models.filter(m => 
        m.model_id.toLowerCase().includes(lowerSearch) ||
        (m.display_name && m.display_name.toLowerCase().includes(lowerSearch))
      );

      return {
        ...group,
        models: filteredModels
      };
    }).filter(group => group.models.length > 0);
  }, [groupedModels, search]);

  // 查找选中的模型对象
  const selectedModel = useMemo(() => {
    if (!value) return null;
    if (selectedProviderCode) {
      return allModels.find(
        (m) => m.model_id === value && m.provider_code === selectedProviderCode
      );
    }
    return allModels.find(m => m.model_id === value);
  }, [allModels, value, selectedProviderCode]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.model-selector-container')) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (model: AiModel, provider: AiProvider) => {
    onChange(model.model_id, provider.code);
    setIsOpen(false);
    setSearch('');
  };

  // 格式化上下文窗口大小的辅助函数
  const formatContext = (tokens?: number | null) => {
    if (!tokens) return null;
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
    return tokens;
  };

  return (
    <div className={cn("relative model-selector-container", className)}>
      {/* 触发按钮 - 仅显示提供商图标 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 border transition-all duration-200 px-3 w-full",
          variant === 'compact'
            ? "h-8 rounded-lg"
            : "h-9 rounded-full",
          "bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-secondary)]",
          "border-[var(--border-default)]",
          "hover:border-primary/40 hover:shadow-md hover:shadow-primary/5",
          isOpen && "ring-2 ring-primary/20 border-primary/50",
          !selectedModel && !isOpen && "animate-breathing-light border-primary/30",
          triggerClassName
        )}
      >
        {selectedModel ? (
          <>
            <ProviderIcon
              code={selectedModel.provider_code}
              size={variant === 'compact' ? 16 : 18}
            />
            <span className="text-xs font-medium text-[var(--text-primary)] truncate max-w-[120px]">
              {selectedModel.display_name || selectedModel.model_id}
            </span>
            <ChevronsUpDown className="w-3 h-3 text-[var(--text-muted)] opacity-50 ml-auto" />
          </>
        ) : (
          <>
            <Box className={cn(
              "text-[var(--text-muted)]",
              variant === 'compact' ? "w-4 h-4" : "w-4 h-4"
            )} />
            <span className="text-xs text-[var(--text-muted)]">选择模型</span>
            <ChevronsUpDown className="w-3 h-3 text-[var(--text-muted)] opacity-50 ml-auto" />
          </>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "absolute top-full z-50 mt-2 flex flex-col max-h-[520px] overflow-visible",
              menuAlign === 'right' ? "right-0" : "left-0",
              variant === 'compact' ? "w-[340px]" : "w-[380px]",
              menuClassName
            )}
          >
            {showArrow && (
              <div
                className={cn(
                  "absolute -top-2 h-4 w-4 rotate-45 border border-zinc-200 dark:border-zinc-700/60 bg-white dark:bg-zinc-900 z-10",
                  menuAlign === 'right' ? "right-6" : "left-6"
                )}
              />
            )}
            <div
              className={cn(
                "relative rounded-2xl flex flex-col max-h-[520px] overflow-hidden",
                "bg-white dark:bg-zinc-900",
                "border border-zinc-200 dark:border-zinc-700/60",
                "shadow-xl shadow-zinc-200/50 dark:shadow-black/30"
              )}
            >
              {/* 顶部光泽效果，跟随圆角并向下淡出 */}
              <div className="absolute inset-0 rounded-[inherit] pointer-events-none z-20 overflow-hidden">
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

            {/* 搜索头部 */}
            <div className="p-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur-sm sticky top-0 z-10">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索模型..."
                  autoFocus
                  className={cn(
                    "w-full pl-10 pr-3 py-2.5 rounded-xl text-sm",
                    "bg-white dark:bg-zinc-800",
                    "border border-zinc-200 dark:border-zinc-700",
                    "text-zinc-900 dark:text-zinc-100",
                    "placeholder:text-zinc-400 dark:placeholder:text-zinc-500",
                    "focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                  )}
                />
              </div>
            </div>

            {/* 模型列表 */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-[200px] max-h-[380px] scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-700">
              {filteredGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-400 dark:text-zinc-500">
                  <Box className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">未找到匹配模型</p>
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <div key={group.provider.code} className="mb-2">
                    {/* 提供商头部 */}
                    <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400 sticky top-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm z-0">
                      <ProviderIcon code={group.provider.code} size={16} />
                      <span className="uppercase tracking-wider">
                        {group.provider.display_name || group.provider.name}
                      </span>
                    </div>
                    
                    {/* 模型项 */}
                    <div className="space-y-0.5">
                      {group.models.map((model) => {
                        const abilities = resolveAbilities(model);
                        const contextWindow = resolveContextWindow(model);
                        const isSelected = value === model.model_id && 
                          (!selectedProviderCode || selectedProviderCode === group.provider.code);

                        return (
                          <button
                            key={model.id}
                            onClick={() => handleSelect(model, group.provider)}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150",
                              isSelected
                                ? "bg-primary/10 dark:bg-primary/15"
                                : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                            )}
                          >
                            {/* 模型图标 */}
                            <ProviderIcon 
                              code={group.provider.code} 
                              size={20}
                              className="shrink-0"
                            />
                            
                            {/* 模型名称 */}
                            <span className={cn(
                              "flex-1 font-medium text-sm truncate",
                              isSelected 
                                ? "text-primary" 
                                : "text-zinc-700 dark:text-zinc-200"
                            )}>
                              {model.display_name || model.model_id}
                            </span>

                            {/* 能力徽章 */}
                            <div className="flex items-center gap-1 shrink-0">
                              {abilities.vision && (
                                <AbilityBadge 
                                  icon={Eye} 
                                  color="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" 
                                  title="视觉"
                                />
                              )}
                              {abilities.reasoning && (
                                <AbilityBadge 
                                  icon={Brain} 
                                  color="bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400" 
                                  title="推理"
                                />
                              )}
                              {abilities.search && (
                                <AbilityBadge 
                                  icon={Globe} 
                                  color="bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400" 
                                  title="搜索"
                                />
                              )}
                              {abilities.functionCall && (
                                <AbilityBadge 
                                  icon={Terminal} 
                                  color="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" 
                                  title="函数调用"
                                />
                              )}
                              {abilities.imageOutput && (
                                <AbilityBadge 
                                  icon={Image} 
                                  color="bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400" 
                                  title="图像生成"
                                />
                              )}
                              
                              {/* 上下文窗口徽章 */}
                              {contextWindow && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                                  <Zap className="w-3 h-3" />
                                  {formatContext(contextWindow)}
                                </span>
                              )}

                              {/* 选中标记 */}
                              {isSelected && (
                                <Check className="w-4 h-4 text-primary ml-1" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 底部 */}
              <div className="p-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                <a 
                  href="/admin/ai-config" 
                  className="flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
                >
                  <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4" />
                    管理提供商
                  </div>
                  <ChevronRight className="w-4 h-4" />
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ModelSelector;
