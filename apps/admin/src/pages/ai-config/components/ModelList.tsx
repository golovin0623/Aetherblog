// 模型列表组件
// ref: §5.1 - AI Service 架构

import { useState, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Plus,
  RefreshCw,
  Search,
  Trash2,
  ArrowDownUp,
  ToggleLeft,
} from 'lucide-react';
import type { AiModel } from '@/services/aiProviderService';
import { MODEL_TYPES, type ModelType } from '../types';
import {
  useFilteredModels,
  countModelsByType,
  useSyncRemoteModels,
  useClearProviderModels,
  useBatchToggleModels,
} from '../hooks/useModels';
import ModelCard from './ModelCard';
import ModelConfigDialog from './ModelConfigDialog';
import ModelSortDialog from './ModelSortDialog';
import { resolveModelSource } from '../utils/modelCapabilities';

interface ModelListProps {
  providerCode: string;
  providerApiType?: string | null;
  providerCapabilities?: Record<string, unknown> | null;
  models: AiModel[];
  credentialId?: number | null;
  isLoading?: boolean;
  showDeployName?: boolean;
}

export default function ModelList({
  providerCode,
  providerApiType,
  providerCapabilities,
  models,
  credentialId,
  isLoading,
  showDeployName,
}: ModelListProps) {
  const [activeTab, setActiveTab] = useState<ModelType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [editingModel, setEditingModel] = useState<AiModel | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showSortDialog, setShowSortDialog] = useState(false);

  const syncRemoteModels = useSyncRemoteModels();
  const clearProviderModels = useClearProviderModels();
  const batchToggleModels = useBatchToggleModels();

  // 统计各类型数量
  const typeCounts = useMemo(() => countModelsByType(models), [models]);

  // 筛选模型
  const { enabled, disabled } = useFilteredModels(models, {
    modelType: activeTab,
    search,
  });

  const hasRemoteModels = models.some((m) => resolveModelSource(m) === 'remote');
  const providerSettings = (providerCapabilities?.settings || {}) as Record<string, unknown>;
  const allowRemote = ['openai_compat', 'anthropic'].includes(providerApiType || '');
  const modelEditable = providerSettings.modelEditable !== false;
  const allowAddModel =
    modelEditable && providerSettings.showAddNewModel !== false;
  const showModelFetcher =
    typeof providerSettings.showModelFetcher === 'boolean'
      ? providerSettings.showModelFetcher
      : allowRemote;
  const canFetchRemote = showModelFetcher && allowRemote && !!credentialId;

  // Tab 列表
  const tabs = [
    { value: 'all' as const, label: '全部' },
    ...MODEL_TYPES.filter((t) => typeCounts[t.value] > 0),
  ];

  const handleFetchRemote = () => {
    syncRemoteModels.mutate({ providerCode, credentialId: credentialId ?? null });
  };

  const handleClearRemote = () => {
    if (!confirm('确定清空远程拉取的模型吗？')) return;
    clearProviderModels.mutate({ providerCode, source: 'remote' });
  };

  const handleResetAll = () => {
    if (!confirm('确定清空该供应商下的全部模型吗？')) return;
    clearProviderModels.mutate({ providerCode });
  };

  const handleDisableAll = () => {
    if (!modelEditable) return;
    if (enabled.length === 0) return;
    batchToggleModels.mutate({
      providerCode,
      ids: enabled.map((m) => m.id),
      enabled: false,
    });
  };

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">模型列表</h2>
          <span className="text-xs text-[var(--text-muted)]">共 {models.length} 个可用</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 搜索 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模型..."
            className="w-44 pl-8 pr-3 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 transition-all"
          />
        </div>

          {/* 拉取 */}
          {canFetchRemote && (
            <button
              onClick={handleFetchRemote}
              disabled={isLoading || syncRemoteModels.isPending}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-default)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncRemoteModels.isPending ? 'animate-spin' : ''}`} />
              拉取模型
            </button>
          )}

          {/* 清空远程 */}
          {hasRemoteModels && (
            <button
              onClick={handleClearRemote}
              disabled={clearProviderModels.isPending}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清空远程
            </button>
          )}

          {/* 重置 */}
          <button
            onClick={handleResetAll}
            disabled={clearProviderModels.isPending || !modelEditable}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-default)] text-xs text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] transition-all disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            重置
          </button>

          {/* 排序 */}
          <button
            onClick={() => setShowSortDialog(true)}
            disabled={!modelEditable}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-default)] text-xs text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] transition-all disabled:opacity-50"
          >
            <ArrowDownUp className="w-3.5 h-3.5" />
            排序
          </button>

          {/* 禁用全部 */}
          <button
            onClick={handleDisableAll}
            disabled={batchToggleModels.isPending || enabled.length === 0 || !modelEditable}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-default)] text-xs text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] transition-all disabled:opacity-50"
          >
            <ToggleLeft className="w-3.5 h-3.5" />
            全部禁用
          </button>

          {/* 添加 */}
          {allowAddModel && (
            <button
              onClick={() => setShowAddDialog(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              添加
            </button>
          )}
        </div>
      </div>

      {/* Tab 筛选 */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeTab === tab.value
                ? 'bg-primary/15 text-primary'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {tab.label}
            <span className="opacity-60">({tab.value === 'all' ? typeCounts.all : typeCounts[tab.value] || 0})</span>
          </button>
        ))}
      </div>

      {/* 模型列表 */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-8 text-[var(--text-muted)] text-sm">加载中...</div>
        ) : enabled.length === 0 && disabled.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-muted)] text-sm">暂无模型</div>
        ) : (
          <>
            {/* 已启用 */}
            {enabled.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--text-muted)] font-medium">已启用</div>
                <div className="space-y-2">
                  <AnimatePresence>
                    {enabled.map((model) => (
                      <ModelCard
                        key={model.id}
                        model={model}
                        readOnly={!modelEditable}
                        onEdit={() => setEditingModel(model)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {/* 未启用 */}
            {disabled.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--text-muted)] font-medium">未启用</div>
                <div className="space-y-2">
                  <AnimatePresence>
                    {disabled.map((model) => (
                      <ModelCard
                        key={model.id}
                        model={model}
                        readOnly={!modelEditable}
                        onEdit={() => setEditingModel(model)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 模型排序弹窗 */}
      <AnimatePresence>
        {showSortDialog && (
          <ModelSortDialog
            providerCode={providerCode}
            models={models}
            onClose={() => setShowSortDialog(false)}
          />
        )}
      </AnimatePresence>

      {/* 模型配置弹窗 */}
      <AnimatePresence>
        {(editingModel || showAddDialog) && (
          <ModelConfigDialog
            mode={editingModel ? 'edit' : 'create'}
            providerCode={providerCode}
            initial={editingModel}
            showDeployName={showDeployName}
            onClose={() => {
              setEditingModel(null);
              setShowAddDialog(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
