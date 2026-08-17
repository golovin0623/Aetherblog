// 模型列表组件 —— 供应商详情内的「模型工作台」
// ref: §5.1 - AI Service 架构
// 设计: 工具栏 aiw-tool-button · 类型分段 IntelligenceSegmented · 分组眉 aiw-group-label
//      键盘 `/` 聚焦搜索,筛选态显示命中数,加载态骨架屏(禁 spinner)

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
  SearchX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { spring } from '@aetherblog/ui';
import { IntelligenceSegmented } from '@/components/intelligence';
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

// 模型行骨架屏 —— 加载态遵循「骨架 + shimmer」而非 spinner
function ModelRowSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--intelligence-border)] px-3.5 py-3">
      <div className="global-pricing-skeleton-block mt-1 h-2 w-2 rounded-full" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="global-pricing-skeleton-block h-3.5 w-36 rounded" />
        <div className="global-pricing-skeleton-block h-2.5 w-24 rounded" />
        <div className="flex gap-1.5">
          <div className="global-pricing-skeleton-block h-4 w-12 rounded-full" />
          <div className="global-pricing-skeleton-block h-4 w-12 rounded-full" />
        </div>
      </div>
      <div className="global-pricing-skeleton-block h-5 w-9 rounded-full" />
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
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  // 工作台快捷键:`/` 聚焦模型搜索(输入态不劫持)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      // 有弹窗打开时不抢焦点 —— 否则会把焦点从模态层拽到背景的搜索框,
      // 既击穿弹窗的焦点陷阱,又让用户对着看不见的输入框打字。
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
  const matchedCount = enabledFiltered.length + disabledFiltered.length;

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

  // 类型分段选项(只保留有模型的类型)
  const typeOptions = useMemo(
    () => [
      { value: 'all' as const, label: `全部 ${typeCounts.all}` },
      ...MODEL_TYPES.filter((t) => typeCounts[t.value] > 0).map((t) => ({
        value: t.value,
        label: `${t.label} ${typeCounts[t.value]}`,
      })),
    ],
    [typeCounts]
  );

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
      {/* 工具栏 */}
      <div className="ai-model-list-toolbar flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="whitespace-nowrap text-sm font-semibold text-[var(--ink-primary)]">模型列表</h2>
          <span className="font-mono text-micro text-[var(--ink-muted)]">
            {hasActiveFilter ? `${matchedCount} / ${models.length}` : models.length}
          </span>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5 sm:flex-none sm:flex-nowrap">
          {/* 搜索(`/` 聚焦) */}
          <div className="group relative min-w-[110px] flex-1 sm:w-44 sm:flex-none">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)] transition-colors duration-quick ease-aether group-focus-within:text-[var(--aurora-1)]" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索模型  /"
              className="aiw-input h-9 w-full !py-0 !pl-8 !pr-3 text-xs"
            />
          </div>

          {/* 拉取 */}
          {canFetchRemote && (
            <button
              onClick={handleFetchRemote}
              disabled={isLoading || syncRemoteModels.isPending}
              title="从供应商拉取模型目录"
              className="aiw-tool-button"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', syncRemoteModels.isPending && 'animate-spin')} />
              <span className="hidden sm:inline">拉取</span>
            </button>
          )}

          {/* 清空远程 */}
          {hasRemoteModels && (
            <button
              onClick={() => setConfirmAction('clearRemote')}
              disabled={clearProviderModels.isPending}
              title="清空远程拉取的模型"
              className="aiw-tool-button"
              data-tone="danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">清空远程</span>
            </button>
          )}

          {/* 重置 */}
          <button
            onClick={() => setConfirmAction('resetAll')}
            disabled={clearProviderModels.isPending || !modelEditable}
            title="重置全部模型"
            className="aiw-tool-button"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">重置</span>
          </button>

          {/* 排序 */}
          <button
            onClick={() => setShowSortDialog(true)}
            disabled={!modelEditable}
            title="手动排序"
            className="aiw-tool-button"
          >
            <ArrowDownUp className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">排序</span>
          </button>

          {/* 禁用全部 */}
          <button
            onClick={handleDisableAll}
            disabled={batchToggleModels.isPending || enabled.length === 0 || !modelEditable}
            title="下架全部已启用模型"
            className="aiw-tool-button"
          >
            <ToggleLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">下架</span>
          </button>

          {/* 添加 */}
          {allowAddModel && (
            <motion.button
              onClick={() => setShowAddDialog(true)}
              whileTap={{ scale: 0.96 }}
              transition={spring.precise}
              className="aiw-tool-button"
              data-tone="primary"
            >
              <Plus className="h-3.5 w-3.5" />
              添加
            </motion.button>
          )}
        </div>
      </div>

      {/* 类型分段 + 能力分面 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <IntelligenceSegmented
          value={activeTab}
          options={typeOptions}
          onChange={setActiveTab}
          ariaLabel="按模型类型筛选"
          className="ai-model-list-tabs max-w-full"
        />
        <div className="ai-model-list-abilities flex flex-wrap items-center gap-1.5">
          <span className="aiw-eyebrow !gap-2 mr-0.5">能力</span>
          {ABILITY_FILTERS.map(({ key, label, icon: Icon }) => {
            const active = activeAbilities.has(key);
            return (
              <motion.button
                key={key}
                type="button"
                whileTap={{ scale: 0.94 }}
                transition={spring.precise}
                onClick={() => toggleAbility(key)}
                className="aiw-preset inline-flex items-center gap-1 !font-sans !tracking-normal"
                data-active={active ? 'true' : 'false'}
                aria-pressed={active}
              >
                <Icon className="h-3 w-3" />
                {label}
              </motion.button>
            );
          })}
          {activeAbilities.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveAbilities(new Set())}
              className="text-micro text-[var(--ink-muted)] underline-offset-2 transition-colors duration-quick ease-aether hover:text-[var(--ink-secondary)] hover:underline"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {/* 模型列表 */}
      <div className="ai-model-list-body space-y-5">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <ModelRowSkeleton key={i} />
            ))}
          </div>
        ) : enabledFiltered.length === 0 && disabledFiltered.length === 0 ? (
          <div className="aiw-empty !py-12">
            <div className="aiw-empty-icon">
              <SearchX />
            </div>
            <div className="aiw-empty-title">
              {hasActiveFilter ? '没有命中的模型' : '暂无模型'}
            </div>
            <p className="aiw-empty-hint">
              {hasActiveFilter
                ? '试试放宽搜索词或取消能力筛选。'
                : canFetchRemote
                  ? '可以从供应商拉取模型目录，或手动添加自定义模型。'
                  : '手动添加一个自定义模型即可开始。'}
            </p>
          </div>
        ) : (
          <>
            {/* 已启用 */}
            {enabledFiltered.length > 0 && (
              <div className="space-y-2">
                <div className="aiw-group-label">
                  已启用 <b>{enabledFiltered.length}</b>
                </div>
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
                <div className="aiw-group-label">
                  未启用 <b>{disabledFiltered.length}</b>
                </div>
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
