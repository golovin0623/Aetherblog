export type WorkspaceMode = 'ask' | 'organize' | 'automate';
export type WorkspacePhase = 'compose' | 'review';
export type WorkspaceSourceMode = 'auto' | 'selected' | 'none';

export interface WorkspacePlanStep {
  id: string;
  title: string;
  description: string;
}

export interface WorkspacePlan {
  goal: string;
  mode: WorkspaceMode;
  source: WorkspacePlanStep;
  steps: WorkspacePlanStep[];
  boundaries: string[];
}

export interface WorkspaceSourceSummary {
  mode: WorkspaceSourceMode;
  readyKnowledgeFileCount: number;
  readyAtlasCarrierCount: number;
  selectedLabels?: string[];
}

export interface WorkspaceState {
  phase: WorkspacePhase;
  mode: WorkspaceMode;
  goal: string;
  plan?: WorkspacePlan;
}

export type WorkspaceEvent =
  | { type: 'review-plan'; plan: WorkspacePlan }
  | { type: 'return-to-compose' }
  | { type: 'change-mode'; mode: WorkspaceMode }
  | { type: 'change-goal'; goal: string };

export type KnowledgeReadiness = 'empty' | 'processing' | 'attention' | 'ready';

const planByMode: Record<WorkspaceMode, Pick<WorkspacePlan, 'steps' | 'boundaries'>> = {
  ask: {
    steps: [
      { id: 'retrieve', title: '检索并核对证据', description: '从可用来源召回相关片段，并检查版本与可信度。' },
      { id: 'answer', title: '生成带引用的回答', description: '给出结论，并让每条关键判断可以回到原文。' },
    ],
    boundaries: ['没有可靠来源时明确说明', '不会改写或发布内容'],
  },
  organize: {
    steps: [
      { id: 'group', title: '归类并提炼要点', description: '按主题合并重复信息，标记冲突和缺口。' },
      { id: 'review', title: '等待你的确认', description: '先展示整理草案，由你决定保留、修改或删除。' },
      { id: 'prepare', title: '生成可复制的整理结果', description: '输出可继续编辑的内容，不覆盖或保存到原始内容。' },
    ],
    boundaries: ['不会覆盖原文', '结果只在对话中生成'],
  },
  automate: {
    steps: [
      { id: 'compare', title: '对照可信来源', description: '检查内容是否重复、冲突、过期或缺少依据。' },
      { id: 'approve', title: '标记冲突并等待确认', description: '发现冲突时暂停，把证据和影响交给你确认。' },
      { id: 'draft', title: '生成结果草稿', description: '只生成可编辑草稿，不改变线上内容。' },
    ],
    boundaries: ['不会自动发布', '发现冲突时暂停'],
  },
};

const noSourceStepsByMode: Record<WorkspaceMode, WorkspacePlanStep[]> = {
  ask: [
    {
      id: 'reason',
      title: '根据描述组织回答',
      description: '只依据你的目标说明组织答案，无法核实的内容会明确标记。',
    },
    {
      id: 'answer',
      title: '生成不带私有引用的回答',
      description: '不会把模型常识伪装成来自你的知识库或笔记。',
    },
  ],
  organize: [
    {
      id: 'group',
      title: '整理目标说明',
      description: '只整理你在目标中提供的内容，缺少材料时会明确指出。',
    },
    {
      id: 'review',
      title: '等待你的确认',
      description: '先展示整理结构，由你决定是否补充材料或继续编辑。',
    },
    {
      id: 'prepare',
      title: '生成可复制的整理结果',
      description: '输出可继续编辑的内容，不覆盖或保存到原始内容。',
    },
  ],
  automate: [
    {
      id: 'check',
      title: '按目标说明完成一次检查',
      description: '只检查你在目标中明确提供的信息，不声称已核对私有资料。',
    },
    {
      id: 'approve',
      title: '标记缺口并等待确认',
      description: '材料不足时暂停，把需要补充的内容交给你确认。',
    },
    {
      id: 'draft',
      title: '生成结果草稿',
      description: '只生成可编辑草稿，不改变线上内容。',
    },
  ],
};

function safeSourceCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function buildSourceStep(summary: WorkspaceSourceSummary): WorkspacePlanStep {
  if (summary.mode === 'none') {
    return {
      id: 'source',
      title: '确认任务与输入',
      description: '本次不会检索知识库、知识点或笔记，只根据你的目标说明完成任务。',
    };
  }

  if (summary.mode === 'selected') {
    const labels = (summary.selectedLabels ?? []).map((label) => label.trim()).filter(Boolean);
    return labels.length > 0
      ? {
          id: 'source',
          title: `读取 ${labels.length} 个指定来源`,
          description: `只使用你指定的 ${labels.join('、')}；准备中或失败内容不会用于结果。`,
        }
      : {
          id: 'source',
          title: '确认指定来源',
          description: '尚未指定可用来源；返回上一步选择后再继续。',
        };
  }

  const readyKnowledgeFileCount = safeSourceCount(summary.readyKnowledgeFileCount);
  const loaded: string[] = [];
  if (readyKnowledgeFileCount > 0) loaded.push(`${readyKnowledgeFileCount} 份可检索资料`);
  const snapshot = loaded.length > 0
    ? `当前已加载 ${loaded.join('、')}`
    : '当前页面未加载到可检索知识库';
  return {
    id: 'source',
    title: '自动选择可检索知识',
    description: `${snapshot}；执行时自动检索你有权使用的知识库与知识点，笔记或读物需要明确指定。`,
  };
}

export function buildWorkspacePlan(
  mode: WorkspaceMode,
  goal: string,
  sourceSummary: WorkspaceSourceSummary,
): WorkspacePlan {
  const normalizedGoal = goal.trim();
  if (!normalizedGoal) {
    throw new Error('请先说明想完成什么');
  }
  const template = planByMode[mode];
  const source = buildSourceStep(sourceSummary);
  const taskSteps = sourceSummary.mode === 'none'
    ? noSourceStepsByMode[mode]
    : template.steps;
  return {
    goal: normalizedGoal,
    mode,
    source,
    steps: [source, ...taskSteps.map((step) => ({ ...step }))],
    boundaries: [...template.boundaries],
  };
}

export function reduceWorkspaceState(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  switch (event.type) {
    case 'review-plan':
      return {
        ...state,
        phase: 'review',
        mode: event.plan.mode,
        goal: event.plan.goal,
        plan: event.plan,
      };
    case 'return-to-compose':
      return { ...state, phase: 'compose', plan: undefined };
    case 'change-mode':
      return { ...state, phase: 'compose', mode: event.mode, plan: undefined };
    case 'change-goal':
      return { ...state, phase: 'compose', goal: event.goal, plan: undefined };
  }
}

export function getWorkspacePrimaryAction(
  state: WorkspaceState,
): { label: string; disabled: boolean } {
  switch (state.phase) {
    case 'compose':
      return { label: '检查执行方案', disabled: state.goal.trim().length === 0 };
    case 'review':
      return { label: '确认并进入灵境', disabled: false };
  }
}

export function getKnowledgeReadiness(input: {
  fileCount: number;
  vectorizedCount: number;
  failedCount: number;
  carrierCount: number;
  readyCarrierCount: number;
  failedCarrierCount: number;
}): KnowledgeReadiness {
  const {
    fileCount,
    vectorizedCount,
    failedCount,
    carrierCount,
    readyCarrierCount,
    failedCarrierCount,
  } = input;
  const counters = [
    fileCount,
    vectorizedCount,
    failedCount,
    carrierCount,
    readyCarrierCount,
    failedCarrierCount,
  ];
  if (counters.some((value) => !Number.isSafeInteger(value) || value < 0)) return 'attention';
  if (
    vectorizedCount + failedCount > fileCount ||
    readyCarrierCount + failedCarrierCount > carrierCount
  ) return 'attention';
  if (fileCount === 0 && carrierCount === 0) return 'empty';
  if (failedCount > 0 || failedCarrierCount > 0) return 'attention';
  if (vectorizedCount < fileCount || readyCarrierCount < carrierCount) return 'processing';
  return 'ready';
}
