import { useEffect, useMemo, useState } from 'react';
import { Cpu, DollarSign, Clock, Loader2, Repeat2, AlertTriangle } from 'lucide-react';
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
} from '@/services/analyticsService';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

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
  const [data, setData] = useState<AiDashboardData>(EMPTY_DATA);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const success = successFilter === 'all' ? undefined : successFilter === 'success';
        const response = await analyticsService.getAiDashboard({
          days,
          pageNum: page,
          pageSize: PAGE_SIZE,
          taskType: taskType || undefined,
          modelId: modelId || undefined,
          success,
          keyword: keyword.trim() || undefined,
        });

        if (response.code === 200 && response.data) {
          setData(response.data);
        } else {
          setData(EMPTY_DATA);
        }
      } catch (error) {
        logger.error('Failed to fetch AI analytics:', error);
        toast.error('加载 AI 统计数据失败');
        setData(EMPTY_DATA);
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
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4">
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
          title="失败请求"
          value={overview.errorCalls}
          change={0}
          changeLabel={`成功 ${overview.successCalls}`}
          icon={<AlertTriangle className="w-5 h-5" />}
          color="orange"
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
