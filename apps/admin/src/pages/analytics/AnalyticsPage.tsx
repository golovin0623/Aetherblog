import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cpu, DollarSign, Clock, Loader2, Repeat2, CheckCircle2 } from 'lucide-react';
import { StatsCard } from '../dashboard/components/StatsCard';
import {
  AiModelDistributionChart,
  AiUsageTrendChart,
  AiUsageRecordsTable,
} from '../dashboard/components';
import {
  analyticsService,
  type AiDashboardData,
  type AiCallRecord,
  type AiPricingGap,
} from '@/services/analyticsService';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { getAiResponseRateSummary } from '@/lib/aiMetrics';

const PAGE_SIZE = 20;

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
    pageSize: PAGE_SIZE,
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
  const [taskType, setTaskType] = useState('');
  const [modelId, setModelId] = useState('');
  const [successFilter, setSuccessFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [data, setData] = useState<AiDashboardData>(EMPTY_DATA);
  const [pricingGaps, setPricingGaps] = useState<AiPricingGap[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const success = successFilter === 'all' ? undefined : successFilter === 'success';
        const query = {
          days,
          pageNum: page,
          pageSize: PAGE_SIZE,
          taskType: taskType || undefined,
          modelId: modelId || undefined,
          success,
          keyword: keyword.trim() || undefined,
        };
        const [response, gapResponse] = await Promise.all([
          analyticsService.getAiDashboard(query),
          analyticsService.getAiPricingGaps(query),
        ]);

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
        toast.error('加载 AI 统计数据失败');
        setData(EMPTY_DATA);
        setPricingGaps([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [days, page, taskType, modelId, successFilter, keyword]);

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
      setPage(1);
      const refreshed = await analyticsService.getAiDashboard({
        days,
        pageNum: 1,
        pageSize: PAGE_SIZE,
        taskType: taskType || undefined,
        modelId: modelId || undefined,
        success,
        keyword: keyword.trim() || undefined,
      });
      if (refreshed.code === 200 && refreshed.data) {
        setData(refreshed.data);
      }
      const refreshedGaps = await analyticsService.getAiPricingGaps({
        days,
        taskType: taskType || undefined,
        modelId: modelId || undefined,
        success,
        keyword: keyword.trim() || undefined,
      });
      setPricingGaps(refreshedGaps.data || []);
    } catch (error) {
      logger.error('Failed to archive AI costs:', error);
      toast.error('归档 AI 费用失败');
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">AI 数据分析</h1>
          <p className="text-[var(--text-muted)] mt-1">模型调用记录、占比、趋势和成本全链路追踪</p>
        </div>

        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] self-start">
          {([7, 30, 90] as const).map(option => (
            <button
              key={option}
              onClick={() => {
                setDays(option);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                days === option
                  ? 'bg-primary text-white shadow'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {option}天
            </button>
          ))}
        </div>
        <button
          onClick={handleArchive}
          disabled={loading || archiving}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:opacity-50"
        >
          {(loading || archiving) ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
          归档当前筛选费用
        </button>
      </div>

      {pricingGaps.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
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
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4 [&>:last-child]:col-span-2 lg:[&>:last-child]:col-span-1">
        <StatsCard
          title="总调用"
          value={overview.totalCalls}
          change={overview.successRate}
          changeLabel="成功率"
          icon={<Repeat2 className="w-5 h-5" />}
          color="indigo"
          loading={loading}
        />
        <StatsCard
          title="总 Tokens"
          value={overview.totalTokens}
          change={0}
          changeLabel={`均次 ${Math.round(overview.avgTokensPerCall)} tokens`}
          icon={<Cpu className="w-5 h-5" />}
          color="cyan"
          loading={loading}
        />
        <StatsCard
          title="总费用"
          value={`$${overview.totalCost.toFixed(4)}`}
          change={0}
          changeLabel={`均次 $${overview.avgCostPerCall.toFixed(6)}`}
          icon={<DollarSign className="w-5 h-5" />}
          color="emerald"
          loading={loading}
        />
        <StatsCard
          title="平均延迟"
          value={`${Math.round(overview.avgLatencyMs)} ms`}
          change={0}
          changeLabel={`缓存命中 ${overview.cacheHitRate}%`}
          icon={<Clock className="w-5 h-5" />}
          color="blue"
          loading={loading}
        />
        <StatsCard
          title="响应成功率"
          value={responseRateSummary.successRateValue}
          changeLabel={(
            <div className="space-y-0.5 leading-5">
              <div>{responseRateSummary.countLine}</div>
              <div>{responseRateSummary.rateLine}</div>
            </div>
          )}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="green"
          loading={loading}
        />
      </div>

      {loading && data.trend.length === 0 ? (
        <div className="h-52 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            <AiUsageTrendChart data={data.trend} loading={loading} />
          </div>
          <div>
            <AiModelDistributionChart data={data.modelDistribution} loading={loading} />
          </div>
        </div>
      )}

      <AiUsageRecordsTable
        records={records}
        loading={loading}
        page={data.records?.pageNum || page}
        pageSize={data.records?.pageSize || PAGE_SIZE}
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
        modelOptions={modelOptions}
        taskOptions={taskOptions}
        selectedTaskType={taskType}
        selectedModelId={modelId}
        selectedSuccess={successFilter}
        selectedKeyword={keyword}
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
          setKeyword(value);
          setPage(1);
        }}
      />
    </div>
  );
}

export default AnalyticsPage;
