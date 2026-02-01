
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  ChevronsUpDown, 
  Search, 
  Check, 
  Settings, 
  Box,
  Zap,
  Cpu,
  Eye,
  Brain,
  Globe,
  Terminal,
  Image,
  Paperclip,
  Brackets,
  Video
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

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  value,
  onChange,
  className,
  providerCode,
  modelType,
  variant = 'default',
  selectedProviderCode,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Fetch Providers
  const { data: providersResponse } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => aiProviderService.listProviders(true) // only enabled
  });

  // Fetch Models
  const { data: modelsResponse } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => aiProviderService.listModels(undefined, undefined)
  });

  const providers = providersResponse?.data || [];
  const allModels = modelsResponse?.data || [];

  // Group models by provider
  const groupedModels = useMemo(() => {
    const groups: GroupedModels[] = [];
    const filteredModels = allModels.filter((model) => {
      if (!model.is_enabled) return false;
      if (modelType && model.model_type !== modelType) return false;
      if (providerCode && model.provider_code !== providerCode) return false;
      return true;
    });
    
    // Sort providers by priority
    const sortedProviders = [...providers].sort((a, b) => b.priority - a.priority);

    sortedProviders.forEach(provider => {
      // Filter models for this provider
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

    // If provider list did not include the filtered provider (e.g., disabled),
    // still return models grouped under a placeholder.
    if (groups.length === 0 && filteredModels.length > 0 && providerCode) {
      const fallbackProvider = providers.find((p) => p.code === providerCode);
      if (fallbackProvider) {
        groups.push({ provider: fallbackProvider, models: filteredModels });
      }
    }

    return groups;
  }, [providers, allModels, modelType, providerCode]);

  // Filter based on search
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groupedModels;

    const lowerSearch = search.toLowerCase();
    
    return groupedModels.map(group => {
      // Check if provider matches
      const providerMatch = 
        group.provider.name.toLowerCase().includes(lowerSearch) ||
        (group.provider.display_name && group.provider.display_name.toLowerCase().includes(lowerSearch));

      if (providerMatch) return group;

      // Filter models
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

  // Find selected model object
  const selectedModel = useMemo(() => {
    if (!value) return null;
    if (selectedProviderCode) {
      return allModels.find(
        (m) => m.model_id === value && m.provider_code === selectedProviderCode
      );
    }
    return allModels.find(m => m.model_id === value);
  }, [allModels, value, selectedProviderCode]);

  // Close on outside click (simplified for now, ideally use a click-outside hook)
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

  // Helper to format context window
  const formatContext = (tokens?: number | null) => {
    if (!tokens) return null;
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
    return tokens;
  };

  return (
    <div className={cn("relative model-selector-container", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center gap-3 border transition-all duration-200",
          variant === 'compact'
            ? "h-8 px-2.5 rounded-full text-xs"
            : "h-9 px-3 rounded-full text-sm sm:w-[260px]",
          "bg-[var(--bg-primary)] border-[var(--border-default)]",
          "hover:border-primary/40 hover:bg-[var(--bg-card-hover)]",
          isOpen && "ring-2 ring-primary/20 border-primary/50"
        )}
      >
        {selectedModel ? (
          <>
            <ProviderIcon
              code={selectedModel.provider_code}
              size={variant === 'compact' ? 16 : 18}
              className="shrink-0"
            />
            <div className="flex flex-col items-start min-w-0 flex-1">
              <span
                className={cn(
                  "font-semibold text-[var(--text-primary)] truncate block w-full text-left",
                  variant === 'compact' ? "text-xs" : "text-sm"
                )}
              >
                {selectedModel.display_name || selectedModel.model_id}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] truncate block w-full text-left">
                {selectedModel.model_id}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="w-5 h-5 rounded bg-[var(--bg-muted)] flex items-center justify-center">
               <Box className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            </div>
            <span className="text-[var(--text-muted)] flex-1 text-left text-xs">选择模型...</span>
          </>
        )}
        <ChevronsUpDown className={cn("text-[var(--text-muted)] shrink-0", variant === 'compact' ? "w-3.5 h-3.5" : "w-4 h-4")} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "absolute top-full left-0 z-50 mt-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] shadow-2xl overflow-hidden flex flex-col max-h-[520px]",
              variant === 'compact' ? "w-[320px]" : "w-[360px]"
            )}
          >
            {/* Search Header */}
            <div className="p-3 border-b border-[var(--border-default)] bg-[var(--bg-primary)] sticky top-0 z-10">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索模型..."
                  autoFocus
                  className={cn(
                    "w-full pl-9 pr-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 placeholder:text-[var(--text-muted)]/50",
                    variant === 'compact' ? "py-1.5 text-xs" : "py-2 text-sm"
                  )}
                />
              </div>
            </div>

            {/* Models List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4 min-h-[200px] scrollbar-thin">
              {filteredGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-[var(--text-muted)]">
                  <Box className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs">未找到匹配模型</p>
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <div key={group.provider.code}>
                    <div className="px-2 py-1.5 flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider sticky top-0 bg-[var(--bg-card)]/90 backdrop-blur-sm z-0">
                      <ProviderIcon code={group.provider.code} size={14} />
                      {group.provider.display_name || group.provider.name}
                    </div>
                    <div className="space-y-1">
                      {group.models.map((model) => {
                        const abilities = resolveAbilities(model);
                        const contextWindow = resolveContextWindow(model);

                        const badges = [
                          abilities.vision && { key: "vision", icon: Eye, className: "bg-emerald-500/15 text-emerald-500" },
                          abilities.reasoning && { key: "reasoning", icon: Brain, className: "bg-violet-500/15 text-violet-500" },
                          abilities.search && { key: "search", icon: Globe, className: "bg-sky-500/15 text-sky-500" },
                          abilities.functionCall && { key: "function", icon: Terminal, className: "bg-amber-500/15 text-amber-500" },
                          abilities.files && { key: "files", icon: Paperclip, className: "bg-lime-500/15 text-lime-500" },
                          abilities.structuredOutput && { key: "structured", icon: Brackets, className: "bg-fuchsia-500/15 text-fuchsia-500" },
                          abilities.imageOutput && { key: "image", icon: Image, className: "bg-pink-500/15 text-pink-500" },
                          abilities.video && { key: "video", icon: Video, className: "bg-indigo-500/15 text-indigo-500" },
                        ].filter(Boolean) as Array<{ key: string; icon: React.FC<{ className?: string }>; className: string }>;

                        return (
                        <button
                          key={model.id}
                          onClick={() => handleSelect(model, group.provider)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all duration-200 group relative",
                            value === model.model_id
                              ? "bg-primary/10 border border-primary/20"
                              : "border border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "font-medium truncate text-sm",
                                value === model.model_id ? "text-primary" : "text-[var(--text-primary)]"
                              )}>
                                {model.display_name || model.model_id}
                              </span>
                              {value === model.model_id && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] truncate">
                              {model.model_id}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {badges.slice(0, 4).map((badge) => {
                              const Icon = badge.icon;
                              return (
                                <span
                                  key={badge.key}
                                  className={cn(
                                    "inline-flex items-center justify-center w-6 h-6 rounded-md text-[10px] border border-transparent",
                                    badge.className
                                  )}
                                  title={badge.key}
                                >
                                  <Icon className="w-3.5 h-3.5" />
                                </span>
                              );
                            })}
                            {contextWindow && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-[var(--bg-muted)] text-[var(--text-muted)] border border-[var(--border-subtle)] whitespace-nowrap">
                                <Zap className="w-3 h-3" />
                                {formatContext(contextWindow)}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-[var(--bg-muted)] text-[var(--text-muted)] border border-[var(--border-subtle)] whitespace-nowrap">
                              <Cpu className="w-3 h-3" />
                              {model.model_type}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]/30 backdrop-blur-sm">
              <a 
                href="/admin/ai-config" 
                className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-primary hover:bg-[var(--bg-card-hover)] transition-all"
              >
                <Settings className="w-3.5 h-3.5" />
                管理提供商
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ModelSelector;
