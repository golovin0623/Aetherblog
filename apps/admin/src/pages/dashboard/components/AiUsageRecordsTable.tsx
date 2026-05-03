import { CheckCircle2, Filter, Search, XCircle } from 'lucide-react';
import { DataTable, StyledSelect } from '@/components/common';
import { cn } from '@/lib/utils';
import type { AiCallRecord } from '@/services/analyticsService';

interface AiUsageRecordsTableProps {
  records: AiCallRecord[];
  loading?: boolean;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (nextPage: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
  modelOptions: string[];
  taskOptions: string[];
  selectedTaskType?: string;
  selectedModelId?: string;
  selectedSuccess?: 'all' | 'success' | 'failed';
  selectedKeyword?: string;
  onTaskTypeChange: (value: string) => void;
  onModelIdChange: (value: string) => void;
  onSuccessChange: (value: 'all' | 'success' | 'failed') => void;
  onKeywordChange: (value: string) => void;
}

const taskLabelMap: Record<string, string> = {
  summary: '摘要',
  tags: '标签',
  titles: '标题',
  polish: '润色',
  outline: '大纲',
  translate: '翻译',
};

function formatTask(task: string) {
  if (!task) return 'unknown';
  return taskLabelMap[task] || task;
}

export function AiUsageRecordsTable({
  records,
  loading = false,
  page,
  pageSize,
  total,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  modelOptions,
  taskOptions,
  selectedTaskType,
  selectedModelId,
  selectedSuccess = 'all',
  selectedKeyword = '',
  onTaskTypeChange,
  onModelIdChange,
  onSuccessChange,
  onKeywordChange,
}: AiUsageRecordsTableProps) {
  const columns = [
    {
      key: 'createdAt',
      title: '时间',
      render: (item: AiCallRecord) => (
        <span className="text-xs text-[var(--text-secondary)]">{new Date(item.createdAt).toLocaleString()}</span>
      ),
      width: '160px',
    },
    {
      key: 'taskType',
      title: '任务',
      render: (item: AiCallRecord) => (
        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs bg-primary/10 text-primary">
          {formatTask(item.taskType)}
        </span>
      ),
      width: '90px',
    },
    {
      key: 'model',
      title: '模型',
      render: (item: AiCallRecord) => (
        <div className="min-w-0">
          <p className="text-sm text-[var(--text-primary)] truncate">{item.model || 'unknown'}</p>
          <p className="text-xs text-[var(--text-muted)] truncate">{item.providerCode || 'default'}</p>
        </div>
      ),
    },
    {
      key: 'totalTokens',
      title: 'Tokens',
      render: (item: AiCallRecord) => (
        <div className="text-right">
          <p className="text-sm text-[var(--text-primary)]">{item.totalTokens.toLocaleString()}</p>
          <p className="text-xs text-[var(--text-muted)]">in {item.tokensIn.toLocaleString()} / out {item.tokensOut.toLocaleString()}</p>
        </div>
      ),
      width: '170px',
    },
    {
      key: 'cost',
      title: '费用',
      render: (item: AiCallRecord) => (
        <div className="flex flex-col gap-1">
          {item.pricingMissing ? (
            <span className="text-sm text-status-warning">待配置</span>
          ) : (
            <span className="text-sm text-status-success">${item.cost.toFixed(6)}</span>
          )}
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'inline-flex rounded px-1.5 py-0.5 text-[10px]',
                item.costStatus === 'archived'
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : item.costStatus === 'missing'
                    ? 'bg-amber-500/10 text-amber-500'
                    : 'bg-sky-500/10 text-sky-500',
              )}
            >
              {item.costStatus === 'archived' ? '已归档' : item.costStatus === 'missing' ? '缺价格' : '实时'}
            </span>
            {item.archiveError && (
              <span className="truncate text-[10px] text-[var(--text-muted)]" title={item.archiveError}>
                {item.archiveError}
              </span>
            )}
          </div>
        </div>
      ),
      width: '170px',
    },
    {
      key: 'latencyMs',
      title: '耗时',
      render: (item: AiCallRecord) => (
        <span className="text-sm text-[var(--text-secondary)]">{Math.round(item.latencyMs)} ms</span>
      ),
      width: '90px',
    },
    {
      key: 'success',
      title: '状态',
      render: (item: AiCallRecord) => (
        <div className="flex items-center gap-1.5">
          {item.success ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-status-success" />
              <span className="text-xs text-status-success">成功</span>
            </>
          ) : (
            <>
              <XCircle className="w-4 h-4 text-status-danger" />
              <span className="text-xs text-status-danger">失败</span>
            </>
          )}
          {item.cached && (
            <span className="text-[10px] rounded px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400">缓存</span>
          )}
        </div>
      ),
      width: '120px',
    },
  ];

  const taskSelectOptions = [
    { value: '', label: '全部任务' },
    ...taskOptions.map(task => ({ value: task, label: formatTask(task) })),
  ];
  const modelSelectOptions = [
    { value: '', label: '全部模型' },
    ...modelOptions.map(model => ({ value: model, label: model })),
  ];
  const successSelectOptions = [
    { value: 'all', label: '全部' },
    { value: 'success', label: '仅成功' },
    { value: 'failed', label: '仅失败' },
  ];

  return (
    <div className="space-y-4">
      <div className="surface-leaf surface-dashboard-card p-4 rounded-xl flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Filter className="w-4 h-4" />
          <span>调用记录筛选</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--text-muted)]">任务类型</span>
            <StyledSelect
              value={selectedTaskType || ''}
              onChange={onTaskTypeChange}
              options={taskSelectOptions}
              ariaLabel="任务类型"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--text-muted)]">模型</span>
            <StyledSelect
              value={selectedModelId || ''}
              onChange={onModelIdChange}
              options={modelSelectOptions}
              ariaLabel="模型"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--text-muted)]">调用结果</span>
            <StyledSelect
              value={selectedSuccess}
              onChange={(nextValue) => onSuccessChange(nextValue as 'all' | 'success' | 'failed')}
              options={successSelectOptions}
              ariaLabel="调用结果"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--text-muted)]">关键字</span>
            <div className={cn('h-9 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center px-2.5 gap-2')}>
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              <input
                value={selectedKeyword}
                onChange={(e) => onKeywordChange(e.target.value)}
                placeholder="模型 / Provider / 错误码"
                className="w-full bg-transparent border-none outline-none text-sm text-[var(--text-primary)]"
              />
            </div>
          </label>
        </div>
      </div>

      <DataTable
        data={records}
        columns={columns}
        loading={loading}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={onPageChange}
        pageSizeOptions={pageSizeOptions}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}

export default AiUsageRecordsTable;
