import { useState, useEffect, useCallback, useRef } from 'react';
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
  FileText,
  ChevronLeft,
  ChevronRight,
  Activity,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Toggle } from '@aetherblog/ui';
import {
  searchConfigService,
  type SearchConfig,
  type IndexStats,
  type EmbeddingPostItem,
} from '@/services/searchConfigService';
import { aiProviderService, type AiModel } from '@/services/aiProviderService';

// Toggle imported from @aetherblog/ui

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

// --- Status badge ---
const statusConfig: Record<string, { label: string; className: string }> = {
  INDEXED: { label: '已索引', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  PENDING: { label: '待处理', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  FAILED: { label: '失败', className: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] || { label: status, className: 'bg-gray-500/10 text-gray-400 border-gray-500/20' };
  return (
    <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium border', cfg.className)}>
      {cfg.label}
    </span>
  );
}

// --- Filter tabs ---
const filterTabs = [
  { key: '', label: '全部' },
  { key: 'PENDING', label: '待处理' },
  { key: 'INDEXED', label: '已索引' },
  { key: 'FAILED', label: '失败' },
];

// --- Indexing progress panel ---
function IndexingProgressPanel({
  stats,
  startTime,
  onDone,
}: {
  stats: IndexStats;
  startTime: number;
  onDone: () => void;
}) {
  const total = stats.total_posts;
  const done = stats.indexed_posts + stats.failed_posts;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  // Auto-dismiss when complete (pending_posts === 0)
  const prevPending = useRef(stats.pending_posts);
  useEffect(() => {
    if (prevPending.current > 0 && stats.pending_posts === 0) {
      const timer = setTimeout(() => {
        toast.success(`索引完成: 成功 ${stats.indexed_posts} 篇, 失败 ${stats.failed_posts} 篇`);
        onDone();
      }, 1500);
      return () => clearTimeout(timer);
    }
    prevPending.current = stats.pending_posts;
  }, [stats.pending_posts, stats.indexed_posts, stats.failed_posts, onDone]);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div className="rounded-xl bg-gradient-to-r from-indigo-500/5 to-purple-500/5 border border-indigo-500/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-400 animate-pulse" />
            <span className="text-sm font-medium text-[var(--text-primary)]">
              索引进行中
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Clock className="w-3 h-3" />
            {minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`}
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
              initial={{ width: 0 }}
              animate={{ width: `${percent}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>
              已处理 {done} / {total} 篇
              {stats.failed_posts > 0 && (
                <span className="text-red-400 ml-1.5">({stats.failed_posts} 失败)</span>
              )}
            </span>
            <span className="font-medium text-[var(--text-secondary)] tabular-nums">{percent}%</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// --- Main page ---
export default function SearchConfigPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // --- Indexing progress state ---
  const [indexingActive, setIndexingActive] = useState(false);
  const [indexingStartTime, setIndexingStartTime] = useState(0);

  // Force re-render every second while indexing is active (for elapsed time)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!indexingActive) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [indexingActive]);

  const stopIndexing = useCallback(() => {
    setIndexingActive(false);
    queryClient.invalidateQueries({ queryKey: ['search-stats'] });
    queryClient.invalidateQueries({ queryKey: ['search-posts'] });
  }, [queryClient]);

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
    refetchInterval: indexingActive ? 2000 : false,
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

  // Fetch all credentials so we can bind the active one to the routing.
  // 必须显式把 credential_id 存进 ai_task_routing，否则 ai-service 在内部服务
  // 无登录态调用时会走 fallback → env openai，用上虚空捏造的 api.openai.com。
  const credentialsQuery = useQuery({
    queryKey: ['ai-credentials'],
    queryFn: () => aiProviderService.listCredentials(),
    select: (res) => (res.data || []).filter((c) => c.is_enabled),
  });

  // Mutation to update embedding routing
  const updateRoutingMutation = useMutation({
    mutationFn: (modelId: number | null) => {
      // 根据所选模型自动解析对应的 credential_id：
      //   1. 优先匹配同 provider 的 is_default=true 凭证
      //   2. 否则取同 provider 的第一条启用凭证
      // 这样一次保存既写入 primary_model_id 又写入 credential_id，路由完整。
      let credentialId: number | null = null;
      if (modelId != null) {
        const model = (embeddingModelsQuery.data || []).find((m) => m.id === modelId);
        const providerCode = model?.provider_code;
        const creds = credentialsQuery.data || [];
        if (providerCode) {
          const match =
            creds.find((c) => c.provider_code === providerCode && c.is_default) ||
            creds.find((c) => c.provider_code === providerCode);
          credentialId = match?.id ?? null;
        }
      }
      return aiProviderService.updateRouting('embedding', {
        primary_model_id: modelId,
        credential_id: credentialId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embedding-routing'] });
      toast.success('向量化模型已更新');
    },
    onError: () => toast.error('更新失败'),
  });

  const embeddingLoading =
    embeddingModelsQuery.isLoading || embeddingRoutingQuery.isLoading || credentialsQuery.isLoading;
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

  const startProgress = useCallback(() => {
    setIndexingActive(true);
    setIndexingStartTime(Date.now());
  }, []);

  const reindexMutation = useMutation({
    mutationFn: () => searchConfigService.reindex(),
    onSuccess: () => {
      startProgress();
      toast.success('全量重建索引已在后台启动');
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '';
      if (/未配置/.test(msg)) {
        toast.error('AI 服务未配置，请前往设置页面配置 AI 服务');
      } else {
        toast.error(`重建索引失败: ${msg || '请检查 AI 服务是否正常运行'}`);
      }
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => searchConfigService.retryFailed(),
    onSuccess: () => {
      startProgress();
      toast.success('重试失败任务已在后台启动');
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '';
      if (/未配置/.test(msg)) {
        toast.error('AI 服务未配置，请前往设置页面配置 AI 服务');
      } else {
        toast.error(`重试失败: ${msg || '请检查 AI 服务是否正常运行'}`);
      }
    },
  });

  // --- Post list state ---
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rebuildingPostId, setRebuildingPostId] = useState<number | null>(null);
  const pageSize = 10;

  const postsQuery = useQuery({
    queryKey: ['search-posts', statusFilter, page],
    queryFn: () =>
      searchConfigService.listPosts({
        embeddingStatus: statusFilter || undefined,
        limit: pageSize,
        offset: page * pageSize,
      }),
    refetchInterval: indexingActive ? 5000 : false,
  });
  const posts = postsQuery.data?.data?.items ?? [];
  const postsTotal = postsQuery.data?.data?.total ?? 0;
  const totalPages = Math.ceil(postsTotal / pageSize);

  const indexBatchMutation = useMutation({
    mutationFn: (postIds: number[]) => searchConfigService.indexBatch(postIds),
    onSuccess: (res) => {
      const d = res?.data;
      // 新的异步响应：后端立即返回 {status:"started", accepted:N}，实际索引在后台进行
      if (d?.status === 'started') {
        startProgress();
        toast.success(
          d.accepted ? `已启动后台索引 ${d.accepted} 篇，进度请看上方面板` : '索引任务已在后台启动'
        );
      } else if (d && typeof d.indexed === 'number' && typeof d.failed === 'number') {
        // 兼容旧版同步响应（老 backend 未升级时）
        const msg = `索引完成: 成功 ${d.indexed} 篇, 失败 ${d.failed} 篇`;
        if (d.failed > 0 && d.indexed === 0) {
          toast.error(d.reason || msg);
        } else if (d.failed > 0) {
          toast.warning(msg);
        } else {
          toast.success(msg);
        }
      } else {
        toast.success('索引任务已提交');
      }
      setRebuildingPostId(null);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['search-posts'] });
      queryClient.invalidateQueries({ queryKey: ['search-stats'] });
    },
    onError: (err: unknown) => {
      setRebuildingPostId(null);
      const msg = (err as { message?: string })?.message || '';
      if (/未配置/.test(msg)) {
        toast.error('AI 服务未配置，请前往设置页面配置 AI 服务');
      } else if (/进行中/.test(msg)) {
        toast.warning(msg);
      } else if (/不可用|超时/.test(msg)) {
        toast.error(`AI 服务连接失败: ${msg}`);
      } else {
        toast.error(`索引失败: ${msg || '请检查 AI 服务是否正常运行'}`);
      }
    },
  });

  const handleSingleRebuild = useCallback((postId: number) => {
    setRebuildingPostId(postId);
    indexBatchMutation.mutate([postId]);
  }, [indexBatchMutation]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (posts.length > 0 && posts.every((p: EmbeddingPostItem) => selected.has(p.id))) {
      setSelected((prev) => {
        const next = new Set(prev);
        posts.forEach((p: EmbeddingPostItem) => next.delete(p.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        posts.forEach((p: EmbeddingPostItem) => next.add(p.id));
        return next;
      });
    }
  };

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
              disabled={reindexMutation.isPending || indexingActive}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {reindexMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {indexingActive ? '索引进行中...' : '全量重建索引'}
            </button>
            <button
              onClick={() => retryMutation.mutate()}
              disabled={
                retryMutation.isPending || indexingActive || (stats?.failed_posts ?? 0) === 0
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

          {/* Indexing progress panel */}
          <AnimatePresence>
            {indexingActive && stats && (
              <IndexingProgressPanel
                stats={stats}
                startTime={indexingStartTime}
                onDone={stopIndexing}
              />
            )}
          </AnimatePresence>

          {/* Post list with per-article indexing */}
          <div className="border-t border-[var(--border-subtle)] pt-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--text-muted)]" />
                <span className="text-sm font-bold text-[var(--text-primary)]">文章索引列表</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Filter tabs */}
                <div className="flex rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                  {filterTabs.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => { setStatusFilter(tab.key); setPage(0); setSelected(new Set()); }}
                      className={cn(
                        'px-3 py-1.5 text-xs font-medium transition-colors',
                        statusFilter === tab.key
                          ? 'bg-primary text-white'
                          : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                {/* Batch reindex */}
                {selected.size > 0 && (
                  <button
                    onClick={() => indexBatchMutation.mutate(Array.from(selected))}
                    disabled={indexBatchMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors"
                  >
                    {indexBatchMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    重建选中 ({selected.size})
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="rounded-lg border border-[var(--border-subtle)] overflow-x-auto">
              <table className="w-full text-sm min-w-[480px] sm:min-w-0">
                <thead>
                  <tr className="bg-[var(--bg-input)]">
                    <th className="w-10 px-3 py-2.5 text-left">
                      <input
                        type="checkbox"
                        checked={posts.length > 0 && posts.every((p: EmbeddingPostItem) => selected.has(p.id))}
                        onChange={toggleSelectAll}
                        className="rounded border-[var(--border-subtle)]"
                      />
                    </th>
                    <th className="w-16 px-2 py-2.5 text-left font-medium text-[var(--text-muted)] sm:hidden">操作</th>
                    <th className="px-3 py-2.5 text-left font-medium text-[var(--text-muted)]">文章</th>
                    <th className="px-3 py-2.5 text-left font-medium text-[var(--text-muted)] hidden sm:table-cell">状态</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[var(--text-muted)] hidden sm:table-cell">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {postsQuery.isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-t border-[var(--border-subtle)]">
                        <td className="px-3 py-3"><div className="w-4 h-4 bg-[var(--bg-card-hover)] rounded animate-pulse" /></td>
                        <td className="px-2 py-3 sm:hidden"><div className="h-7 w-12 bg-[var(--bg-card-hover)] rounded animate-pulse" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-48 bg-[var(--bg-card-hover)] rounded animate-pulse" /></td>
                        <td className="px-3 py-3 hidden sm:table-cell"><div className="h-5 w-14 bg-[var(--bg-card-hover)] rounded animate-pulse" /></td>
                        <td className="px-3 py-3 hidden sm:table-cell"><div className="h-7 w-12 bg-[var(--bg-card-hover)] rounded animate-pulse ml-auto" /></td>
                      </tr>
                    ))
                  ) : posts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-[var(--text-muted)] text-sm">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    posts.map((post: EmbeddingPostItem) => (
                      <tr key={post.id} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] transition-colors">
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={selected.has(post.id)}
                            onChange={() => toggleSelect(post.id)}
                            className="rounded border-[var(--border-subtle)]"
                          />
                        </td>
                        <td className="px-2 py-2.5 sm:hidden">
                          <button
                            onClick={() => handleSingleRebuild(post.id)}
                            disabled={indexBatchMutation.isPending}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-input)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] active:scale-95 transition-all"
                          >
                            <RefreshCw className={cn("w-3 h-3", rebuildingPostId === post.id && "animate-spin")} />
                            {rebuildingPostId === post.id ? '索引中' : '重建'}
                          </button>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-[var(--text-primary)] font-medium truncate max-w-xs">{post.title}</span>
                            <span className="text-xs text-[var(--text-muted)] sm:hidden mt-0.5">
                              <StatusBadge status={post.embeddingStatus} />
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <StatusBadge status={post.embeddingStatus} />
                        </td>
                        <td className="px-3 py-2.5 text-right hidden sm:table-cell">
                          <button
                            onClick={() => handleSingleRebuild(post.id)}
                            disabled={indexBatchMutation.isPending}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-input)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] active:scale-95 transition-all"
                          >
                            <RefreshCw className={cn("w-3 h-3", rebuildingPostId === post.id && "animate-spin")} />
                            {rebuildingPostId === post.id ? '索引中...' : '重建'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-[var(--text-muted)]">
                  共 {postsTotal} 篇，第 {page + 1}/{totalPages} 页
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
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
