import type { AgentWorkflowDefinition, AgentWorkflowNode } from '@aetherblog/types';

export type WorkflowEntryPhase = 'goal' | 'review' | 'canvas';

export type WorkflowTruthTone = 'neutral' | 'success' | 'warning';

export interface WorkflowGoalStarter {
  key: 'review' | 'organize' | 'maintain';
  kicker: string;
  title: string;
  goal: string;
  description: string;
  steps: string[];
  boundaries: string[];
}

export interface WorkflowTruth {
  label: string;
  detail: string;
  tone: WorkflowTruthTone;
}

export type WorkflowEntrySource =
  | {
      kind: 'goal';
      goal: string;
      steps: string[];
      boundaries: string[];
    }
  | {
      kind: 'template';
      templateKey: string;
    };

export const WORKFLOW_GOAL_STARTERS: WorkflowGoalStarter[] = [
  {
    key: 'review',
    kicker: '发布前把关',
    title: '检查内容并给出修改建议',
    goal: '检查待发布内容的事实、引用与结构，发现问题时先停下来让我确认。',
    description: '适合文章审校、事实核查和发布前质量门禁。',
    steps: ['读取待检查内容', '对照可信来源与站内资料', '标记冲突并等待确认', '生成可审阅的修改建议'],
    boundaries: ['不会自动发布或改写原文', '需要联网或调用外部工具时先沿用当前审批策略'],
  },
  {
    key: 'organize',
    kicker: '内容治理',
    title: '整理重复或过期的内容',
    goal: '找出重复、失效或主题相近的内容，给出合并与归档建议，由我决定是否执行。',
    description: '适合专题治理、旧文盘点和知识资产清理。',
    steps: ['读取选定内容范围', '按主题与时效性分组', '解释重复或过期的判断依据', '生成合并与归档清单'],
    boundaries: ['不会删除、归档或改动任何内容', '证据不足的条目会保留并标记为待确认'],
  },
  {
    key: 'maintain',
    kicker: '内容盘点',
    title: '检查一批需要更新的文章',
    goal: '检查选定的已发布文章是否过期，对照知识库生成更新任务，不直接修改线上内容。',
    description: '适合发起一次可审阅、可追踪的内容盘点；后续如需再查，由你手动发起。',
    steps: ['读取本次选定的已发布内容', '对照知识库和最新可信来源', '生成变更摘要与影响范围', '创建待处理的更新任务'],
    boundaries: ['不会自动重复运行；如需再查，必须手动发起', '真实运行前需要完成能力检查并明确运行输入'],
  },
];

function normalizeEntryText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function hashEntrySource(value: string) {
  let first = 0xdeadbeef ^ value.length;
  let second = 0x41c6ce57 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return `${(second >>> 0).toString(36)}${(first >>> 0).toString(36)}`;
}

export function buildWorkflowEntrySourceKey(source: WorkflowEntrySource) {
  if (source.kind === 'template') {
    return JSON.stringify({ kind: source.kind, templateKey: normalizeEntryText(source.templateKey) });
  }
  return JSON.stringify({
    kind: source.kind,
    goal: normalizeEntryText(source.goal),
    steps: source.steps.map(normalizeEntryText).filter(Boolean),
    boundaries: source.boundaries.map(normalizeEntryText).filter(Boolean),
  });
}

export function resolveWorkflowEntryDraftId(
  sourceKey: string,
  existingSourceKeys: Record<string, string>,
) {
  const existing = Object.entries(existingSourceKeys).find(([, value]) => value === sourceKey);
  if (existing) return existing[0];

  const baseId = `wf_goal_entry_${hashEntrySource(sourceKey)}`;
  let candidate = baseId;
  let collisionIndex = 2;
  while (existingSourceKeys[candidate] && existingSourceKeys[candidate] !== sourceKey) {
    candidate = `${baseId}_${collisionIndex}`;
    collisionIndex += 1;
  }
  return candidate;
}

interface WorkflowGoalDraftInput {
  name: string;
  goal: string;
  steps: string[];
  boundaries: string[];
}

export function buildWorkflowDefinitionFromGoal({
  name,
  goal,
  steps,
  boundaries,
}: WorkflowGoalDraftInput): AgentWorkflowDefinition {
  const normalizedGoal = goal.trim();
  const normalizedSteps = steps.map((step) => step.trim()).filter(Boolean);
  const normalizedBoundaries = boundaries.map((boundary) => boundary.trim()).filter(Boolean);
  const stepNodes: AgentWorkflowNode[] = normalizedSteps.map((step, index) => ({
    id: `goal_step_${index + 1}`,
    type: 'agent',
    label: step,
    description: '这是从执行草案生成的业务步骤；请在真实运行前确认智能体、工具和输入。',
    position: { x: 340 + index * 300, y: 140 },
    data: {
      agentId: '',
      model: 'auto',
      maxIterations: 1,
      allowedTools: [],
      goal: normalizedGoal,
      boundaries: normalizedBoundaries,
      draftOnly: true,
    },
  }));
  const inputNode: AgentWorkflowNode = {
    id: 'goal_input',
    type: 'input',
    label: '确认内容范围',
    description: '运行时提供本次任务要处理的文章、资料或内容范围。',
    position: { x: 40, y: 140 },
    data: { schemaRef: 'inputs', goal: normalizedGoal, draftOnly: true },
  };
  const outputNode: AgentWorkflowNode = {
    id: 'goal_output',
    type: 'output',
    label: '输出审阅结果',
    description: '生成可审阅的结果；不会因为创建草稿而自动修改或发布内容。',
    position: { x: 340 + stepNodes.length * 300, y: 140 },
    data: {
      outputPath: stepNodes.length > 0
        ? `{{ nodes.${stepNodes[stepNodes.length - 1].id}.output }}`
        : '{{ inputs.content_scope }}',
      boundaries: normalizedBoundaries,
      draftOnly: true,
    },
  };
  const nodes = [inputNode, ...stepNodes, outputNode];

  return {
    version: 1,
    name: name.trim() || '自定义任务草稿',
    mode: 'fixed',
    description: normalizedGoal,
    inputs: {
      content_scope: {
        type: 'string',
        required: true,
        description: '本次任务要处理的内容范围',
      },
    },
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: `goal_edge_${index + 1}`,
      source: node.id,
      target: nodes[index + 1].id,
    })),
    viewport: { x: 0, y: 0, zoom: 0.78 },
  };
}

export function getWorkflowEntryAction(phase: WorkflowEntryPhase, hasGoal: boolean) {
  if (phase === 'review') {
    return { label: '进入高级编排', disabled: false, nextPhase: 'canvas' as const };
  }
  if (phase === 'canvas') {
    return { label: '返回目标', disabled: false, nextPhase: 'goal' as const };
  }
  if (!hasGoal) {
    return { label: '先描述目标', disabled: true, nextPhase: 'goal' as const };
  }
  return { label: '查看执行草案', disabled: false, nextPhase: 'review' as const };
}

function hasBackendWorkflowId(id: string | number) {
  return typeof id === 'number' || /^\d+$/.test(String(id));
}

export function getWorkflowTruth(workflow: { id: string | number; published: boolean }): WorkflowTruth {
  if (!hasBackendWorkflowId(workflow.id)) {
    return {
      label: '本地草稿',
      detail: '仅保存在当前浏览器，尚未同步到后端',
      tone: 'warning',
    };
  }
  if (workflow.published) {
    return {
      label: '发布入口已开启',
      detail: '已有一个版本可调用；当前草稿是否与发布版本一致，请到发布配置中确认',
      tone: 'success',
    };
  }
  return {
    label: '后端草稿',
    detail: '已同步，但还没有可调用的发布版本',
    tone: 'neutral',
  };
}

export function getRunTruth(input: { hasRun: boolean; simulated?: boolean }): WorkflowTruth {
  if (!input.hasRun) {
    return {
      label: '本地示例',
      detail: '只用于理解步骤，不是一次后端运行',
      tone: 'warning',
    };
  }
  if (input.simulated) {
    return {
      label: '模拟运行',
      detail: '后端记录已创建，外部调用使用模拟结果',
      tone: 'warning',
    };
  }
  return {
    label: '真实运行',
    detail: '来自后端执行器及真实运行记录',
    tone: 'success',
  };
}
