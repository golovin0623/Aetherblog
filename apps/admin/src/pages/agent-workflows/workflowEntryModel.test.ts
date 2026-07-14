import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_GOAL_STARTERS,
  buildWorkflowEntrySourceKey,
  buildWorkflowDefinitionFromGoal,
  getRunTruth,
  getWorkflowEntryAction,
  getWorkflowTruth,
  resolveWorkflowEntryDraftId,
} from './workflowEntryModel';

describe('workflow goal-first entry', () => {
  it('keeps each starter goal understandable before exposing the canvas', () => {
    expect(WORKFLOW_GOAL_STARTERS.length).toBeGreaterThanOrEqual(3);

    for (const starter of WORKFLOW_GOAL_STARTERS) {
      expect(starter.goal.length).toBeGreaterThan(6);
      expect(starter.steps.length).toBeGreaterThanOrEqual(3);
      expect(starter.boundaries.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('does not promise recurring execution when the scheduler daemon is unavailable', () => {
    const maintenanceStarter = WORKFLOW_GOAL_STARTERS.find((starter) => starter.key === 'maintain');
    const userFacingCopy = [
      maintenanceStarter?.kicker,
      maintenanceStarter?.title,
      maintenanceStarter?.goal,
      maintenanceStarter?.description,
      ...(maintenanceStarter?.steps ?? []),
      ...(maintenanceStarter?.boundaries ?? []),
    ].join(' ');

    expect(maintenanceStarter).toBeDefined();
    expect(userFacingCopy).not.toMatch(/持续维护|定期|按计划|每周/);
    expect(userFacingCopy).toContain('不会自动重复运行');
  });

  it('asks for a goal before generating a reviewable draft', () => {
    expect(getWorkflowEntryAction('goal', false)).toEqual({
      label: '先描述目标',
      disabled: true,
      nextPhase: 'goal',
    });
    expect(getWorkflowEntryAction('goal', true)).toEqual({
      label: '查看执行草案',
      disabled: false,
      nextPhase: 'review',
    });
  });

  it('only opens the advanced editor after the business plan is reviewed', () => {
    expect(getWorkflowEntryAction('review', true)).toEqual({
      label: '进入高级编排',
      disabled: false,
      nextPhase: 'canvas',
    });
  });

  it('turns the reviewed goal and steps into a new editable draft definition', () => {
    const definition = buildWorkflowDefinitionFromGoal({
      name: '内容治理',
      goal: '找出重复内容并生成合并建议，但不要直接改文章。',
      steps: ['读取内容范围', '判断重复依据', '等待人工确认', '输出合并建议'],
      boundaries: ['不修改原文', '不自动发布'],
    });

    expect(definition.name).toBe('内容治理');
    expect(definition.description).toContain('找出重复内容');
    expect(definition.nodes.map((node) => node.label)).toEqual([
      '确认内容范围',
      '读取内容范围',
      '判断重复依据',
      '等待人工确认',
      '输出合并建议',
      '输出审阅结果',
    ]);
    expect(definition.edges).toHaveLength(definition.nodes.length - 1);
    expect(definition.edges[0]).toMatchObject({ source: 'goal_input', target: 'goal_step_1' });
    expect(definition.nodes.at(-1)?.data).toMatchObject({
      boundaries: ['不修改原文', '不自动发布'],
      draftOnly: true,
    });
    expect(definition.nodes.some((node) => node.label === '审计 Agent')).toBe(false);
  });

  it('reuses the same local draft when the reviewed goal has not changed', () => {
    const sourceKey = buildWorkflowEntrySourceKey({
      kind: 'goal',
      goal: '  检查内容并等待确认。 ',
      steps: ['读取内容', '等待确认'],
      boundaries: ['不修改原文'],
    });
    const draftId = resolveWorkflowEntryDraftId(sourceKey, {});
    const existingKeys = { [draftId]: sourceKey };

    expect(buildWorkflowEntrySourceKey({
      kind: 'goal',
      goal: '检查内容并等待确认。',
      steps: ['读取内容', '等待确认'],
      boundaries: ['不修改原文'],
    })).toBe(sourceKey);
    expect(resolveWorkflowEntryDraftId(sourceKey, existingKeys)).toBe(draftId);
  });

  it('allocates a different local draft when the goal truly changes', () => {
    const firstSource = buildWorkflowEntrySourceKey({
      kind: 'goal',
      goal: '检查文章引用',
      steps: ['读取文章'],
      boundaries: ['不自动发布'],
    });
    const secondSource = buildWorkflowEntrySourceKey({
      kind: 'goal',
      goal: '整理过期文章',
      steps: ['读取文章'],
      boundaries: ['不自动发布'],
    });
    const firstId = resolveWorkflowEntryDraftId(firstSource, {});
    const secondId = resolveWorkflowEntryDraftId(secondSource, { [firstId]: firstSource });

    expect(secondSource).not.toBe(firstSource);
    expect(secondId).not.toBe(firstId);
  });

  it('restores a template draft by template identity instead of rebuilding it', () => {
    const sourceKey = buildWorkflowEntrySourceKey({ kind: 'template', templateKey: 'weekly-maintenance' });
    const draftId = resolveWorkflowEntryDraftId(sourceKey, {});

    expect(resolveWorkflowEntryDraftId(sourceKey, { [draftId]: sourceKey })).toBe(draftId);
  });
});

describe('workflow truth labels', () => {
  it('distinguishes local drafts, backend drafts, and published backend versions', () => {
    expect(getWorkflowTruth({ id: 'wf_article_audit', published: false })).toEqual({
      label: '本地草稿',
      detail: '仅保存在当前浏览器，尚未同步到后端',
      tone: 'warning',
    });
    expect(getWorkflowTruth({ id: 23, published: false })).toEqual({
      label: '后端草稿',
      detail: '已同步，但还没有可调用的发布版本',
      tone: 'neutral',
    });
    expect(getWorkflowTruth({ id: '23', published: true })).toEqual({
      label: '发布入口已开启',
      detail: '已有一个版本可调用；当前草稿是否与发布版本一致，请到发布配置中确认',
      tone: 'success',
    });
  });

  it('never presents simulated or placeholder traces as real runs', () => {
    expect(getRunTruth({ hasRun: false })).toEqual({
      label: '本地示例',
      detail: '只用于理解步骤，不是一次后端运行',
      tone: 'warning',
    });
    expect(getRunTruth({ hasRun: true, simulated: true })).toEqual({
      label: '模拟运行',
      detail: '后端记录已创建，外部调用使用模拟结果',
      tone: 'warning',
    });
    expect(getRunTruth({ hasRun: true, simulated: false })).toEqual({
      label: '真实运行',
      detail: '来自后端执行器及真实运行记录',
      tone: 'success',
    });
  });
});
