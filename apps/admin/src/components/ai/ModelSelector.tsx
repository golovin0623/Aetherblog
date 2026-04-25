
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  menuPlacement?: 'top' | 'bottom';
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
  menuPlacement = 'bottom',
  menuClassName = '',
  triggerClassName = '',
  showArrow = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  // 缓存最近一次选中的模型/供应商，确保即使查询数据暂时不可用，触发器也能始终显示选中状态
  const selectedCacheRef = useRef<{ model: AiModel; provider: AiProvider } | null>(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 获取提供商
  const { data: providersResponse } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => aiProviderService.listProviders(true), // 仅获取已启用的供应商
    staleTime: 30_000,
  });

  // 获取模型
  const { data: modelsResponse } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => aiProviderService.listModels(undefined, undefined),
    staleTime: 30_000,
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

    // 若供应商列表中不包含筛选出的供应商（例如已被禁用），
    // 仍将模型归入占位符分组后返回。
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

  const selectedProvider = useMemo(() => {
    if (!selectedModel) return null;
    return providers.find((p) => p.code === selectedModel.provider_code) || null;
  }, [providers, selectedModel]);

  // 健壮性显示：当查询结果查找失败时，回退到缓存的选中状态
  const displayModel = selectedModel ?? (
    value && selectedCacheRef.current?.model.model_id === value
      ? selectedCacheRef.current.model
      : null
  );
  const displayProvider = selectedProvider ?? (
    displayModel && selectedCacheRef.current?.provider.code === displayModel.provider_code
      ? selectedCacheRef.current.provider
      : null
  );

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // 检查点击是否在触发器内或在 Portal 内容中
      const isInsideTrigger = triggerRef.current?.contains(target);
      const isInsidePortal = (target as HTMLElement).closest('.model-selector-portal');

      if (!isInsideTrigger && !isInsidePortal) {
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
    selectedCacheRef.current = { model, provider };
    onChange(model.model_id, provider.code);
    setIsOpen(false);
    setSearch('');
  };

  const formatContext = (tokens?: number | null) => {
    if (!tokens) return null;
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
    return tokens;
  };

  const renderContent = () => (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden",
        isMobile
          ? "surface-overlay h-[70vh] !rounded-none !rounded-t-2xl"
          : "surface-overlay !rounded-2xl max-h-[520px]"
      )}
    >
      {/* 移动端抽屉手柄 */}
      {isMobile && (
        <div className="flex-shrink-0 flex justify-center pt-3 pb-2">
          <div
            className="w-10 h-1 rounded-full"
            style={{ background: 'rgb(from var(--ink-muted) r g b / 0.5)' }}
          />
        </div>
      )}

      {/* 搜索头部 */}
      <div
        className={cn(
          "px-4 py-3 sticky top-0 z-10",
          "border-b border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]",
          isMobile && "pt-1"
        )}
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ink-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模型..."
            autoFocus={!isMobile}
            className={cn(
              "w-full pl-10 pr-3 py-2.5 rounded-xl text-sm",
              "bg-[color-mix(in_oklch,var(--bg-substrate)_70%,transparent)]",
              "border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)]",
              "text-[var(--ink-primary)]",
              "placeholder:text-[var(--ink-muted)]",
              "focus:outline-none",
              "focus:border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)]",
              "focus:ring-2 focus:ring-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]"
            )}
          />
        </div>
      </div>

      {/* 模型列表 */}
      <div className={cn(
        "flex-1 overflow-y-auto p-2 no-scrollbar",
        isMobile ? "px-4" : "min-h-[200px] max-h-[380px]"
      )}>
        {filteredGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--ink-muted)]">
            <Box className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">未找到匹配模型</p>
          </div>
        ) : (
          filteredGroups.map((group, groupIndex) => (
            <div key={group.provider.code} className={cn("mb-3", groupIndex === 0 && "mt-1")}>
              {/* 提供商分组头 —— mono uppercase,视觉上与模型行严格区分 */}
              <div
                className={cn(
                  "flex items-center gap-2 px-3 pt-2 pb-1.5 sticky top-0 z-[1]",
                  "font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]",
                  "bg-[color-mix(in_oklch,var(--bg-substrate)_78%,transparent)] backdrop-blur-sm"
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-px flex-1"
                  style={{ background: 'rgb(from var(--ink-primary) r g b / 0.1)' }}
                />
                <span className="shrink-0">
                  {group.provider.display_name || group.provider.name}
                </span>
                <span
                  aria-hidden="true"
                  className="h-px w-4 shrink-0"
                  style={{ background: 'rgb(from var(--ink-primary) r g b / 0.1)' }}
                />
              </div>

              {/* 模型项 */}
              <div className="space-y-0.5 pt-1">
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
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors duration-150",
                        isSelected
                          ? "bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]"
                          : "hover:bg-[color-mix(in_oklch,var(--aurora-2)_8%,transparent)]"
                      )}
                    >
                      {/* 模型图标 */}
                      <ProviderIcon
                        code={group.provider.code}
                        icon={group.provider.icon}
                        size={20}
                        className="shrink-0"
                      />

                      {/* 模型名称 */}
                      <div className="flex-1 min-w-0">
                        <div className={cn(
                          "font-medium text-sm truncate",
                          isSelected
                            ? "text-[var(--aurora-1)]"
                            : "text-[var(--ink-primary)]"
                        )}>
                          {model.display_name || model.model_id}
                        </div>
                        {isMobile && contextWindow && (
                          <div className="mt-0.5 font-mono text-[10px] tracking-[0.14em] text-[var(--ink-muted)] flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {formatContext(contextWindow)} · CTX
                          </div>
                        )}
                      </div>

                      {/* 能力徽章 */}
                      <div className="flex items-center gap-1 shrink-0">
                        {!isMobile && abilities.vision && (
                          <AbilityBadge
                            icon={Eye}
                            color="bg-[color-mix(in_oklch,var(--signal-success)_16%,transparent)] text-[var(--signal-success)]"
                            title="视觉"
                          />
                        )}
                        {!isMobile && abilities.reasoning && (
                          <AbilityBadge
                            icon={Brain}
                            color="bg-[color-mix(in_oklch,var(--aurora-3)_16%,transparent)] text-[var(--aurora-3)]"
                            title="推理"
                          />
                        )}

                        {!isMobile && contextWindow && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-mono text-[10px] tracking-[0.12em] text-[var(--ink-muted)]">
                            <Zap className="w-3 h-3" />
                            {formatContext(contextWindow)}
                          </span>
                        )}

                        {/* 选中标记 */}
                        {isSelected && (
                          <Check className="w-5 h-5 text-[var(--aurora-1)] ml-1" />
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
      <div className={cn(
        "p-2 border-t border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]",
        isMobile && "pb-[max(1rem,env(safe-area-inset-bottom))] px-4"
      )}>
        <a
          href="/admin/ai-config"
          className={cn(
            "flex items-center justify-between w-full px-3 py-2.5 rounded-xl",
            "font-mono text-[11px] uppercase tracking-[0.18em]",
            "text-[var(--ink-muted)]",
            "hover:text-[var(--aurora-1)]",
            "hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]",
            "transition-colors"
          )}
        >
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            管理提供商
          </div>
          <ChevronRight className="w-4 h-4" />
        </a>
      </div>
    </div>
  );

  return (
    <div ref={triggerRef} className={cn("relative model-selector-container", className)}>
      {/* 触发按钮 - 仅显示提供商图标 */}
      <button
        onClick={() => {
          if (!isOpen && triggerRef.current) {
            setTriggerRect(triggerRef.current.getBoundingClientRect());
          }
          setIsOpen(!isOpen);
        }}
        className={cn(
          "flex items-center gap-2 border transition-all duration-200 px-3 w-full",
          variant === 'compact'
            ? "h-8 rounded-lg"
            : "h-9 rounded-full",
          "bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-secondary)]",
          "border-[var(--border-default)]",
          "hover:border-primary/40 hover:shadow-md hover:shadow-primary/5",
          isOpen && "ring-2 ring-primary/20 border-primary/50",
          !displayModel && !isOpen && "animate-breathing-light border-primary/30",
          triggerClassName
        )}
      >
        {displayModel ? (
          <>
            <ProviderIcon
              code={displayModel.provider_code}
              icon={displayProvider?.icon || null}
              size={variant === 'compact' ? 14 : 16}
            />
            <span className="text-[10px] sm:text-xs font-bold text-[var(--text-primary)] truncate max-w-[100px] sm:max-w-[120px] uppercase tracking-tighter">
              {displayModel.display_name || displayModel.model_id}
            </span>
            <ChevronsUpDown className="w-3 h-3 text-[var(--text-muted)] opacity-50 ml-auto flex-shrink-0" />
          </>
        ) : (
          <>
            <Box className={cn(
              "text-[var(--text-muted)]",
              variant === 'compact' ? "w-3.5 h-3.5" : "w-4 h-4"
            )} />
            <span className="text-[10px] sm:text-xs text-[var(--text-muted)] font-bold uppercase tracking-tighter">选择模型</span>
            <ChevronsUpDown className="w-3 h-3 text-[var(--text-muted)] opacity-50 ml-auto flex-shrink-0" />
          </>
        )}
      </button>


        {isOpen && createPortal(
          <AnimatePresence mode="wait">
            {isMobile ? (
              <div className="fixed inset-0 z-[9999] flex flex-col justify-end model-selector-portal">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsOpen(false)}
                  className="absolute inset-0 backdrop-blur-sm"
                  style={{ background: 'rgb(from var(--bg-void) r g b / 0.7)' }}
                />
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 25, stiffness: 200 }}
                  className="relative z-10"
                >
                  {renderContent()}
                </motion.div>
              </div>
            ) : (
              <div
                className="fixed inset-0 z-[9999] pointer-events-none model-selector-portal"
                onClick={(e) => {
                  if (e.target === e.currentTarget) setIsOpen(false);
                }}
              >
                <div
                  className="pointer-events-auto absolute"
                  style={{
                    left: triggerRect ? (menuAlign === 'right' ? triggerRect.right - (variant === 'compact' ? 340 : 380) : triggerRect.left) : 0,
                    top: triggerRect ? (menuPlacement === 'top' ? triggerRect.top - 8 : triggerRect.bottom + 8) : 0,
                    transform: menuPlacement === 'top' ? 'translateY(-100%)' : 'none',
                    width: variant === 'compact' ? '340px' : '380px'
                  }}
                >
                  <motion.div
                    initial={{
                      opacity: 0,
                      y: menuPlacement === 'top' ? 10 : -10,
                      scale: 0.98
                    }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{
                      opacity: 0,
                      y: menuPlacement === 'top' ? 10 : -10,
                      scale: 0.98
                    }}
                    transition={{ duration: 0.15 }}
                    className={cn(
                      "flex flex-col max-h-[520px]",
                      menuClassName
                    )}
                  >
                    {renderContent()}
                  </motion.div>
                </div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}

    </div>
  );
};

export default ModelSelector;
