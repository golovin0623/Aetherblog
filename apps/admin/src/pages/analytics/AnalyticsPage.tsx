import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Cpu,
  DollarSign,
  Clock,
  Loader2,
  Repeat2,
  CheckCircle2,
} from 'lucide-react';
import {
  AiModelDistributionChart,
  AiTaskDistributionChart,
  AiUsageTrendChart,
  AiUsageRecordsTable,
} from '../dashboard/components';
import {
  IntelligenceHeader,
  IntelligenceMetric,
  IntelligenceSegmented,
  IntelligenceShell,
  IntelligenceStatusStrip,
} from '@/components/intelligence';
import {
  analyticsService,
  type AiDashboardData,
  type AiCallRecord,
  type AiPricingGap,
} from '@/services/analyticsService';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { getAiResponseRateSummary } from '@/lib/aiMetrics';

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 200];

interface AnalyticsFetchSnapshot {
  days: 7 | 30 | 90;
  page: number;
  pageSize: number;
  taskType: string;
  modelId: string;
  successFilter: 'all' | 'success' | 'failed';
  keyword: string;
  refreshNonce: number;
}

const EMPTY_DATA: AiDashboardData = {
  rangeDays: 30,
  overview: {
    totalCalls: 0,
    successCalls: 0,
    errorCalls: 0,
    successRate: 0,
    cacheHitRate: 0,
    totalTokens: 0,
    totalCost: 0,
    avgTokensPerCall: 0,
    avgCostPerCall: 0,
    avgLatencyMs: 0,
  },
  trend: [],
  modelDistribution: [],
  taskDistribution: [],
  records: {
    list: [],
    pageNum: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    pages: 0,
  },
};

function uniqueBy<T>(items: T[], mapper: (item: T) => string): string[] {
  return Array.from(new Set(items.map(mapper).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function AnalyticsPage() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [taskType, setTaskType] = useState('');
  const [modelId, setModelId] = useState('');
  const [successFilter, setSuccessFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [recordsRefreshing, setRecordsRefreshing] = useState(false);
  const [hasLoadedDashboard, setHasLoadedDashboard] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [data, setData] = useState<AiDashboardData>(EMPTY_DATA);
  const [pricingGaps, setPricingGaps] = useState<AiPricingGap[]>([]);
  const latestFetchIdRef = useRef(0);
  const latestDashboardFetchIdRef = useRef(0);
  const latestRecordsFetchIdRef = useRef(0);
  const mountedRef = useRef(true);
  const lastFetchSnapshotRef = useRef<AnalyticsFetchSnapshot | null>(null);
  // refreshNonce 让「归档后强制刷新」也走 useEffect 统一通道：
  // React 会把 setPage(1) + setRefreshNonce 批成一次渲染,effect 只触发一次,
  // 避免以前"setPage(1) 触发一次 + 手动 fetch 一次"的重复请求/竞态。
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextKeyword = keywordInput.trim();
      setKeyword((current) => {
        if (current === nextKeyword) return current;
        setPage(1);
        return nextKeyword;
      });
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [keywordInput]);

  useEffect(() => {
    const keywordValue = keyword;
    const snapshot: AnalyticsFetchSnapshot = {
      days,
      page,
      pageSize,
      taskType,
      modelId,
      successFilter,
      keyword: keywordValue,
      refreshNonce,
    };
    const previousSnapshot = lastFetchSnapshotRef.current;
    const isPaginationOnlyRefresh = Boolean(
      previousSnapshot &&
      previousSnapshot.days === snapshot.days &&
      previousSnapshot.taskType === snapshot.taskType &&
      previousSnapshot.modelId === snapshot.modelId &&
      previousSnapshot.successFilter === snapshot.successFilter &&
      previousSnapshot.keyword === snapshot.keyword &&
      previousSnapshot.refreshNonce === snapshot.refreshNonce &&
      (
        previousSnapshot.page !== snapshot.page ||
        previousSnapshot.pageSize !== snapshot.pageSize
      )
    );

    lastFetchSnapshotRef.current = snapshot;
    latestFetchIdRef.current += 1;
    const fetchId = latestFetchIdRef.current;
    let cancelled = false;

    const isLatestFetch = () => !cancelled && latestFetchIdRef.current === fetchId;

    const fetchData = async () => {
      let dashboardFetchId = 0;
      let recordsFetchId = 0;
      try {
        if (isPaginationOnlyRefresh) {
          latestRecordsFetchIdRef.current += 1;
          recordsFetchId = latestRecordsFetchIdRef.current;
          setRecordsRefreshing(true);
        } else {
          latestDashboardFetchIdRef.current += 1;
          dashboardFetchId = latestDashboardFetchIdRef.current;
          setDashboardLoading(true);
        }

        const success = successFilter === 'all' ? undefined : successFilter === 'success';
        const query = {
          days,
          pageNum: page,
          pageSize,
          taskType: taskType || undefined,
          modelId: modelId || undefined,
          success,
          keyword: keywordValue || undefined,
        };

        if (isPaginationOnlyRefresh) {
          const response = await analyticsService.getAiDashboard(query);
          if (!isLatestFetch()) return;

          if (response.code === 200 && response.data) {
            setData(current => ({
              ...current,
              records: response.data.records,
            }));
          } else {
            toast.error('加载 AI 调用记录失败');
          }
          return;
        }

        const [response, gapResponse] = await Promise.all([
          analyticsService.getAiDashboard(query),
          analyticsService.getAiPricingGaps(query),
        ]);

        if (!isLatestFetch()) return;

        if (response.code === 200 && response.data) {
          setData(response.data);
        } else {
          setData(EMPTY_DATA);
        }

        if (gapResponse.code === 200 && gapResponse.data) {
          setPricingGaps(gapResponse.data);
        } else {
          setPricingGaps([]);
        }
      } catch (error) {
        logger.error('Failed to fetch AI analytics:', error);
        if (!isLatestFetch()) return;

        if (isPaginationOnlyRefresh) {
          toast.error('加载 AI 调用记录失败');
        } else {
          toast.error('加载 AI 统计数据失败');
          setData(EMPTY_DATA);
          setPricingGaps([]);
        }
      } finally {
        if (mountedRef.current) {
          if (isPaginationOnlyRefresh) {
            if (latestRecordsFetchIdRef.current === recordsFetchId) {
              setRecordsRefreshing(false);
            }
          } else {
            if (latestDashboardFetchIdRef.current === dashboardFetchId) {
              setDashboardLoading(false);
              setHasLoadedDashboard(true);
            }
          }
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [days, page, pageSize, taskType, modelId, successFilter, keyword, refreshNonce]);

  const overview = data.overview || EMPTY_DATA.overview;
  const modelOptions = useMemo(
    () => uniqueBy(data.modelDistribution, item => item.model),
    [data.modelDistribution],
  );
  const taskOptions = useMemo(
    () => uniqueBy(data.taskDistribution, item => item.task),
    [data.taskDistribution],
  );
  const records: AiCallRecord[] = data.records?.list || [];
  const isRecordsInitialLoading = dashboardLoading && !hasLoadedDashboard && records.length === 0;
  const isRecordsRefreshing = recordsRefreshing || (dashboardLoading && hasLoadedDashboard);
  const responseRateSummary = getAiResponseRateSummary(
    overview.totalCalls,
    overview.successCalls,
    overview.errorCalls,
  );

  const handleArchive = async () => {
    try {
      setArchiving(true);
      const success = successFilter === 'all' ? undefined : successFilter === 'success';
      const response = await analyticsService.archiveAiCosts({
        days,
        taskType: taskType || undefined,
        modelId: modelId || undefined,
        success,
        keyword: keyword.trim() || undefined,
      });
      if (response.code !== 200 || !response.data) {
        throw new Error('归档失败');
      }
      toast.success(`归档完成：成功 ${response.data.archived} 条，失败 ${response.data.failed} 条`);
      // 回到首页 + bump nonce,由 useEffect 去 fetch,避免重复请求/竞态。
      // page 若已经是 1 仅依赖 setPage 不会重跑 effect,所以始终 bump nonce。
      setPage(1);
      setRefreshNonce(n => n + 1);
    } catch (error) {
      logger.error('Failed to archive AI costs:', error);
      toast.error('归档 AI 费用失败');
    } finally {
      setArchiving(false);
    }
  };

  return (
    <IntelligenceShell className="analytics-page dashboard-page" contentClassName="gap-4">
      <IntelligenceHeader
        title="数据分析"
        eyebrow="INTELLIGENCE · ANALYTICS"
        description="模型调用记录、占比、趋势和成本全链路追踪。"
        icon={BarChart3}
        currentLabel={`${days} 天窗口`}
        activeSummary={`调用 ${overview.totalCalls.toLocaleString()} 次 · 成功率 ${responseRateSummary.successRateValue} · 费用 $${overview.totalCost.toFixed(4)}`}
        actions={
          <>
            <IntelligenceSegmented
              value={days}
              options={([7, 30, 90] as const).map(option => ({
                value: option,
                label: `${option}天`,
              }))}
              onChange={(option) => {
                setDays(option);
                setPage(1);
              }}
              ariaLabel="统计时间窗口"
            />
            <button
              onClick={handleArchive}
              disabled={dashboardLoading || recordsRefreshing || archiving}
              className="intelligence-action-button"
            >
              {archiving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
              归档当前筛选费用
            </button>
          </>
        }
      />

      {pricingGaps.length > 0 && (
        <IntelligenceStatusStrip tone="warning" icon={AlertTriangle}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-amber-600">存在未配置价格的模型</div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                当前筛选范围内有 {pricingGaps.length} 个模型无法完整计算实时费用，卡片和列表会标记为待配置。
              </p>
            </div>
            <Link
              to="/ai-config"
              className="rounded-lg border border-amber-500/20 px-3 py-2 text-xs font-medium text-amber-600"
            >
              打开 AI 配置
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {pricingGaps.slice(0, 6).map((gap) => (
              <Link
                key={`${gap.providerCode}:${gap.modelId}`}
                to={`/ai-config?provider=${encodeURIComponent(gap.providerCode)}&model=${encodeURIComponent(gap.modelId)}`}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 transition-colors hover:border-amber-500/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {gap.displayName || gap.modelId}
                    </div>
                    <div className="truncate text-xs text-[var(--text-muted)]">
                      {gap.providerCode} / {gap.modelId}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold text-amber-600">{gap.calls}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">调用</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {gap.missingFields.map((field) => (
                    <span key={field} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">
                      {field}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </IntelligenceStatusStrip>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <IntelligenceMetric
          label="总调用"
          value={dashboardLoading ? '...' : overview.totalCalls.toLocaleString()}
          detail={`成功率 ${overview.successRate.toFixed(1)}%`}
          icon={Repeat2}
          tone="accent"
        />
        <IntelligenceMetric
          label="总 Tokens"
          value={dashboardLoading ? '...' : overview.totalTokens.toLocaleString()}
          detail={`均次 ${Math.round(overview.avgTokensPerCall)} tokens`}
          icon={Cpu}
          tone="neutral"
        />
        <IntelligenceMetric
          label="总费用"
          value={dashboardLoading ? '...' : `$${overview.totalCost.toFixed(4)}`}
          detail={`均次 $${overview.avgCostPerCall.toFixed(6)}`}
          icon={DollarSign}
          tone="success"
        />
        <IntelligenceMetric
          label="平均延迟"
          value={dashboardLoading ? '...' : `${Math.round(overview.avgLatencyMs)} ms`}
          detail={`缓存命中 ${overview.cacheHitRate}%`}
          icon={Clock}
          tone="accent"
        />
        <IntelligenceMetric
          label="响应成功率"
          value={dashboardLoading ? '...' : responseRateSummary.successRateValue}
          detail={(
            <span>
              {responseRateSummary.countLine} · {responseRateSummary.rateLine}
            </span>
          )}
          icon={CheckCircle2}
          tone="success"
          className="col-span-2 lg:col-span-1"
        />
      </div>

      {dashboardLoading && data.trend.length === 0 ? (
        <div className="h-52 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <AiUsageTrendChart data={data.trend} loading={dashboardLoading} />
            </div>
            <div>
              <AiModelDistributionChart data={data.modelDistribution} loading={dashboardLoading} />
            </div>
          </div>
          {/* P1.2: 任务费用下钻 — 让运营可立刻看出"哪个工具最贵 / ROI 最低" */}
          <AiTaskDistributionChart data={data.taskDistribution} loading={dashboardLoading} />
        </>
      )}

      <AiUsageRecordsTable
        records={records}
        loading={isRecordsInitialLoading}
        refreshing={isRecordsRefreshing}
        page={page}
        pageSize={pageSize}
        total={data.records?.total || 0}
        onPageChange={(nextPage) => {
          if (nextPage < 1) {
            return;
          }
          const totalPages = data.records?.pages || 1;
          if (nextPage > totalPages) {
            return;
          }
          setPage(nextPage);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(nextSize) => {
          setPageSize(nextSize);
          setPage(1);
        }}
        modelOptions={modelOptions}
        taskOptions={taskOptions}
        selectedTaskType={taskType}
        selectedModelId={modelId}
        selectedSuccess={successFilter}
        selectedKeyword={keywordInput}
        onTaskTypeChange={(value) => {
          setTaskType(value);
          setPage(1);
        }}
        onModelIdChange={(value) => {
          setModelId(value);
          setPage(1);
        }}
        onSuccessChange={(value) => {
          setSuccessFilter(value);
          setPage(1);
        }}
        onKeywordChange={(value) => {
          setKeywordInput(value);
        }}
      />
    </IntelligenceShell>
  );
}

export default AnalyticsPage;
