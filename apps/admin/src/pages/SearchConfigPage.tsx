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
  Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Toggle, ConfirmModal } from '@aetherblog/ui';
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

// --- Indexing job model ---
// 进度面板必须按"本次触发的任务"精确范围展示，否则会出现"单篇重建却显示
// 0/90 全量进度条"这种误导（管理员以为卡住了）。同时要能跨页面导航持久化，
// 刷新/切换路由回来后台任务仍在跑，进度面板必须还能看到。
type IndexingJobKind = 'full' | 'retry' | 'batch' | 'single';
interface IndexingJob {
  kind: IndexingJobKind;
  startTime: number;
  /** 本任务覆盖的条目数：full=total_posts, retry=failed_posts, batch=accepted, single=1 */
  jobTotal: number;
  /** 任务启动时的已索引基线，用于计算"本次已处理" */
  baselineIndexed: number;
  /** 任务启动时的失败基线（仅 batch/single 用，统计本次失败数） */
  baselineFailed: number;
  /** 任务标题，用于面板展示 */
  label: string;
}

const INDEXING_JOB_STORAGE_KEY = 'aetherblog:search:indexing_job';

function readPersistedJob(): IndexingJob | null {
  try {
    const raw = localStorage.getItem(INDEXING_JOB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IndexingJob;
    // 超过 2 小时的任务视为过期兜底（真正的全量索引也不应超过这么久）
    if (Date.now() - parsed.startTime > 2 * 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function computeJobProgress(job: IndexingJob, stats: IndexStats) {
  // full / retry: 以"已索引增量"驱动（失败次数不计入完成度，但单独展示）
  // batch / single: 以"已索引 + 失败 增量"驱动（单篇任务里失败也是"完成"）
  const indexedDelta = Math.max(0, stats.indexed_posts - job.baselineIndexed);
  const failedDelta = Math.max(0, stats.failed_posts - job.baselineFailed);
  let done: number;
  if (job.kind === 'full' || job.kind === 'retry') {
    done = indexedDelta;
  } else {
    done = indexedDelta + failedDelta;
  }
  done = Math.min(done, job.jobTotal);
  const percent = job.jobTotal > 0 ? Math.min(100, Math.round((done / job.jobTotal) * 100)) : 0;
  return { done, failedDelta, percent };
}

// --- Indexing progress panel ---
function IndexingProgressPanel({
  job,
  stats,
  onDone,
  onStop,
  canceling,
}: {
  job: IndexingJob;
  stats: IndexStats;
  onDone: () => void;
  onStop?: () => void;
  canceling?: boolean;
}) {
  const { done, failedDelta, percent } = computeJobProgress(job, stats);
  const elapsed = Math.floor((Date.now() - job.startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  // 任务完成判断：done >= jobTotal（基于本次 delta，不再依赖全站 pending_posts）
  const prevDone = useRef(done);
  useEffect(() => {
    if (prevDone.current < job.jobTotal && done >= job.jobTotal) {
      const timer = setTimeout(() => {
        const successDelta = Math.max(0, stats.indexed_posts - job.baselineIndexed);
        toast.success(
          `${job.label} 完成: 成功 ${successDelta} 篇${failedDelta > 0 ? `, 失败 ${failedDelta} 篇` : ''}`
        );
        onDone();
      }, 1500);
      return () => clearTimeout(timer);
    }
    prevDone.current = done;
  }, [done, failedDelta, job, stats.indexed_posts, onDone]);

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
              {job.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <Clock className="w-3 h-3" />
              {minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`}
            </div>
            {onStop && (
              <button
                onClick={onStop}
                disabled={canceling}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-red-300 hover:text-red-200 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="停止当前索引任务"
              >
                {canceling ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Square className="w-3 h-3" />
                )}
                {canceling ? '停止中' : '停止'}
              </button>
            )}
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
              已处理 {done} / {job.jobTotal} 篇
              {failedDelta > 0 && (
                <span className="text-red-400 ml-1.5">({failedDelta} 失败)</span>
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
  // 以 IndexingJob 替代布尔 indexingActive：存本次任务的 kind/jobTotal/baseline，
  // 面板才能按"本次触发范围"展示进度；并写入 localStorage 以便跨导航持久化。
  const [indexingJob, setIndexingJob] = useState<IndexingJob | null>(() => readPersistedJob());
  const indexingActive = indexingJob !== null;

  useEffect(() => {
    try {
      if (indexingJob) {
        localStorage.setItem(INDEXING_JOB_STORAGE_KEY, JSON.stringify(indexingJob));
      } else {
        localStorage.removeItem(INDEXING_JOB_STORAGE_KEY);
      }
    } catch {
      // localStorage 不可用（隐私模式等）时静默降级：任务状态仅保持在内存中
    }
  }, [indexingJob]);

  // Force re-render every second while indexing is active (for elapsed time)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!indexingActive) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [indexingActive]);

  const stopIndexing = useCallback(() => {
    setIndexingJob(null);
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

  const { data: diagnosticsRes } = useQuery({
    queryKey: ['search-diagnostics'],
    queryFn: () => searchConfigService.getDiagnostics(),
    // 诊断信息是本地读，刷一次就够；但 indexing 时每 10s 复查一次好让
    // admin 看到 active_embedding_model 在翻转前后的变化
    refetchInterval: indexingActive ? 10000 : false,
  });
  const diagnostics = diagnosticsRes?.data;

  // Fetch enabled providers
  const providersQuery = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => aiProviderService.listProviders(true),
    select: (res) => new Set((res.data || []).map((p) => p.code)),
    staleTime: 30_000,
  });

  // Fetch embedding models — only from enabled providers
  const enabledProviderCodes = providersQuery.data;
  const embeddingModelsQuery = useQuery({
    queryKey: ['embedding-models', enabledProviderCodes ? Array.from(enabledProviderCodes).sort().join(',') : ''],
    queryFn: () => aiProviderService.listModels(undefined, 'embedding'),
    select: (res) => {
      return (res.data || []).filter(
        (m: AiModel) => m.is_enabled && (!enabledProviderCodes || enabledProviderCodes.has(m.provider_code))
      );
    },
    enabled: providersQuery.isSuccess,
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

  // 模型切换二次确认：V3 版本化存储下切换模型会把旧 embedding 行标记为 deprecated
  // 并全量重建，这是一次不可忽视的操作（成本 × 时间），必须让管理员显式确认。
  // pending 为 null 代表没有在切换；为 number 或 ''（清空选择）代表待确认值。
  const [pendingEmbeddingModelId, setPendingEmbeddingModelId] =
    useState<number | null | undefined>(undefined);

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
    providersQuery.isLoading || embeddingModelsQuery.isLoading || embeddingRoutingQuery.isLoading || credentialsQuery.isLoading;
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
        indexPostTimeoutSec: config.indexPostTimeoutSec,
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

  // 任务启动：记录 baseline，供 computeJobProgress 计算本次 delta
  const startJob = useCallback((kind: IndexingJobKind, jobTotal: number, label: string) => {
    setIndexingJob({
      kind,
      startTime: Date.now(),
      jobTotal: Math.max(1, jobTotal),
      baselineIndexed: stats?.indexed_posts ?? 0,
      baselineFailed: stats?.failed_posts ?? 0,
      label,
    });
  }, [stats?.indexed_posts, stats?.failed_posts]);

  const reindexMutation = useMutation({
    mutationFn: () => searchConfigService.reindex(),
    onSuccess: () => {
      startJob('full', stats?.total_posts ?? 0, '全量重建索引');
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
      startJob('retry', stats?.failed_posts ?? 0, '重试失败任务');
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

  // 任务停止：后端通过 context.CancelFunc 打断 goroutine 里挂起的 HTTP 调用，
  // 前端这边收到响应后立即清本地任务状态并刷统计；真正取消生效会有 1~2 个
  // refetchInterval 的延迟（ai-service 单篇阶段完成后才会退出），这是可接受
  // 的代价 —— 不会强杀正在向量化的那一篇，避免 post_embeddings 写半边。
  const cancelMutation = useMutation({
    mutationFn: () => searchConfigService.cancelIndexing(),
    onSuccess: (res) => {
      const d = res?.data;
      if (d?.status === 'idle') {
        toast.info('当前没有运行中的索引任务');
      } else {
        toast.success('已请求停止索引任务');
      }
      stopIndexing();
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '';
      toast.error(`停止失败: ${msg || '请检查后端服务'}`);
    },
  });

  // --- Post list state ---
  // 默认展示 PENDING（未索引），管理员进入页面最关心的就是"还有哪些没索引"
  const [statusFilter, setStatusFilter] = useState('PENDING');
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
    onSuccess: (res, postIds) => {
      const d = res?.data;
      // 新的异步响应：后端立即返回 {status:"started", accepted:N}，实际索引在后台进行
      if (d?.status === 'started') {
        const accepted = d.accepted ?? postIds.length;
        const isSingle = postIds.length === 1;
        const label = isSingle
          ? `索引文章 #${postIds[0]}`
          : `批量索引 ${accepted} 篇`;
        startJob(isSingle ? 'single' : 'batch', accepted, label);
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
      indexPostTimeoutSec: 'search.index_post_timeout_sec',
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
        indexPostTimeoutSec: config.indexPostTimeoutSec,
      });
      setHasChanges(false);
      toast.success('已重置更改');
    }
  };

  // embeddingConfigured requires both a selected model AND a resolvable credential;
  // otherwise runtime falls back to env defaults.
  const embeddingModelSelected = !!currentRouting?.primary_model;
  const embeddingCredentialReady = currentRouting?.credential_configured !== false;
  const embeddingConfigured = embeddingModelSelected && embeddingCredentialReady;
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

      {/* Diagnostics strip — 一屏诊断搜索链路状态 */}
      {diagnostics && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className={cn(
            'mb-6 rounded-xl border p-4',
            diagnostics.fallback.effectiveMode === 'disabled'
              ? 'bg-red-500/5 border-red-500/30'
              : diagnostics.fallback.effectiveMode === 'keyword' && diagnostics.config.semanticEnabled
              ? 'bg-amber-500/5 border-amber-500/30'
              : 'bg-[var(--bg-card)] border-[var(--border-subtle)]'
          )}
        >
          <div className="flex items-start gap-3">
            <Activity
              className={cn(
                'w-4 h-4 mt-0.5 shrink-0',
                diagnostics.fallback.effectiveMode === 'disabled'
                  ? 'text-red-400'
                  : diagnostics.fallback.effectiveMode === 'keyword' && diagnostics.config.semanticEnabled
                  ? 'text-amber-400'
                  : 'text-[var(--text-muted)]'
              )}
            />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="font-medium text-[var(--text-primary)]">
                  当前生效：
                  <span className="ml-1 font-mono uppercase tracking-wide">
                    {diagnostics.fallback.effectiveMode}
                  </span>
                </span>
                <span className="text-[var(--text-muted)]">
                  关键词
                  <span className={cn('ml-1 font-mono', diagnostics.fallback.keywordActive ? 'text-emerald-400' : 'text-[var(--text-muted)]')}>
                    {diagnostics.fallback.keywordActive ? 'on' : 'off'}
                  </span>
                </span>
                <span className="text-[var(--text-muted)]">
                  语义
                  <span className={cn('ml-1 font-mono', diagnostics.fallback.semanticActive ? 'text-emerald-400' : 'text-[var(--text-muted)]')}>
                    {diagnostics.fallback.semanticActive ? 'on' : 'off'}
                  </span>
                </span>
                <span className="text-[var(--text-muted)]">
                  活跃 embedding：
                  <span className="ml-1 font-mono text-[var(--text-secondary)]">
                    {diagnostics.activeEmbedding.modelId || '(未设置)'}
                  </span>
                  {diagnostics.activeEmbedding.source === 'unset' && (
                    <span className="ml-1 text-amber-400">· 需全量重建</span>
                  )}
                </span>
                <span className="text-[var(--text-muted)]">
                  AI 客户端：
                  <span className={cn('ml-1 font-mono', diagnostics.aiClient.configured ? 'text-emerald-400' : 'text-red-400')}>
                    {diagnostics.aiClient.configured ? 'configured' : 'missing'}
                  </span>
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                {diagnostics.fallback.note}
              </p>
            </div>
          </div>
        </motion.div>
      )}

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
                      const nextId = val ? Number(val) : null;
                      if (nextId === currentEmbeddingModelId) return;
                      // 不直接 mutate —— 弹 ConfirmModal，在用户明示确认后再写路由并触发 reindex
                      setPendingEmbeddingModelId(nextId);
                    }}
                    disabled={updateRoutingMutation.isPending || reindexMutation.isPending}
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
            {/* Current model details — 显示真正生效的 model_id 和 base_url，
                 避免 UI 标签和后端实际调用不一致时出现"我明明选了 large 怎么
                 还是 small"的迷惑场面。base_url 来自 provider 下匹配凭证的
                 base_url_override（与 ai-service 的 credential resolver 同一逻辑）。
                 credential_configured=false 时独立提示凭证缺失 —— 以前这种
                 情况会让整个 primary_model 在 GET 响应里消失, 前端看到的是
                 "未选择", 管理员完全不知道问题出在哪里. */}
            {!embeddingLoading && currentRouting?.primary_model && (() => {
              const m = currentRouting.primary_model!;
              const creds = credentialsQuery.data || [];
              const matched =
                creds.find((c) => c.provider_code === m.provider_code && c.is_default) ||
                creds.find((c) => c.provider_code === m.provider_code);
              const effectiveBase = matched?.base_url_override || '(provider 默认)';
              const credReady = embeddingCredentialReady;
              return (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    {credReady ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    )}
                    <span className="text-xs text-[var(--text-muted)]">
                      当前使用: <span className="text-[var(--text-secondary)] font-medium">{m.display_name || m.model_id}</span>
                      {' '}<span className="text-[var(--text-muted)]">·</span>{' '}
                      <span className="font-mono text-[var(--text-secondary)]">{m.model_id}</span>
                      {' '}({m.provider_code})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pl-5">
                    <span className="text-xs text-[var(--text-muted)] font-mono break-all">
                      api_base: {effectiveBase}
                    </span>
                  </div>
                  {!credReady && (
                    <div className="flex items-start gap-2 mt-1 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-300/90 space-y-1">
                        <div className="font-medium">
                          该模型已保存, 但 provider <span className="font-mono">{m.provider_code}</span> 下没有可用凭证
                        </div>
                        <div className="text-amber-300/70">
                          运行时的向量化 / 语义搜索会降级到 env 默认配置, 可能调用
                          错误的 API 地址或失败. 请前往 AI 配置页绑定凭证.
                        </div>
                        <button
                          onClick={() => navigate('/ai-config')}
                          className="inline-flex items-center gap-1 mt-1 text-amber-200 hover:text-amber-100 underline underline-offset-2"
                        >
                          前往配置凭证
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
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
            {indexingJob && stats && (
              <IndexingProgressPanel
                job={indexingJob}
                stats={stats}
                onDone={stopIndexing}
                onStop={() => cancelMutation.mutate()}
                canceling={cancelMutation.isPending}
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
                  {!embeddingModelSelected && (
                    <span className="text-amber-400 ml-1">
                      (需先选择 Embedding 模型)
                    </span>
                  )}
                  {embeddingModelSelected && !embeddingCredentialReady && (
                    <span className="text-amber-400 ml-1">
                      (模型已选, 但缺少可用凭证 — 见下方向量化状态提示)
                    </span>
                  )}
                </p>
              </div>
              <Toggle
                checked={formData.semanticEnabled ?? false}
                onChange={(v) => updateField('semanticEnabled', v)}
                // 仅阻止"开启": 未配置 Embedding 模型时无法打开;
                // 若已打开, 始终允许关闭 (避免模型失效后卡死无法降级)
                disabled={!formData.semanticEnabled && !embeddingConfigured}
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
                // 仅阻止"开启": 未启用语义搜索时无法打开 AI 问答;
                // 若已打开, 始终允许关闭
                disabled={!formData.aiQaEnabled && !semanticEnabled}
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

            {/* 单篇索引超时 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                单篇索引超时（秒）
              </label>
              <input
                type="number"
                min={10}
                max={600}
                value={formData.indexPostTimeoutSec ?? 180}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  updateField(
                    'indexPostTimeoutSec',
                    Number.isFinite(n) ? Math.min(600, Math.max(10, n)) : 180
                  );
                }}
                className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-[var(--text-muted)] transition-all"
              />
              <p className="text-xs text-[var(--text-muted)]">
                默认 180 秒。保存后下一批次实时生效；Go 后端与 AI service 两端同步使用该值。范围 10–600。
              </p>
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

      {/* 切换向量化模型的二次确认 —— V3 版本化存储下换模型 = 废弃旧 embedding 并
          全量重建新 embedding, 这是 O(文章数 × 每篇 embed 耗时) 的开销, 必须让
          管理员显式同意。旧行不会被立即删除, 保留作为回滚依据. */}
      <ConfirmModal
        isOpen={pendingEmbeddingModelId !== undefined}
        title="切换向量化模型"
        variant="warning"
        confirmText="切换并重建索引"
        cancelText="取消"
        message={(() => {
          const nextModel =
            pendingEmbeddingModelId != null
              ? embeddingModels.find((m) => m.id === pendingEmbeddingModelId)
              : null;
          const nextLabel = nextModel
            ? `${nextModel.display_name || nextModel.model_id} (${nextModel.provider_code})`
            : '未选择';
          const totalPosts = stats?.total_posts ?? 0;
          const approxSec = Math.max(1, Math.round(totalPosts * 1.2));
          return [
            `目标模型：${nextLabel}`,
            `影响范围：${totalPosts} 篇文章将重新生成向量（预计耗时约 ${approxSec}s）`,
            '旧模型的向量会被标记为 deprecated（而非立即删除），保留以便回滚。',
            '确认后将自动启动全量重建任务。',
          ].join('\n');
        })()}
        onConfirm={async () => {
          const target = pendingEmbeddingModelId ?? null;
          try {
            await updateRoutingMutation.mutateAsync(target);
            reindexMutation.mutate();
          } finally {
            setPendingEmbeddingModelId(undefined);
          }
        }}
        onCancel={() => setPendingEmbeddingModelId(undefined)}
      />
    </div>
  );
}
