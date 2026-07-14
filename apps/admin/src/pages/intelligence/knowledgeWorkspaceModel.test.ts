import { describe, expect, it } from 'vitest';
import {
  buildWorkspacePlan,
  getKnowledgeReadiness,
  getWorkspacePrimaryAction,
  reduceWorkspaceState,
  type WorkspaceState,
} from './knowledgeWorkspaceModel';

describe('knowledge workspace task plan', () => {
  it('translates a one-time check into business steps and explicit boundaries', () => {
    const plan = buildWorkspacePlan(
      'automate',
      '检查最近一周的新文章是否与已有知识冲突，先给我确认，再生成摘要草稿。',
      {
        mode: 'auto',
        readyKnowledgeFileCount: 8,
        readyAtlasCarrierCount: 2,
      },
    );

    expect(plan.steps.map((step) => step.title)).toEqual([
      '自动选择可检索知识',
      '对照可信来源',
      '标记冲突并等待确认',
      '生成结果草稿',
    ]);
    expect(plan.boundaries).toEqual(['不会自动发布', '发现冲突时暂停']);
    expect(plan.source.description).toContain('8 份可检索资料');
    expect(plan.source.description).toContain('知识库与知识点');
    expect(plan.source.description).toContain('笔记或读物需要明确指定');
    expect(plan.source.description).not.toContain('2 个已就绪读物');
  });

  it('uses a shorter evidence-first plan for question answering', () => {
    const plan = buildWorkspacePlan('ask', 'RAG 会如何影响现有文章的 SEO？', {
      mode: 'selected',
      readyKnowledgeFileCount: 4,
      readyAtlasCarrierCount: 1,
      selectedLabels: ['产品知识库', '架构说明'],
    });

    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[1].title).toBe('检索并核对证据');
    expect(plan.boundaries).toContain('没有可靠来源时明确说明');
    expect(plan.source.title).toBe('读取 2 个指定来源');
    expect(plan.source.description).toContain('产品知识库、架构说明');
  });

  it('never claims it will read knowledge bases or notes when sources are disabled', () => {
    const plan = buildWorkspacePlan('organize', '整理这段目标说明', {
      mode: 'none',
      readyKnowledgeFileCount: 12,
      readyAtlasCarrierCount: 3,
    });

    expect(plan.source.title).toBe('确认任务与输入');
    expect(plan.source.description).toBe(
      '本次不会检索知识库、知识点或笔记，只根据你的目标说明完成任务。',
    );
    expect(plan.steps[0]).toEqual(plan.source);
    expect(plan.steps[0].title).not.toContain('读取');
    expect(plan.steps.map((step) => `${step.title} ${step.description}`).join('\n')).not.toMatch(
      /从可用来源召回|对照可信来源|读取目标内容|保存为笔记/,
    );
  });

  it('rejects an empty goal instead of fabricating a task', () => {
    expect(() =>
      buildWorkspacePlan('organize', '   ', {
        mode: 'none',
        readyKnowledgeFileCount: 0,
        readyAtlasCarrierCount: 0,
      }),
    ).toThrowError('请先说明想完成什么');
  });
});

describe('knowledge workspace state machine', () => {
  const composeState: WorkspaceState = {
    phase: 'compose',
    mode: 'automate',
    goal: '检查文章冲突',
  };

  it('moves from compose to review only after a plan exists', () => {
    const next = reduceWorkspaceState(composeState, {
      type: 'review-plan',
      plan: buildWorkspacePlan('automate', composeState.goal, {
        mode: 'auto',
        readyKnowledgeFileCount: 1,
        readyAtlasCarrierCount: 0,
      }),
    });

    expect(next.phase).toBe('review');
    expect(next.plan?.steps).toHaveLength(4);
  });

  it('moves directly from review to a real handoff action instead of a simulated run', () => {
    const review = reduceWorkspaceState(composeState, {
      type: 'review-plan',
      plan: buildWorkspacePlan('automate', composeState.goal, {
        mode: 'auto',
        readyKnowledgeFileCount: 1,
        readyAtlasCarrierCount: 0,
      }),
    });
    expect(review.phase).toBe('review');
    expect(getWorkspacePrimaryAction(review)).toEqual({
      label: '确认并进入灵境',
      disabled: false,
    });
  });

  it('invalidates a reviewed plan before the goal or source can be edited', () => {
    const review = reduceWorkspaceState(composeState, {
      type: 'review-plan',
      plan: buildWorkspacePlan('automate', composeState.goal, {
        mode: 'selected',
        readyKnowledgeFileCount: 1,
        readyAtlasCarrierCount: 0,
        selectedLabels: ['产品知识库'],
      }),
    });

    const next = reduceWorkspaceState(review, { type: 'return-to-compose' });

    expect(next).toMatchObject({ phase: 'compose' });
    expect(next.plan).toBeUndefined();
  });

  it('invalidates a reviewed plan when mode or goal changes', () => {
    const review = reduceWorkspaceState(composeState, {
      type: 'review-plan',
      plan: buildWorkspacePlan('automate', composeState.goal, {
        mode: 'auto',
        readyKnowledgeFileCount: 1,
        readyAtlasCarrierCount: 0,
      }),
    });
    const changedMode = reduceWorkspaceState(review, { type: 'change-mode', mode: 'ask' });
    expect(changedMode).toMatchObject({ phase: 'compose', mode: 'ask', plan: undefined });

    const changedGoal = reduceWorkspaceState(review, { type: 'change-goal', goal: '重新核对范围' });
    expect(changedGoal).toMatchObject({
      phase: 'compose',
      goal: '重新核对范围',
      plan: undefined,
    });
  });

  it('uses compact, state-specific action labels', () => {
    expect(getWorkspacePrimaryAction(composeState)).toEqual({
      label: '检查执行方案',
      disabled: false,
    });

    const review = reduceWorkspaceState(composeState, {
      type: 'review-plan',
      plan: buildWorkspacePlan('automate', composeState.goal, {
        mode: 'auto',
        readyKnowledgeFileCount: 1,
        readyAtlasCarrierCount: 0,
      }),
    });
    expect(getWorkspacePrimaryAction(review)).toEqual({
      label: '确认并进入灵境',
      disabled: false,
    });
  });
});

describe('knowledge source readiness', () => {
  it('keeps empty, processing, attention and ready states distinct', () => {
    expect(getKnowledgeReadiness({ fileCount: 0, vectorizedCount: 0, failedCount: 0, carrierCount: 0, readyCarrierCount: 0, failedCarrierCount: 0 })).toBe('empty');
    expect(getKnowledgeReadiness({ fileCount: 4, vectorizedCount: 2, failedCount: 0, carrierCount: 0, readyCarrierCount: 0, failedCarrierCount: 0 })).toBe('processing');
    expect(getKnowledgeReadiness({ fileCount: 4, vectorizedCount: 3, failedCount: 1, carrierCount: 0, readyCarrierCount: 0, failedCarrierCount: 0 })).toBe('attention');
    expect(getKnowledgeReadiness({ fileCount: 4, vectorizedCount: 4, failedCount: 0, carrierCount: 0, readyCarrierCount: 0, failedCarrierCount: 0 })).toBe('ready');
  });

  it('treats impossible counters as attention instead of reporting ready', () => {
    expect(getKnowledgeReadiness({ fileCount: 2, vectorizedCount: 3, failedCount: 0, carrierCount: 0, readyCarrierCount: 0, failedCarrierCount: 0 })).toBe('attention');
    expect(getKnowledgeReadiness({ fileCount: 2, vectorizedCount: -1, failedCount: 0, carrierCount: 0, readyCarrierCount: 0, failedCarrierCount: 0 })).toBe('attention');
  });

  it('includes Atlas carriers and never treats an empty knowledge base as processing', () => {
    expect(getKnowledgeReadiness({ fileCount: 0, vectorizedCount: 0, failedCount: 0, carrierCount: 0, readyCarrierCount: 0, failedCarrierCount: 0 })).toBe('empty');
    expect(getKnowledgeReadiness({ fileCount: 0, vectorizedCount: 0, failedCount: 0, carrierCount: 2, readyCarrierCount: 2, failedCarrierCount: 0 })).toBe('ready');
    expect(getKnowledgeReadiness({ fileCount: 0, vectorizedCount: 0, failedCount: 0, carrierCount: 2, readyCarrierCount: 1, failedCarrierCount: 0 })).toBe('processing');
    expect(getKnowledgeReadiness({ fileCount: 0, vectorizedCount: 0, failedCount: 0, carrierCount: 2, readyCarrierCount: 1, failedCarrierCount: 1 })).toBe('attention');
  });
});
