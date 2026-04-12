import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Database,
  Shield,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Save,
  Zap,
  RotateCcw,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  searchConfigService,
  type SearchConfig,
  type IndexStats,
} from '@/services/searchConfigService';
import { aiProviderService, type AiModel } from '@/services/aiProviderService';

// --- Toggle switch (matches SettingsPage pattern) ---
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        checked ? 'bg-primary' : 'bg-[var(--bg-input)]'
      )}
    >
      <motion.span
        animate={{ x: checked ? 20 : 2 }}
        className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm"
      />
    </button>
  );
}

// --- Skeleton loaders ---
function StatSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] animate-pulse">
      <div className="h-3 w-16 bg-[var(--bg-card-hover)] rounded" />
      <div className="h-7 w-12 bg-[var(--bg-card-hover)] rounded" />
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-6 space-y-4 animate-pulse">
      <div className="h-5 w-32 bg-[var(--bg-card-hover)] rounded" />
      <div className="space-y-3">
        <div className="h-4 w-full bg-[var(--bg-card-hover)] rounded" />
        <div className="h-4 w-3/4 bg-[var(--bg-card-hover)] rounded" />
      </div>
    </div>
  );
}

// --- Stat card ---
function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-1 p-4 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)]">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className={cn('text-2xl font-bold', color || 'text-[var(--text-primary)]')}>
        {value}
      </span>
    </div>
  );
}

// --- Main page ---
export default function SearchConfigPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // --- Data fetching ---
  const {
    data: configRes,
    isLoading: configLoading,
  } = useQuery({
    queryKey: ['search-config'],
    queryFn: () => searchConfigService.getConfig(),
  });

  const {
    data: statsRes,
    isLoading: statsLoading,
  } = useQuery({
    queryKey: ['search-stats'],
    queryFn: () => searchConfigService.getStats(),
  });

  // Fetch all embedding models across all providers
  const embeddingModelsQuery = useQuery({
    queryKey: ['embedding-models'],
    queryFn: () => aiProviderService.listModels(undefined, 'embedding'),
    select: (res) => (res.data || []).filter((m: AiModel) => m.is_enabled),
  });

  // Fetch current embedding routing
  const embeddingRoutingQuery = useQuery({
    queryKey: ['embedding-routing'],
    queryFn: () => aiProviderService.getRouting('embedding'),
    select: (res) => res.data,
  });

  // Mutation to update embedding routing
  const updateRoutingMutation = useMutation({
    mutationFn: (modelId: number | null) =>
      aiProviderService.updateRouting('embedding', { primary_model_id: modelId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embedding-routing'] });
      toast.success('向量化模型已更新');
    },
    onError: () => toast.error('更新失败'),
  });

  const embeddingLoading = embeddingModelsQuery.isLoading || embeddingRoutingQuery.isLoading;
  const embeddingModels = embeddingModelsQuery.data || [];
  const currentRouting = embeddingRoutingQuery.data;
  const currentEmbeddingModelId = currentRouting?.primary_model?.id ?? null;

  const config = configRes?.data;
  const stats = statsRes?.data;

  // --- Local form state ---
  const [formData, setFormData] = useState<Partial<SearchConfig>>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (config) {
      setFormData({
        keywordEnabled: config.keywordEnabled,
        semanticEnabled: config.semanticEnabled,
        aiQaEnabled: config.aiQaEnabled,
        anonSearchRatePerMin: config.anonSearchRatePerMin,
        anonQaRatePerMin: config.anonQaRatePerMin,
        autoIndexOnPublish: config.autoIndexOnPublish,
      });
      setHasChanges(false);
    }
  }, [config]);

  const updateField = useCallback(
    <K extends keyof SearchConfig>(key: K, value: SearchConfig[K]) => {
      setFormData((prev) => ({ ...prev, [key]: value }));
      setHasChanges(true);
    },
    []
  );

  // --- Mutations ---
  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      searchConfigService.updateConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['search-config'] });
      setHasChanges(false);
      toast.success('配置已保存');
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '未知错误';
      toast.error(`保存失败: ${msg}`);
    },
  });

  const reindexMutation = useMutation({
    mutationFn: () => searchConfigService.reindex(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['search-stats'] });
      toast.success('全量重建索引已启动');
    },
    onError: () => {
      toast.error('重建索引失败');
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => searchConfigService.retryFailed(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['search-stats'] });
      toast.success('重试失败任务已启动');
    },
    onError: () => {
      toast.error('重试失败');
    },
  });

  const handleSave = () => {
    // Map camelCase form keys to search.* database keys
    const fieldToSettingKey: Record<string, string> = {
      keywordEnabled: 'search.keyword_enabled',
      semanticEnabled: 'search.semantic_enabled',
      aiQaEnabled: 'search.ai_qa_enabled',
      anonSearchRatePerMin: 'search.anon_search_rate_per_min',
      anonQaRatePerMin: 'search.anon_qa_rate_per_min',
      autoIndexOnPublish: 'search.auto_index_on_publish',
    };

    const payload: Record<string, string> = {};
    for (const [key, value] of Object.entries(formData)) {
      const settingKey = fieldToSettingKey[key];
      if (settingKey) {
        // Boolean values as "true"/"false" strings, numbers as string numbers
        payload[settingKey] = String(value);
      }
    }
    saveMutation.mutate(payload);
  };

  const handleReset = () => {
    if (config) {
      setFormData({
        keywordEnabled: config.keywordEnabled,
        semanticEnabled: config.semanticEnabled,
        aiQaEnabled: config.aiQaEnabled,
        anonSearchRatePerMin: config.anonSearchRatePerMin,
        anonQaRatePerMin: config.anonQaRatePerMin,
        autoIndexOnPublish: config.autoIndexOnPublish,
      });
      setHasChanges(false);
      toast.success('已重置更改');
    }
  };

  // Derived state
  const embeddingConfigured = !!currentRouting?.primary_model;
  const semanticEnabled = formData.semanticEnabled ?? false;

  // --- Full page skeleton ---
  if (configLoading && statsLoading && embeddingLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-7 w-40 bg-[var(--bg-card-hover)] rounded animate-pulse" />
            <div className="h-4 w-56 bg-[var(--bg-card-hover)] rounded mt-2 animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            搜索配置
          </h1>
          <p className="text-[var(--text-muted)] mt-1">
            管理搜索功能、向量索引与访问限流
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AnimatePresence>
            {hasChanges && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex items-center gap-2"
              >
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-colors text-sm"
                >
                  <RefreshCw className="w-4 h-4" /> 重置
                </button>
                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors text-sm shadow-lg shadow-primary/20"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  保存更改
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: 向量化状态 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0 }}
          className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-6 space-y-5 lg:col-span-2"
        >
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-[var(--text-muted)]" />
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              向量化状态
            </h2>
          </div>

          {/* Embedding model selector */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-[var(--text-secondary)] shrink-0">
                向量化模型
              </label>
              {embeddingLoading ? (
                <div className="h-9 flex-1 max-w-xs bg-[var(--bg-card-hover)] rounded-lg animate-pulse" />
              ) : embeddingModels.length > 0 ? (
                <div className="relative flex-1 max-w-xs">
                  <select
                    value={currentEmbeddingModelId ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateRoutingMutation.mutate(val ? Number(val) : null);
                    }}
                    disabled={updateRoutingMutation.isPending}
                    className="w-full appearance-none px-3 py-2 pr-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] text-sm text-[var(--text-primary)] focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all disabled:opacity-50"
                  >
                    <option value="">未选择</option>
                    {embeddingModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name || m.model_id} ({m.provider_code})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span className="text-sm text-amber-400 font-medium">
                      尚未添加向量化模型
                    </span>
                  </div>
                  <button
                    onClick={() => navigate('/ai-config')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-primary hover:bg-primary/10 transition-colors"
                  >
                    前往添加
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            {/* Current model details */}
            {!embeddingLoading && currentRouting?.primary_model && (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs text-[var(--text-muted)]">
                  当前使用: {currentRouting.primary_model.display_name || currentRouting.primary_model.model_id}
                  {' '}({currentRouting.primary_model.provider_code})
                </span>
              </div>
            )}
          </div>

          {/* Index stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {statsLoading ? (
              <>
                <StatSkeleton />
                <StatSkeleton />
                <StatSkeleton />
                <StatSkeleton />
              </>
            ) : stats ? (
              <>
                <StatCard label="总文章" value={stats.total_posts} />
                <StatCard
                  label="已索引"
                  value={stats.indexed_posts}
                  color="text-emerald-400"
                />
                <StatCard
                  label="待处理"
                  value={stats.pending_posts}
                  color="text-amber-400"
                />
                <StatCard
                  label="失败"
                  value={stats.failed_posts}
                  color={stats.failed_posts > 0 ? 'text-red-400' : undefined}
                />
              </>
            ) : null}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 pt-1">
            <button
              onClick={() => reindexMutation.mutate()}
              disabled={reindexMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-colors text-sm"
            >
              {reindexMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              全量重建索引
            </button>
            <button
              onClick={() => retryMutation.mutate()}
              disabled={
                retryMutation.isPending || (stats?.failed_posts ?? 0) === 0
              }
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-colors',
                (stats?.failed_posts ?? 0) > 0
                  ? 'bg-[var(--bg-input)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                  : 'opacity-50 cursor-not-allowed bg-[var(--bg-input)] border-[var(--border-subtle)] text-[var(--text-muted)]'
              )}
            >
              {retryMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              重试失败
            </button>
          </div>
        </motion.div>

        {/* Card 2: 搜索功能开关 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-6 space-y-5"
        >
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-[var(--text-muted)]" />
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              搜索功能开关
            </h2>
          </div>

          <div className="space-y-4">
            {/* Keyword search */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--text-secondary)]">
                  关键词搜索
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  基于 PostgreSQL tsvector 的全文检索
                </p>
              </div>
              <Toggle
                checked={formData.keywordEnabled ?? false}
                onChange={(v) => updateField('keywordEnabled', v)}
              />
            </div>

            {/* Semantic search */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--text-secondary)]">
                  语义搜索
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  基于向量相似度的智能搜索
                  {!embeddingConfigured && (
                    <span className="text-amber-400 ml-1">
                      (需先配置 Embedding 模型)
                    </span>
                  )}
                </p>
              </div>
              <Toggle
                checked={formData.semanticEnabled ?? false}
                onChange={(v) => updateField('semanticEnabled', v)}
                disabled={!embeddingConfigured}
              />
            </div>

            {/* AI QA */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--text-secondary)]">
                  AI 问答
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  基于文章内容的 AI 智能回答
                  {!semanticEnabled && (
                    <span className="text-amber-400 ml-1">
                      (需先开启语义搜索)
                    </span>
                  )}
                </p>
              </div>
              <Toggle
                checked={formData.aiQaEnabled ?? false}
                onChange={(v) => updateField('aiQaEnabled', v)}
                disabled={!semanticEnabled}
              />
            </div>
          </div>
        </motion.div>

        {/* Card 3: 匿名访问控制 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-6 space-y-5"
        >
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[var(--text-muted)]" />
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              匿名访问控制
            </h2>
          </div>

          <div className="space-y-4">
            {/* Anon search rate */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                匿名搜索限流 (次/分钟)
              </label>
              <input
                type="number"
                min={0}
                value={formData.anonSearchRatePerMin ?? 0}
                onChange={(e) =>
                  updateField(
                    'anonSearchRatePerMin',
                    parseInt(e.target.value, 10) || 0
                  )
                }
                className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-[var(--text-muted)] transition-all"
              />
            </div>

            {/* Anon QA rate */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                匿名 QA 限流 (次/分钟)
              </label>
              <input
                type="number"
                min={0}
                value={formData.anonQaRatePerMin ?? 0}
                onChange={(e) =>
                  updateField(
                    'anonQaRatePerMin',
                    parseInt(e.target.value, 10) || 0
                  )
                }
                className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-[var(--text-muted)] transition-all"
              />
            </div>
          </div>
        </motion.div>

        {/* Card 4: 自动索引 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
          className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-6 space-y-5 lg:col-span-2"
        >
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-[var(--text-muted)]" />
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              自动索引
            </h2>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                发布时自动索引
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                文章发布或更新时自动创建/更新向量索引
              </p>
            </div>
            <Toggle
              checked={formData.autoIndexOnPublish ?? false}
              onChange={(v) => updateField('autoIndexOnPublish', v)}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
