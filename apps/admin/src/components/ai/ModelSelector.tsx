
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  ChevronsUpDown, 
  Search, 
  Check, 
  Settings, 
  Box, 
  Sparkles,
  Zap,
  Cpu
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { aiProviderService, AiProvider, AiModel } from '@/services/aiProviderService';
import ProviderIcon from '@/pages/ai-config/components/ProviderIcon';

interface ModelSelectorProps {
  value?: string;
  onChange: (modelId: string, provider: string) => void;
  className?: string;
}

interface GroupedModels {
  provider: AiProvider;
  models: AiModel[];
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  value,
  onChange,
  className
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
    
    // Sort providers by priority
    const sortedProviders = [...providers].sort((a, b) => b.priority - a.priority);

    sortedProviders.forEach(provider => {
      // Filter models for this provider
      const providerModels = allModels.filter(
        m => m.provider_code === provider.code && m.is_enabled
      );

      if (providerModels.length > 0) {
        groups.push({
          provider,
          models: providerModels
        });
      }
    });

    return groups;
  }, [providers, allModels]);

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
    return allModels.find(m => m.model_id === value);
  }, [allModels, value]);

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
          "w-[280px] flex items-center gap-3 px-3 py-2 rounded-xl border transition-all duration-200",
          "bg-[var(--bg-card)]/50 backdrop-blur-sm border-[var(--border-default)]",
          "hover:border-primary/50 hover:bg-[var(--bg-card-hover)]",
          isOpen && "ring-2 ring-primary/20 border-primary"
        )}
      >
        {selectedModel ? (
          <>
            <ProviderIcon code={selectedModel.provider_code} size={20} className="shrink-0" />
            <div className="flex flex-col items-start min-w-0 flex-1">
              <span className="text-sm font-medium text-[var(--text-primary)] truncate block w-full text-left">
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
            <span className="text-sm text-[var(--text-muted)] flex-1 text-left">选择模型...</span>
          </>
        )}
        <ChevronsUpDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 z-50 mt-2 w-[320px] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] shadow-2xl overflow-hidden flex flex-col max-h-[500px]"
          >
            {/* Search Header */}
            <div className="p-3 border-b border-[var(--border-default)] bg-[var(--bg-secondary)]/50 backdrop-blur-sm sticky top-0 z-10">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索模型..."
                  autoFocus
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 placeholder:text-[var(--text-muted)]/50"
                />
              </div>
            </div>

            {/* Models List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-4 min-h-[200px] scrollbar-thin">
              {filteredGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-[var(--text-muted)]">
                  <Box className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs">未找到匹配模型</p>
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <div key={group.provider.code}>
                    <div className="px-3 py-1.5 flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider sticky top-0 bg-[var(--bg-card)]/90 backdrop-blur-sm z-0">
                      <ProviderIcon code={group.provider.code} size={14} />
                      {group.provider.display_name || group.provider.name}
                    </div>
                    <div className="space-y-1">
                      {group.models.map((model) => (
                        <button
                          key={model.id}
                          onClick={() => handleSelect(model, group.provider)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 group relative",
                            value === model.model_id 
                              ? "bg-primary/10 text-primary" 
                              : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                          )}
                        >
                          <div className={cn(
                            "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-0 transition-all duration-300 rounded-r-full",
                            value === model.model_id ? "h-6 bg-primary" : "group-hover:h-3 group-hover:bg-[var(--border-default)]"
                          )} />
                          
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
                             
                             <div className="flex items-center gap-2 mt-0.5">
                               {/* Tags display */}
                               <div className="flex items-center gap-1.5 overflow-hidden">
                                  {/* Context Window Tag */}
                                  {model.context_window && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--bg-muted)] text-[var(--text-muted)] border border-[var(--border-subtle)] whitespace-nowrap">
                                      <Zap className="w-2.5 h-2.5 mr-0.5" />
                                      {formatContext(model.context_window)}
                                    </span>
                                  )}
                                  
                                  {/* Model Type Tag */}
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--bg-muted)] text-[var(--text-muted)] border border-[var(--border-subtle)] whitespace-nowrap">
                                     <Cpu className="w-2.5 h-2.5 mr-0.5" />
                                     {model.model_type}
                                  </span>
                               </div>
                             </div>
                          </div>
                        </button>
                      ))}
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
