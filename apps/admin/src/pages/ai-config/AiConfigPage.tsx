// AI 配置中心主页面 (重构版)
// ref: §5.1 - AI Service 架构 (LobeChat 风格)

import { useState, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw, Plus, PanelLeft } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { AiProvider } from '@/services/aiProviderService';
import { useProviders, useToggleProvider, groupProvidersByStatus } from './hooks/useProviders';
import {
  ProviderSidebar,
  ProviderCard,
  ProviderGrid,
  EmptyProviderState,
  ProviderDetail,
  ProviderDialog,
  SortDialog,
} from './components';

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

  // 数据
  const { data: providers = [], isLoading } = useProviders();
  const toggleMutation = useToggleProvider();

  // 分组供应商
  const { enabled, disabled } = useMemo(
    () => groupProvidersByStatus(providers),
    [providers]
  );

  // 选中的供应商
  const selectedProvider = useMemo(
    () => providers.find((p) => p.code === selectedProviderCode),
    [providers, selectedProviderCode]
  );

  // 进入详情视图
  const handleSelectProvider = (code: string | null) => {
    if (code === null) {
      setSelectedProviderCode(null);
      setViewMode('grid');
    } else {
      setSelectedProviderCode(code);
      setViewMode('detail');
    }
  };

  // 返回网格视图
  const handleBackToGrid = () => {
    setViewMode('grid');
    setSelectedProviderCode(null);
  };

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

  return (
    <div className="h-[calc(100vh-4rem)] flex bg-[var(--bg-primary)]">
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

      {/* 右侧内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
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
              <button
                onClick={handleRefresh}
                className="p-2 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-all"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setEditingProvider(null);
                  setShowProviderDialog(true);
                }}
                className="px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                添加
              </button>
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
              <button
                onClick={handleRefresh}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                刷新
              </button>
              <button
                onClick={() => {
                  setEditingProvider(null);
                  setShowProviderDialog(true);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white font-medium text-sm hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加供应商
              </button>
            </div>
          </div>
        )}

        {/* 主内容 */}
        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
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
            ) : (
              selectedProvider && (
                <ProviderDetail
                  key={selectedProvider.id}
                  provider={selectedProvider}
                  onBack={handleBackToGrid}
                  onEdit={() => {
                    setEditingProvider(selectedProvider);
                    setShowProviderDialog(true);
                  }}
                />
              )
            )}
          </AnimatePresence>
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
    </div>
  );
}
