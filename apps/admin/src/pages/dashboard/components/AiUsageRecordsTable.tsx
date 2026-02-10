import { CheckCircle2, Filter, Search, XCircle } from 'lucide-react';
import { DataTable } from '@/components/common';
import { cn } from '@/lib/utils';
import type { AiCallRecord } from '@/services/analyticsService';

interface AiUsageRecordsTableProps {
  records: AiCallRecord[];
  loading?: boolean;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (nextPage: number) => void;
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
        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs bg-indigo-500/10 text-indigo-400">
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
        <span className="text-sm text-emerald-400">${item.cost.toFixed(6)}</span>
      ),
      width: '110px',
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
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="text-xs text-green-400">成功</span>
            </>
          ) : (
            <>
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-xs text-red-400">失败</span>
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

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Filter className="w-4 h-4" />
          <span>调用记录筛选</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--text-muted)]">任务类型</span>
            <select
              value={selectedTaskType || ''}
              onChange={(e) => onTaskTypeChange(e.target.value)}
              className="h-9 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-3 text-sm text-[var(--text-primary)]"
            >
              <option value="">全部任务</option>
              {taskOptions.map(task => (
                <option key={task} value={task}>{formatTask(task)}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--text-muted)]">模型</span>
            <select
              value={selectedModelId || ''}
              onChange={(e) => onModelIdChange(e.target.value)}
              className="h-9 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-3 text-sm text-[var(--text-primary)]"
            >
              <option value="">全部模型</option>
              {modelOptions.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--text-muted)]">调用结果</span>
            <select
              value={selectedSuccess}
              onChange={(e) => onSuccessChange(e.target.value as 'all' | 'success' | 'failed')}
              className="h-9 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-3 text-sm text-[var(--text-primary)]"
            >
              <option value="all">全部</option>
              <option value="success">仅成功</option>
              <option value="failed">仅失败</option>
            </select>
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
      />
    </div>
  );
}

export default AiUsageRecordsTable;
