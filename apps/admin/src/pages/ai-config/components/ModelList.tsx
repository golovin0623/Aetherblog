// 模型列表组件
// ref: §5.1 - AI Service 架构

import { useEffect, useState, useMemo, useRef, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plus,
  RefreshCw,
  Search,
  Trash2,
  ArrowDownUp,
  ToggleLeft,
  Eye,
  Brain,
  Wand2,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { spring } from '@aetherblog/ui';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import type { AiModel } from '@/services/aiProviderService';
import { MODEL_TYPES, type ModelType, type ModelAbility } from '../types';
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
import { resolveModelSource, resolveModelAbilities } from '../utils/modelCapabilities';

// 可用于分面筛选的能力维度
type AbilityKey = 'functionCall' | 'vision' | 'reasoning' | 'search';

const ABILITY_FILTERS: Array<{ key: AbilityKey; label: string; icon: ComponentType<{ className?: string }> }> = [
  { key: 'functionCall', label: '工具', icon: Wand2 },
  { key: 'vision', label: '视觉', icon: Eye },
  { key: 'reasoning', label: '推理', icon: Brain },
  { key: 'search', label: '搜索', icon: Globe },
];

// 按所选能力做「与」筛选：模型须同时具备全部所选能力
function filterByAbilities(list: AiModel[], abilities: Set<AbilityKey>): AiModel[] {
  if (abilities.size === 0) return list;
  return list.filter((model) => {
    const resolved = resolveModelAbilities(model) as ModelAbility;
    return [...abilities].every((flag) => resolved[flag]);
  });
}

// 模型行骨架屏 —— 加载态遵循「骨架 + pulse」而非 spinner
function ModelRowSkeleton() {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl border border-[var(--border-default)]/40">
      <div className="w-2 h-2 rounded-full bg-[var(--bg-secondary)] animate-pulse mt-1" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-3.5 w-32 rounded bg-[var(--bg-secondary)] animate-pulse" />
        <div className="h-2.5 w-20 rounded bg-[var(--bg-secondary)]/70 animate-pulse" />
        <div className="flex gap-1.5">
          <div className="h-4 w-12 rounded bg-[var(--bg-secondary)]/60 animate-pulse" />
          <div className="h-4 w-12 rounded bg-[var(--bg-secondary)]/60 animate-pulse" />
        </div>
      </div>
      <div className="h-5 w-9 rounded-full bg-[var(--bg-secondary)] animate-pulse" />
    </div>
  );
}

interface ModelListProps {
  providerCode: string;
  providerApiType?: string | null;
  providerCapabilities?: Record<string, unknown> | null;
  models: AiModel[];
  credentialId?: number | null;
  isLoading?: boolean;
  showDeployName?: boolean;
  initialSearch?: string;
  variant?: 'default' | 'simple';
}

export default function ModelList({
  providerCode,
  providerApiType,
  providerCapabilities,
  models,
  credentialId,
  isLoading,
  showDeployName,
  initialSearch,
  variant: _variant = 'default',
}: ModelListProps) {
  const [activeTab, setActiveTab] = useState<ModelType | 'all'>('all');
  const [activeAbilities, setActiveAbilities] = useState<Set<AbilityKey>>(new Set());
  // 仅在首次挂载时用深链参数 `initialSearch` 初始化搜索框。
  // 后续重新挂载（例如移动端 tab 切换卸载该组件）必须从空开始 ——
  // 否则陈旧的过滤条件会被重新应用，导致列表看起来为空。
  const [search, setSearch] = useState(initialSearch ?? '');
  const seededRef = useRef(!!initialSearch);
  const [editingModel, setEditingModel] = useState<AiModel | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showSortDialog, setShowSortDialog] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'clearRemote' | 'resetAll' | null>(null);

  const syncRemoteModels = useSyncRemoteModels();
  const clearProviderModels = useClearProviderModels();
  const batchToggleModels = useBatchToggleModels();

  useEffect(() => {
    if (initialSearch && !seededRef.current) {
      setSearch(initialSearch);
      seededRef.current = true;
    }
  }, [initialSearch]);

  // 统计各类型数量
  const typeCounts = useMemo(() => countModelsByType(models), [models]);

  // 筛选模型（类型 + 搜索）
  const { enabled, disabled } = useFilteredModels(models, {
    modelType: activeTab,
    search,
  });

  // 叠加能力分面筛选
  const enabledFiltered = useMemo(() => filterByAbilities(enabled, activeAbilities), [enabled, activeAbilities]);
  const disabledFiltered = useMemo(() => filterByAbilities(disabled, activeAbilities), [disabled, activeAbilities]);
  const hasActiveFilter = activeAbilities.size > 0 || search.trim().length > 0;

  const toggleAbility = (key: AbilityKey) => {
    setActiveAbilities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hasRemoteModels = models.some((m) => resolveModelSource(m) === 'remote');
  const providerSettings = (providerCapabilities?.settings || {}) as Record<string, unknown>;
  const allowRemote = ['openai_compat', 'anthropic', 'google'].includes(providerApiType || '');
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
    clearProviderModels.mutate({ providerCode, source: 'remote' });
  };

  const handleResetAll = () => {
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
    <div className="ai-model-list space-y-4">
      {/* 头部 */}
      <div className="ai-model-list-toolbar flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)] whitespace-nowrap">模型列表</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
            {models.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap flex-1 sm:flex-none justify-end">
          {/* 搜索 */}
          <div className="relative group flex-1 sm:flex-none sm:w-40 min-w-[100px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] group-focus-within:text-primary transition-colors" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)]/40 focus:outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all"
            />
          </div>

          {/* 拉取 */}
          {canFetchRemote && (
            <button
              onClick={handleFetchRemote}
              disabled={isLoading || syncRemoteModels.isPending}
              title="拉取模型"
              className="inline-flex items-center justify-center gap-1.5 h-9 min-w-9 sm:min-w-0 px-2.5 rounded-lg border border-[var(--border-default)] text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-hover)] transition-all disabled:opacity-50"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", syncRemoteModels.isPending && "animate-spin")} />
              <span className="hidden sm:inline">拉取</span>
            </button>
          )}

          {/* 清空远程 */}
          {hasRemoteModels && (
            <button
              onClick={() => setConfirmAction('clearRemote')}
              disabled={clearProviderModels.isPending}
              title="清空远程"
              className="inline-flex items-center justify-center gap-1.5 h-9 min-w-9 sm:min-w-0 px-2.5 rounded-lg border border-status-danger-border text-xs text-status-danger bg-[var(--bg-primary)] hover:bg-status-danger/5 transition-all disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">清空远程</span>
            </button>
          )}

          {/* 重置 */}
          <button
            onClick={() => setConfirmAction('resetAll')}
            disabled={clearProviderModels.isPending || !modelEditable}
            title="重置全部"
            className="inline-flex items-center justify-center gap-1.5 h-9 min-w-9 sm:min-w-0 px-2.5 rounded-lg border border-[var(--border-default)] text-xs text-[var(--text-muted)] bg-[var(--bg-primary)] hover:bg-[var(--bg-card-hover)] transition-all disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">重置</span>
          </button>

          {/* 排序 */}
          <button
            onClick={() => setShowSortDialog(true)}
            disabled={!modelEditable}
            title="手动排序"
            className="inline-flex items-center justify-center gap-1.5 h-9 min-w-9 sm:min-w-0 px-2.5 rounded-lg border border-[var(--border-default)] text-xs text-[var(--text-muted)] bg-[var(--bg-primary)] hover:bg-[var(--bg-card-hover)] transition-all disabled:opacity-50"
          >
            <ArrowDownUp className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">排序</span>
          </button>

          {/* 禁用全部 */}
          <button
            onClick={handleDisableAll}
            disabled={batchToggleModels.isPending || enabled.length === 0 || !modelEditable}
            title="全部禁用"
            className="inline-flex items-center justify-center gap-1.5 h-9 min-w-9 sm:min-w-0 px-2.5 rounded-lg border border-[var(--border-default)] text-xs text-[var(--text-muted)] bg-[var(--bg-primary)] hover:bg-[var(--bg-card-hover)] transition-all disabled:opacity-50"
          >
            <ToggleLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">下架</span>
          </button>

          {/* 添加 */}
          {allowAddModel && (
            <button
              onClick={() => setShowAddDialog(true)}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-black dark:bg-white text-white dark:text-black text-xs font-bold hover:opacity-90 transition-all shadow-sm active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="inline">添加</span>
            </button>
          )}
        </div>
      </div>

      {/* Tab 筛选 */}
      <div className="ai-model-list-tabs flex items-center gap-1 overflow-x-auto pb-1">
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

      {/* 能力分面筛选 */}
      <div className="ai-model-list-abilities flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)] mr-0.5">能力</span>
        {ABILITY_FILTERS.map(({ key, label, icon: Icon }) => {
          const active = activeAbilities.has(key);
          return (
            <motion.button
              key={key}
              type="button"
              whileTap={{ scale: 0.94 }}
              transition={spring.precise}
              onClick={() => toggleAbility(key)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] font-medium transition-colors ${
                active
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--border-hover)]'
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
            </motion.button>
          );
        })}
        {activeAbilities.size > 0 && (
          <button
            type="button"
            onClick={() => setActiveAbilities(new Set())}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline-offset-2 hover:underline ml-0.5"
          >
            清除
          </button>
        )}
      </div>

      {/* 模型列表 */}
      <div className="ai-model-list-body space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <ModelRowSkeleton key={i} />
            ))}
          </div>
        ) : enabledFiltered.length === 0 && disabledFiltered.length === 0 ? (
          <div className="text-center py-10 text-[var(--text-muted)] text-sm">
            {hasActiveFilter ? '没有符合筛选条件的模型' : '暂无模型'}
          </div>
        ) : (
          <>
            {/* 已启用 */}
            {enabledFiltered.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--text-muted)] font-medium">已启用</div>
                <div className="space-y-2">
                  <AnimatePresence>
                    {enabledFiltered.map((model) => (
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
            {disabledFiltered.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--text-muted)] font-medium">未启用</div>
                <div className="space-y-2">
                  <AnimatePresence>
                    {disabledFiltered.map((model) => (
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

      <ConfirmDialog
        isOpen={confirmAction === 'clearRemote'}
        title="清空远程模型"
        message="确定清空远程拉取的模型吗？此操作不可撤销。"
        confirmText="清空"
        variant="danger"
        onConfirm={() => { setConfirmAction(null); handleClearRemote(); }}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        isOpen={confirmAction === 'resetAll'}
        title="重置全部模型"
        message="确定清空该供应商下的全部模型吗？此操作不可撤销。"
        confirmText="重置"
        variant="danger"
        onConfirm={() => { setConfirmAction(null); handleResetAll(); }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
