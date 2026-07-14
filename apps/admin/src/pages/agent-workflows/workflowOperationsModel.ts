import type { AgentWorkflowRunSummary } from '@aetherblog/types';

export type WorkflowRunAction = 'cancel' | 'retry' | 'resume' | 'canonicalize';

export interface WorkflowRunActionItem {
  action: WorkflowRunAction;
  label: string;
  targetRunId: AgentWorkflowRunSummary['id'];
  visible: boolean;
  disabled: boolean;
}

export interface WorkflowToolTestResult {
  status: string;
  errorMessage?: string;
  durationMs: number;
}

export interface WorkflowOperationFeedback {
  tone: 'success' | 'warning' | 'error';
  message: string;
}

interface WorkflowExecutionCapabilities {
  realLLM: { enabled: boolean };
  realTools: { enabled: boolean };
  sandbox: { enabled: boolean };
  autonomous: { enabled: boolean };
  scheduler?: { enabled: boolean };
}

const WORKFLOW_RUN_STATUS_LABELS: Record<AgentWorkflowRunSummary['status'], string> = {
  pending: '等待执行',
  running: '执行中',
  paused: '等待批准',
  success: '已完成',
  failed: '失败',
  cancelled: '已停止',
  budget_exceeded: '预算已用尽',
};

export function workflowRunStatusLabel(status: AgentWorkflowRunSummary['status']) {
  return WORKFLOW_RUN_STATUS_LABELS[status];
}

export function shouldShowWorkflowTracePlaceholder(status: AgentWorkflowRunSummary['status']) {
  return status === 'pending' || status === 'running' || status === 'paused';
}

export function workflowToolTestFeedback(
  result: WorkflowToolTestResult | null | undefined,
): WorkflowOperationFeedback {
  if (!result?.status) {
    return { tone: 'error', message: '后端没有返回工具测试结果' };
  }
  if (result.status === 'success') {
    return { tone: 'success', message: `测试通过（${result.durationMs}ms）` };
  }
  if (result.status === 'paused') {
    return { tone: 'warning', message: result.errorMessage || '需要批准后才能测试' };
  }
  return {
    tone: 'error',
    message: result.errorMessage || `工具测试未通过（${result.status}）`,
  };
}

function runIdEquals(
  left: AgentWorkflowRunSummary['id'] | null | undefined,
  right: AgentWorkflowRunSummary['id'] | null | undefined,
) {
  return left != null && right != null && String(left) === String(right);
}

export function isWorkflowRunSelected(
  runId: AgentWorkflowRunSummary['id'],
  selectedRunId: AgentWorkflowRunSummary['id'] | null,
) {
  return runIdEquals(runId, selectedRunId);
}

export function selectWorkflowRun(
  history: AgentWorkflowRunSummary[],
  selectedRunId: AgentWorkflowRunSummary['id'] | null,
) {
  if (selectedRunId == null) return undefined;
  return history.find((run) => isWorkflowRunSelected(run.id, selectedRunId));
}

export function resolveSelectedRunId(
  history: AgentWorkflowRunSummary[],
  selectedRunId: AgentWorkflowRunSummary['id'] | null,
): AgentWorkflowRunSummary['id'] | null {
  return selectWorkflowRun(history, selectedRunId)?.id ?? history[0]?.id ?? null;
}

export function isWorkflowExecutionReady(capabilities: WorkflowExecutionCapabilities) {
  return [
    capabilities.realLLM,
    capabilities.realTools,
    capabilities.sandbox,
    capabilities.autonomous,
  ].every((capability) => capability.enabled);
}

export function buildWorkflowRunActions(
  selectedRun: AgentWorkflowRunSummary | undefined,
): WorkflowRunActionItem[] {
  if (!selectedRun) return [];

  const retryStatus = selectedRun.status === 'failed'
    || selectedRun.status === 'cancelled'
    || selectedRun.status === 'budget_exceeded';
  const canRetry = selectedRun.status === 'cancelled'
    || (retryStatus && selectedRun.retryable === true);
  const canCancel = selectedRun.status === 'pending'
    || selectedRun.status === 'running'
    || selectedRun.status === 'paused';
  const canApprove = selectedRun.status === 'paused';
  const canCanonicalize = !selectedRun.simulated && [
    'success',
    'failed',
    'cancelled',
    'budget_exceeded',
  ].includes(selectedRun.status);

  return [
    {
      action: 'cancel',
      label: '请求停止',
      targetRunId: selectedRun.id,
      visible: true,
      disabled: !canCancel,
    },
    {
      action: 'retry',
      label: '重试',
      targetRunId: selectedRun.id,
      visible: canRetry,
      disabled: !canRetry,
    },
    {
      action: 'resume',
      label: '批准继续',
      targetRunId: selectedRun.id,
      visible: canApprove,
      disabled: !canApprove,
    },
    {
      action: 'canonicalize',
      label: '生成回放草稿',
      targetRunId: selectedRun.id,
      visible: true,
      disabled: !canCanonicalize,
    },
  ];
}
