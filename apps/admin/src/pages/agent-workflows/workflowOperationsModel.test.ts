import { describe, expect, it } from 'vitest';
import type { AgentWorkflowRunSummary } from '@aetherblog/types';
import {
  buildWorkflowRunActions,
  isWorkflowExecutionReady,
  isWorkflowRunSelected,
  resolveSelectedRunId,
  selectWorkflowRun,
  shouldShowWorkflowTracePlaceholder,
  workflowToolTestFeedback,
  workflowRunStatusLabel,
} from './workflowOperationsModel';

function run(
  id: number,
  status: AgentWorkflowRunSummary['status'],
  overrides: Partial<AgentWorkflowRunSummary> = {},
): AgentWorkflowRunSummary {
  return {
    id,
    workflowId: 7,
    version: 3,
    status,
    simulated: false,
    inputs: {},
    totalNodeCount: 4,
    createdAt: `2026-07-14T0${id}:00:00.000Z`,
    ...overrides,
  };
}

describe('workflow selected-run operations', () => {
  it('keeps an explicitly selected historical run when fresher history arrives', () => {
    const history = [run(30, 'running'), run(20, 'failed', { retryable: true })];

    expect(resolveSelectedRunId(history, 20)).toBe(20);
    expect(selectWorkflowRun(history, 20)?.id).toBe(20);
  });

  it('falls back to the newest run only when the current selection no longer exists', () => {
    const history = [run(30, 'running'), run(20, 'failed', { retryable: true })];

    expect(resolveSelectedRunId(history, 999)).toBe(30);
    expect(resolveSelectedRunId([], 20)).toBeNull();
  });

  it('rejects a stale detail response after another run becomes selected', () => {
    expect(isWorkflowRunSelected(20, '20')).toBe(true);
    expect(isWorkflowRunSelected(20, 30)).toBe(false);
  });

  it('targets every visible operation at the selected historical run', () => {
    const selected = run(20, 'failed', { retryable: true });
    const actions = buildWorkflowRunActions(selected);

    expect(actions.map((action) => action.targetRunId)).toEqual(actions.map(() => 20));
    expect(actions.find((action) => action.action === 'retry')).toMatchObject({
      visible: true,
      disabled: false,
      targetRunId: 20,
    });
  });

  it('does not expose retry for successful runs', () => {
    const actions = buildWorkflowRunActions(run(20, 'success', { retryable: true }));

    expect(actions.some((action) => action.action === 'retry' && action.visible)).toBe(false);
  });

  it('does not expose retry when the backend marks a failure non-retryable', () => {
    const actions = buildWorkflowRunActions(run(20, 'failed', { retryable: false }));

    expect(actions.some((action) => action.action === 'retry' && action.visible)).toBe(false);
  });

  it('keeps a user-cancelled run retryable even when its legacy flag is false', () => {
    const actions = buildWorkflowRunActions(run(20, 'cancelled', { retryable: false }));

    expect(actions.find((action) => action.action === 'retry')).toMatchObject({
      visible: true,
      disabled: false,
      targetRunId: 20,
    });
  });

  it('offers an explicit approval action only for paused runs', () => {
    const pausedActions = buildWorkflowRunActions(run(20, 'paused'));
    const failedActions = buildWorkflowRunActions(run(21, 'failed', { retryable: true }));

    expect(pausedActions.find((action) => action.action === 'resume')).toMatchObject({
      label: '批准继续',
      visible: true,
      disabled: false,
      targetRunId: 20,
    });
    expect(failedActions.some((action) => action.action === 'resume' && action.visible)).toBe(false);
  });

  it('only creates a replay draft from a completed real run', () => {
    expect(buildWorkflowRunActions(run(20, 'running')).find((action) => action.action === 'canonicalize')).toMatchObject({
      label: '生成回放草稿',
      disabled: true,
    });
    expect(buildWorkflowRunActions(run(21, 'success')).find((action) => action.action === 'canonicalize')).toMatchObject({
      label: '生成回放草稿',
      disabled: false,
    });
    expect(buildWorkflowRunActions(run(22, 'failed', { simulated: true })).find((action) => action.action === 'canonicalize')).toMatchObject({
      label: '生成回放草稿',
      disabled: true,
    });
  });

  it('presents backend run states as clear admin-facing labels', () => {
    expect(workflowRunStatusLabel('pending')).toBe('等待执行');
    expect(workflowRunStatusLabel('running')).toBe('执行中');
    expect(workflowRunStatusLabel('paused')).toBe('等待批准');
    expect(workflowRunStatusLabel('success')).toBe('已完成');
    expect(workflowRunStatusLabel('failed')).toBe('失败');
    expect(workflowRunStatusLabel('cancelled')).toBe('已停止');
    expect(workflowRunStatusLabel('budget_exceeded')).toBe('预算已用尽');
  });

  it('never turns a missing, paused, or failed tool result into a success message', () => {
    expect(workflowToolTestFeedback(undefined)).toEqual({
      tone: 'error',
      message: '后端没有返回工具测试结果',
    });
    expect(workflowToolTestFeedback({ status: 'paused', errorMessage: '需要审批', durationMs: 3 })).toEqual({
      tone: 'warning',
      message: '需要审批',
    });
    expect(workflowToolTestFeedback({ status: 'failed', errorMessage: '连接失败', durationMs: 5 })).toEqual({
      tone: 'error',
      message: '连接失败',
    });
    expect(workflowToolTestFeedback({ status: 'success', durationMs: 8 })).toEqual({
      tone: 'success',
      message: '测试通过（8ms）',
    });
  });

  it('only synthesizes pending trace rows while a run can still make progress', () => {
    expect(shouldShowWorkflowTracePlaceholder('pending')).toBe(true);
    expect(shouldShowWorkflowTracePlaceholder('running')).toBe(true);
    expect(shouldShowWorkflowTracePlaceholder('paused')).toBe(true);
    expect(shouldShowWorkflowTracePlaceholder('success')).toBe(false);
    expect(shouldShowWorkflowTracePlaceholder('failed')).toBe(false);
    expect(shouldShowWorkflowTracePlaceholder('cancelled')).toBe(false);
    expect(shouldShowWorkflowTracePlaceholder('budget_exceeded')).toBe(false);
  });
});

describe('workflow execution readiness', () => {
  it('does not let the unavailable scheduler gate a direct workflow run', () => {
    expect(isWorkflowExecutionReady({
      realLLM: { enabled: true },
      realTools: { enabled: true },
      sandbox: { enabled: true },
      autonomous: { enabled: true },
      scheduler: { enabled: false },
    })).toBe(true);
  });

  it('still reports execution as gated when an execution capability is unavailable', () => {
    expect(isWorkflowExecutionReady({
      realLLM: { enabled: false },
      realTools: { enabled: true },
      sandbox: { enabled: true },
      autonomous: { enabled: true },
      scheduler: { enabled: false },
    })).toBe(false);
  });
});
