// AI 配置中心主页面 (重构版)
// ref: §5.1 - AI Service 架构 (LobeChat 风格)

import { useState, useMemo, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw, Plus, PanelLeft, PowerOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
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

  // 状态
  const [selectedProviderCode, setSelectedProviderCode] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showProviderDialog, setShowProviderDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AiProvider | null>(null);
  const [showSortDialog, setShowSortDialog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<"config" | "models">("config");
  const [showBatchDisableConfirm, setShowBatchDisableConfirm] = useState(false);

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

  // 进入详情视图
  const handleSelectProvider = useCallback((code: string | null | undefined) => {
    setActiveDetailTab("config"); // 切换时重置为配置 Tab
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
    <div className="h-[calc(100vh-4rem)] min-h-0">
      <div className="h-full min-h-0 flex rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-sm overflow-hidden relative">
        {/* 左侧供应商列表 */}
        <ProviderSidebar
          className="hidden lg:flex"
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
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {/* 移动端顶部栏 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-primary)] lg:hidden">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-all"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {viewMode === 'detail' && selectedProvider
                    ? selectedProvider.display_name || selectedProvider.name
                    : 'AI 配置中心'}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {viewMode === 'detail' ? '供应商详情' : '服务商与模型配置'}
                </div>
              </div>
            </div>
            {viewMode === 'grid' && (
              <div className="flex items-center gap-2">
                <motion.button
                  onClick={handleRefresh}
                  whileTap={{ scale: 0.9 }}
                  className="p-2 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-all"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </motion.button>
                <motion.button
                  onClick={() => {
                    setEditingProvider(null);
                    setShowProviderDialog(true);
                  }}
                  whileTap={{ scale: 0.9 }}
                  className="px-3 py-1.5 rounded-lg bg-black dark:bg-white text-white dark:text-black text-xs font-bold hover:opacity-90 transition-all shadow-sm active:scale-95"
                >
                  添加
                </motion.button>
              </div>
            )}
          </div>

          {/* 头部 (仅网格视图) */}
          {viewMode === 'grid' && (
            <div className="hidden lg:flex items-center justify-between p-6 border-b border-[var(--border-default)]">
              <div>
                <h1 className="text-xl font-semibold text-[var(--text-primary)]">
                  AI 配置中心
                </h1>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  管理 AI 服务商、模型和凭证配置
                </p>
              </div>
              <div className="flex items-center gap-3">
                {enabled.length > 0 && (
                  <motion.button
                    onClick={handleBatchDisable}
                    disabled={batchToggleMutation.isPending}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <PowerOff className={`w-4 h-4 ${batchToggleMutation.isPending ? 'animate-pulse' : ''}`} />
                    全部禁用
                  </motion.button>
                )}
                <motion.button
                  onClick={handleRefresh}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-all group"
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
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-black dark:bg-white text-white dark:text-black font-bold text-sm hover:opacity-90 transition-all shadow-sm active:scale-95"
                >
                  <Plus className="w-4 h-4" />
                  添加供应商
                </motion.button>
              </div>
            </div>
          )}

          {/* 主内容 */}
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[var(--border-subtle)] scrollbar-track-transparent pr-1">
            <AnimatePresence mode="popLayout" initial={false}>
              {viewMode === 'grid' ? (
                <motion.div
                  key="grid"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="p-6 space-y-8"
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">
                      加载中...
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
                        <ProviderGrid title="已启用服务商" count={enabled.length} tone="primary">
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
                        <ProviderGrid title="未启用服务商" count={disabled.length} tone="secondary">
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
                  className="flex flex-col items-center justify-center h-[60vh] text-center text-[var(--text-muted)] gap-3"
                >
                  <div className="text-lg font-medium text-[var(--text-secondary)]">未找到该服务商</div>
                  <div className="text-sm">请在左侧重新选择，或返回列表查看</div>
                  <button
                    onClick={handleBackToGrid}
                    className="px-4 py-2 rounded-lg bg-[var(--bg-card-hover)] text-[var(--text-primary)] text-sm hover:bg-[var(--bg-card)] transition-colors"
                  >
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
    </div>
  );
}
