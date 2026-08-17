// AI 配置中心主页面 (重构版)
// ref: §5.1 - AI Service 架构 · 模型中心

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BrainCircuit, RefreshCw, Plus, PanelLeft, PowerOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  IntelligenceHeader,
  IntelligenceMetric,
  IntelligenceShell,
} from '@/components/intelligence';
import type { AiProvider } from '@/services/aiProviderService';
import {
  useProviders,
  useToggleProvider,
  useBatchToggleProviders,
  groupProvidersByStatus
} from './hooks/useProviders';
import {
  ProviderSidebar,
  ProviderCard,
  ProviderGrid,
  EmptyProviderState,
  ProviderDetail,
  ProviderDialog,
  SortDialog,
} from './components';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

type ViewMode = 'grid' | 'detail';

export default function AiConfigPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  // 状态
  const [selectedProviderCode, setSelectedProviderCode] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showProviderDialog, setShowProviderDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AiProvider | null>(null);
  const [showSortDialog, setShowSortDialog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<"config" | "models">("config");
  const [showBatchDisableConfirm, setShowBatchDisableConfirm] = useState(false);
  const [initialModelSearch, setInitialModelSearch] = useState('');

  // 数据
  const { data: providers = [], isLoading } = useProviders();
  const toggleMutation = useToggleProvider();
  const batchToggleMutation = useBatchToggleProviders();

  // 分组供应商
  const { enabled, disabled } = useMemo(
    () => groupProvidersByStatus(providers),
    [providers]
  );

  // 选中的供应商
  const normalizedSelectedCode = selectedProviderCode?.toLowerCase() ?? null;
  const selectedProvider = useMemo(
    () =>
      normalizedSelectedCode
        ? providers.find((p) => p.code.toLowerCase() === normalizedSelectedCode)
        : null,
    [providers, normalizedSelectedCode]
  );

  // 来自 ?provider=...&model=... 的深链应在 providers 加载完成后只应用一次。
  // 此前该 effect 会在每次 query refetch 时重跑，导致 initialModelSearch 被
  // 重复重置回 URL 值——切换供应商或 tab 时会重新应用已过期的过滤，使
  // 模型 tab 显示为空白。
  const deepLinkAppliedRef = useRef(false);
  useEffect(() => {
    if (deepLinkAppliedRef.current) return;
    if (providers.length === 0) return;
    const provider = searchParams.get('provider');
    const model = searchParams.get('model');
    if (provider && providers.some((item) => item.code.toLowerCase() === provider.toLowerCase())) {
      setSelectedProviderCode(provider);
      setViewMode('detail');
      setActiveDetailTab('models');
      if (model) {
        setInitialModelSearch(model);
      }
    }
    deepLinkAppliedRef.current = true;
  }, [providers, searchParams]);

  // 进入详情视图
  const handleSelectProvider = useCallback((code: string | null | undefined) => {
    // 保留用户当前的 config/models tab 选择 —— 在 A 的"模型"tab 切到 B,
    // 用户的意图是"去看 B 的模型",硬重置回"配置"是反直觉的。
    setInitialModelSearch(''); // 切换供应商时清空 deep-link 过滤，避免模型列表空白
    if (!code) {
      setSelectedProviderCode(null);
      setViewMode('grid');
    } else {
      setSelectedProviderCode(code);
      setViewMode('detail');
    }
  }, []);

  // 返回网格视图
  const handleBackToGrid = useCallback(() => {
    setViewMode('grid');
    setSelectedProviderCode(null);
    setActiveDetailTab("config");
    setInitialModelSearch('');
  }, []);

  // 刷新数据
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ai-providers'] });
    queryClient.invalidateQueries({ queryKey: ['ai-models'] });
    queryClient.invalidateQueries({ queryKey: ['ai-credentials'] });
  };

  // 切换供应商启用状态
  const handleToggleProvider = (id: number, enabled: boolean) => {
    toggleMutation.mutate({ id, enabled });
  };

  // 批量禁用所有供应商
  const handleBatchDisable = () => {
    if (enabled.length === 0) return;
    setShowBatchDisableConfirm(true);
  };

  const handleBatchDisableConfirm = () => {
    batchToggleMutation.mutate({
      ids: enabled.map((p) => p.id),
      enabled: false,
    });
    setShowBatchDisableConfirm(false);
  };

  return (
    <IntelligenceShell mode="workspace" className="ai-config-page" contentClassName="ai-config-shell-content">
      <div className="intelligence-workspace-frame ai-config-workspace-frame h-full min-h-0 flex overflow-hidden relative">
        {/* 左侧供应商列表 */}
        <ProviderSidebar
          className="ai-config-sidebar hidden lg:flex"
          providers={providers}
          selectedCode={selectedProviderCode}
          onSelect={handleSelectProvider}
          onAddProvider={() => {
            setEditingProvider(null);
            setShowProviderDialog(true);
          }}
          onOpenSort={() => setShowSortDialog(true)}
          isLoading={isLoading}
        />

        {/* 右侧内容区 */}
        <div className="ai-config-content flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {/* 移动端顶部栏 */}
          <div className="intelligence-workspace-bar ai-config-mobile-bar flex items-center justify-between px-4 py-3 lg:hidden">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(true)}
                className="intelligence-action-button h-10 w-10 p-0"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="text-sm font-semibold text-[var(--ink-primary)]">
                  {viewMode === 'detail' && selectedProvider
                    ? selectedProvider.display_name || selectedProvider.name
                    : 'AI 配置中心'}
                </div>
                <div className="text-xs text-[var(--ink-muted)]">
                  {viewMode === 'detail' ? '供应商详情' : '服务商与模型配置'}
                </div>
              </div>
            </div>
            {viewMode === 'grid' && (
              <div className="flex items-center gap-2">
                <motion.button
                  onClick={handleRefresh}
                  whileTap={{ scale: 0.9 }}
                  className="intelligence-action-button h-10 w-10 p-0"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </motion.button>
                <motion.button
                  onClick={() => {
                    setEditingProvider(null);
                    setShowProviderDialog(true);
                  }}
                  whileTap={{ scale: 0.9 }}
                  className="intelligence-action-button intelligence-action-button-primary h-10 px-4 text-xs"
                >
                  添加
                </motion.button>
              </div>
            )}
          </div>

          {/* 头部 (仅网格视图) */}
          {viewMode === 'grid' && (
            <div className="intelligence-workspace-bar ai-config-topbar hidden flex-col gap-4 p-5 lg:flex">
              <IntelligenceHeader
                title="AI 配置中心"
                eyebrow="INTELLIGENCE · PROVIDERS"
                description="管理 AI 服务商、模型和凭证配置。"
                icon={BrainCircuit}
                currentLabel={`${enabled.length} 个已启用`}
                activeSummary={`服务商 ${providers.length} · 未启用 ${disabled.length}`}
                className="border-0 bg-transparent p-0 shadow-none"
                actions={
                  <div className="flex items-center gap-3">
                    {enabled.length > 0 && (
                      <motion.button
                        onClick={handleBatchDisable}
                        disabled={batchToggleMutation.isPending}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        className="intelligence-action-button !text-[var(--signal-danger)]"
                      >
                        <PowerOff className={`w-4 h-4 ${batchToggleMutation.isPending ? 'animate-pulse' : ''}`} />
                        全部禁用
                      </motion.button>
                    )}
                    <motion.button
                      onClick={handleRefresh}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      className="intelligence-action-button group"
                    >
                      <motion.div
                        animate={isLoading ? { rotate: 360 } : { rotate: 0 }}
                        transition={{ duration: 0.5, repeat: isLoading ? Infinity : 0, ease: "linear" }}
                        className="group-active:rotate-45 transition-transform"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </motion.div>
                      刷新
                    </motion.button>
                    <motion.button
                      onClick={() => {
                        setEditingProvider(null);
                        setShowProviderDialog(true);
                      }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="intelligence-action-button intelligence-action-button-primary"
                    >
                      <Plus className="w-4 h-4" />
                      添加供应商
                    </motion.button>
                  </div>
                }
              />
              <div className="ai-config-summary-grid grid grid-cols-3 gap-3">
                <IntelligenceMetric
                  label="服务商总数"
                  value={providers.length}
                  icon={BrainCircuit}
                  detail="服务商、凭证与模型入口"
                />
                <IntelligenceMetric
                  label="已启用"
                  value={enabled.length}
                  icon={RefreshCw}
                  tone="success"
                  detail="当前可参与模型路由"
                />
                <IntelligenceMetric
                  label="未启用"
                  value={disabled.length}
                  icon={PowerOff}
                  tone="warning"
                  detail="保留配置但不参与调用"
                />
              </div>
            </div>
          )}

          {/* 主内容 */}
          <div className="ai-config-main-scroll flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[var(--border-subtle)] scrollbar-track-transparent">
            {/* mode="wait" 确保"离开的 provider → 进入的 provider"顺序执行；
                 旧的 popLayout 会把 exit 节点设成 position:absolute，ProviderDetail
                 的根 h-full 在 overflow-hidden 滚动容器里坍缩成 0，表现为切到
                 另一个 provider 后内容区一片空白。 */}
            <AnimatePresence mode="wait" initial={false}>
              {viewMode === 'grid' ? (
                <motion.div
                  key="grid"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="ai-config-grid-view p-4 sm:p-5 lg:p-6 space-y-6"
                >
                  {isLoading ? (
                    <div className="ai-provider-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div
                          key={i}
                          className="ai-provider-card rounded-2xl border p-5"
                          aria-hidden="true"
                        >
                          <div className="flex items-center gap-4">
                            <div className="global-pricing-skeleton-block h-12 w-12 rounded-xl" />
                            <div className="space-y-2">
                              <div className="global-pricing-skeleton-block h-3.5 w-24 rounded" />
                              <div className="global-pricing-skeleton-block h-2.5 w-16 rounded" />
                            </div>
                          </div>
                          <div className="global-pricing-skeleton-block mt-5 h-3 w-full rounded" />
                          <div className="global-pricing-skeleton-block mt-2 h-3 w-2/3 rounded" />
                        </div>
                      ))}
                    </div>
                  ) : providers.length === 0 ? (
                    <EmptyProviderState
                      onAdd={() => {
                        setEditingProvider(null);
                        setShowProviderDialog(true);
                      }}
                    />
                  ) : (
                    <>
                      {/* 已启用 */}
                      {enabled.length > 0 && (
                        <ProviderGrid title="已启用服务商" count={enabled.length} tone="primary" className="ai-provider-grid-section">
                          {enabled.map((provider) => (
                            <ProviderCard
                              key={provider.id}
                              provider={provider}
                              onClick={() => handleSelectProvider(provider.code)}
                              onToggle={(en) => handleToggleProvider(provider.id, en)}
                              isToggling={toggleMutation.isPending}
                            />
                          ))}
                        </ProviderGrid>
                      )}

                      {/* 未启用 */}
                      {disabled.length > 0 && (
                        <ProviderGrid title="未启用服务商" count={disabled.length} tone="secondary" className="ai-provider-grid-section">
                          {disabled.map((provider) => (
                            <ProviderCard
                              key={provider.id}
                              provider={provider}
                              onClick={() => handleSelectProvider(provider.code)}
                              onToggle={(en) => handleToggleProvider(provider.id, en)}
                              isToggling={toggleMutation.isPending}
                            />
                          ))}
                        </ProviderGrid>
                      )}
                    </>
                  )}
                </motion.div>
              ) : selectedProvider ? (
                <ProviderDetail
                  key={selectedProvider.code}
                  activeTab={activeDetailTab}
                  onActiveTabChange={setActiveDetailTab}
                  initialModelSearch={initialModelSearch}
                  provider={selectedProvider}
                  onBack={handleBackToGrid}
                  onEdit={() => {
                    setEditingProvider(selectedProvider);
                    setShowProviderDialog(true);
                  }}
                />
              ) : (
                <motion.div
                  key="detail-empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center h-[60vh] text-center text-[var(--ink-muted)] gap-3"
                >
                  <div className="text-lg font-medium text-[var(--ink-secondary)]">未找到该服务商</div>
                  <div className="text-sm">请在左侧重新选择，或返回列表查看</div>
                  <button onClick={handleBackToGrid} className="aiw-button">
                    返回列表
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <ProviderSidebar
            variant="drawer"
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            providers={providers}
            selectedCode={selectedProviderCode}
            onSelect={(code) => {
              handleSelectProvider(code);
              setSidebarOpen(false);
            }}
            onAddProvider={() => {
              setEditingProvider(null);
              setShowProviderDialog(true);
              setSidebarOpen(false);
            }}
            onOpenSort={() => {
              setShowSortDialog(true);
              setSidebarOpen(false);
            }}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* 供应商配置弹窗 */}
      <AnimatePresence>
        {showProviderDialog && (
          <ProviderDialog
            mode={editingProvider ? 'edit' : 'create'}
            initial={editingProvider}
            onClose={() => {
              setShowProviderDialog(false);
              setEditingProvider(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* 排序弹窗 */}
      <AnimatePresence>
        {showSortDialog && (
          <SortDialog
            providers={providers}
            onClose={() => setShowSortDialog(false)}
          />
        )}
      </AnimatePresence>

      {/* 批量操作确认弹窗 */}
      <ConfirmDialog
        isOpen={showBatchDisableConfirm}
        title="确认全部禁用？"
        message={`确定要禁用所有 ${enabled.length} 个已启用的供应商吗？此操作将立即影响相关模型的可用性。`}
        confirmText="全部禁用"
        cancelText="取消"
        variant="danger"
        onConfirm={handleBatchDisableConfirm}
        onCancel={() => setShowBatchDisableConfirm(false)}
      />
    </IntelligenceShell>
  );
}
