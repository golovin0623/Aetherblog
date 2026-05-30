import api from './api';
import type { R } from '@/types';
import type {
  AgentDefinitionSummary,
  AgentPublicationRequest,
  AgentPublicationSummary,
  AgentScheduleSummary,
  AgentWorkflowCapabilities,
  AgentWorkflowDetail,
  AgentWorkflowExportResult,
  AgentWorkflowMetrics,
  AgentWorkflowNodeLog,
  AgentWorkflowRunDetail,
  AgentWorkflowRunMode,
  AgentWorkflowRunSummary,
  AgentWorkflowTemplateSummary,
  AgentWorkflowVersionSummary,
  AgentRunTraceItem,
  AgentToolSummary,
  AgentVariableSpec,
  AgentWorkflowDefinition,
  AgentWorkflowSummary,
} from '@aetherblog/types';

const DRAFT_KEY = 'aetherblog.admin.agent-workflows.draft.v1';

export interface AgentWorkflowBundle {
  workflows: AgentWorkflowSummary[];
  tools: AgentToolSummary[];
  agents: AgentDefinitionSummary[];
  schedules: AgentScheduleSummary[];
  variables: AgentVariableSpec[];
  trace: AgentRunTraceItem[];
  runHistory: AgentWorkflowRunSummary[];
  activeDefinition: AgentWorkflowDefinition;
}

export const defaultAgentWorkflowCapabilities: AgentWorkflowCapabilities = {
  defaultRunMode: 'simulate',
  realLLM: {
    enabled: false,
    state: 'not_connected',
    label: '真实 LLM',
    detail: 'workflow runner 尚未接入 LlmRouter。',
  },
  realTools: {
    enabled: false,
    state: 'not_connected',
    label: '真实内置工具',
    detail: 'kb_get_post / kb_search 仍是占位实现。',
  },
  sandbox: {
    enabled: false,
    state: 'not_connected',
    label: '受限代码沙盒',
    detail: '等待 ai-service / sandbox-worker。',
  },
  scheduler: {
    enabled: true,
    state: 'available',
    label: '调度器',
    detail: '支持 schedule CRUD 与 missed-run 策略。',
  },
  autonomous: {
    enabled: false,
    state: 'coming_soon',
    label: 'Autonomous',
    detail: '等待 ReAct/tool-calling loop。',
  },
};

export const isAgentWorkflowRunMode = (value: string): value is AgentWorkflowRunMode =>
  value === 'real' || value === 'simulate';

export const defaultAgentWorkflowDefinition: AgentWorkflowDefinition = {
  version: 1,
  name: 'Article Audit Agent',
  mode: 'fixed',
  description: '对指定文章执行加载、提取、智能体审计与结果输出。',
  inputs: {
    post_id: {
      type: 'integer',
      required: true,
      description: '需要审计的文章 ID',
    },
  },
  nodes: [
    {
      id: 'input_1',
      type: 'input',
      label: '用户输入',
      description: '运行时收集 post_id。',
      position: { x: 40, y: 180 },
      data: { schemaRef: 'inputs' },
    },
    {
      id: 'load_post',
      type: 'tool',
      label: '读取文章',
      description: '调用站内文章读取工具。',
      position: { x: 310, y: 120 },
      data: { toolCode: 'kb_get_post', args: { id: '{{ inputs.post_id }}' } },
    },
    {
      id: 'extract_payload',
      type: 'extractor',
      label: '报文提取',
      description: '提取正文与标题供后续 Agent 使用。',
      position: { x: 595, y: 120 },
      data: { mode: 'jsonpath', path: '$.content_markdown' },
    },
    {
      id: 'audit_agent',
      type: 'agent',
      label: '审计 Agent',
      description: '使用模型和工具白名单执行多步审计。',
      position: { x: 880, y: 120 },
      data: {
        agentId: 'article_auditor',
        model: 'auto',
        maxIterations: 8,
        allowedTools: ['kb_search', 'web_search'],
      },
    },
    {
      id: 'quality_gate',
      type: 'branch',
      label: '质量分支',
      description: '根据审计得分决定是否进入循环修复。',
      position: { x: 1165, y: 120 },
      data: { when: 'nodes.audit_agent.output.score < 0.85' },
    },
    {
      id: 'repair_loop',
      type: 'loop',
      label: '循环修复',
      description: '对未通过的条目逐项生成修复建议。',
      position: { x: 1450, y: 55 },
      data: { over: '{{ nodes.audit_agent.output.issues }}', maxIterations: 12 },
    },
    {
      id: 'final_report',
      type: 'output',
      label: '输出报告',
      description: '输出可回写后台或前台 Agent 的报告。',
      position: { x: 1735, y: 120 },
      data: { outputPath: '{{ nodes.audit_agent.output.report }}' },
    },
    {
      id: 'code_stub',
      type: 'code',
      label: '沙盒代码',
      description: '预留给后续 Python/JS 沙盒执行器。',
      position: { x: 880, y: 335 },
      data: {
        language: 'python',
        sandboxRef: 'disabled-until-sandbox-worker',
        code: '# sandbox-worker 接入后启用',
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'input_1', target: 'load_post' },
    { id: 'e2', source: 'load_post', target: 'extract_payload' },
    { id: 'e3', source: 'extract_payload', target: 'audit_agent' },
    { id: 'e4', source: 'audit_agent', target: 'quality_gate' },
    { id: 'e5', source: 'quality_gate', target: 'repair_loop', label: 'score < 0.85' },
    { id: 'e6', source: 'quality_gate', target: 'final_report', label: 'pass' },
    { id: 'e7', source: 'repair_loop', target: 'final_report' },
  ],
  viewport: { x: 0, y: 0, zoom: 0.72 },
};

export const defaultAgentWorkflowBundle: AgentWorkflowBundle = {
  workflows: [
    {
      id: 'wf_article_audit',
      name: 'Article Audit Agent',
      description: '文章质量审计、事实核查、标题建议和修复建议。',
      mode: 'fixed',
      version: 1,
      nodeCount: defaultAgentWorkflowDefinition.nodes.length,
      runCount: 0,
      updatedAt: new Date().toISOString(),
      published: false,
    },
  ],
  tools: [
    {
      code: 'kb_get_post',
      displayName: '读取文章',
      description: '按文章 ID 读取标题、正文、摘要与标签。',
      category: 'builtin',
      protocol: 'builtin',
      enabled: true,
      requiresApproval: false,
    },
    {
      code: 'kb_search',
      displayName: '站内搜索',
      description: '站内文章关键词与语义检索。',
      category: 'builtin',
      protocol: 'builtin',
      enabled: true,
      requiresApproval: false,
    },
    {
      code: 'web_search',
      displayName: '联网搜索',
      description: '通过受控搜索连接器获取外部结果。',
      category: 'mcp',
      protocol: 'mcp',
      enabled: false,
      requiresApproval: true,
    },
    {
      code: 'skill_security_audit',
      displayName: '安全审计 Skill',
      description: '从 Skill manifest 暴露的审计工具。',
      category: 'skill',
      protocol: 'skill',
      enabled: false,
      requiresApproval: true,
    },
  ],
  agents: [
    {
      id: 'article_auditor',
      name: 'Article Auditor',
      description: '面向文章质量、事实、结构和 SEO 的审计智能体。',
      model: 'auto',
      maxIterations: 8,
      toolCodes: ['kb_get_post', 'kb_search', 'web_search'],
    },
  ],
  schedules: [],
  variables: [
    { name: 'default_locale', scope: 'workflow', type: 'string', value: 'zh-CN' },
    { name: 'search_api_key', scope: 'system', type: 'string', secretRef: 'secret:agent/search_api_key' },
    { name: 'max_daily_runs', scope: 'system', type: 'integer', value: 100 },
  ],
  trace: [
    { id: 't1', nodeId: 'input_1', nodeLabel: '用户输入', nodeType: 'input', status: 'success', durationMs: 0, summary: 'post_id = 171' },
    { id: 't2', nodeId: 'load_post', nodeLabel: '读取文章', nodeType: 'tool', status: 'success', durationMs: 132, summary: '读取正文 4.2K 字符' },
    { id: 't3', nodeId: 'extract_payload', nodeLabel: '报文提取', nodeType: 'extractor', status: 'success', durationMs: 8, summary: '提取 content_markdown' },
    { id: 't4', nodeId: 'audit_agent', nodeLabel: '审计 Agent', nodeType: 'agent', status: 'running', summary: '正在执行工具白名单内的多步审计' },
    { id: 't5', nodeId: 'quality_gate', nodeLabel: '质量分支', nodeType: 'branch', status: 'pending' },
  ],
  runHistory: [],
  activeDefinition: defaultAgentWorkflowDefinition,
};

export function loadLocalAgentWorkflowBundle(): AgentWorkflowBundle {
  if (typeof window === 'undefined') return defaultAgentWorkflowBundle;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return defaultAgentWorkflowBundle;
    const parsed = JSON.parse(raw) as AgentWorkflowBundle;
    if (!parsed?.activeDefinition?.nodes?.length) return defaultAgentWorkflowBundle;
    return {
      ...defaultAgentWorkflowBundle,
      ...parsed,
      workflows: parsed.workflows?.length ? parsed.workflows : defaultAgentWorkflowBundle.workflows,
      tools: parsed.tools?.length ? parsed.tools : defaultAgentWorkflowBundle.tools,
      agents: parsed.agents?.length ? parsed.agents : defaultAgentWorkflowBundle.agents,
      schedules: parsed.schedules || defaultAgentWorkflowBundle.schedules,
      variables: parsed.variables?.length ? parsed.variables : defaultAgentWorkflowBundle.variables,
      trace: parsed.trace?.length ? parsed.trace : defaultAgentWorkflowBundle.trace,
      runHistory: parsed.runHistory || defaultAgentWorkflowBundle.runHistory,
      activeDefinition: parsed.activeDefinition,
    };
  } catch {
    return defaultAgentWorkflowBundle;
  }
}

export function saveLocalAgentWorkflowBundle(bundle: AgentWorkflowBundle) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(bundle));
}

export const agentWorkflowService = {
  listWorkflows: () => api.get<R<AgentWorkflowSummary[]>>('/v1/admin/agent-workflows'),
  getWorkflow: (id: string | number) => api.get<R<AgentWorkflowDetail>>(`/v1/admin/agent-workflows/${id}`),
  getCapabilities: () => api.get<R<AgentWorkflowCapabilities>>('/v1/admin/agent-workflows/capabilities'),
  listTemplates: () => api.get<R<AgentWorkflowTemplateSummary[]>>('/v1/admin/agent-workflows/templates'),
  createWorkflow: (definition: AgentWorkflowDefinition) =>
    api.post<R<AgentWorkflowDetail>>('/v1/admin/agent-workflows', { definition }),
  updateWorkflow: (id: string | number, definition: AgentWorkflowDefinition) =>
    api.patch<R<AgentWorkflowDetail>>(`/v1/admin/agent-workflows/${id}`, { definition }),
  importWorkflow: (definition: AgentWorkflowDefinition, format = 'json') =>
    api.post<R<AgentWorkflowDetail>>('/v1/admin/agent-workflows/import', { definition, format }),
  exportWorkflow: (id: string | number, format = 'json') =>
    api.get<R<AgentWorkflowExportResult>>(`/v1/admin/agent-workflows/${id}/export`, { params: { format } }),
  listVersions: (id: string | number) =>
    api.get<R<AgentWorkflowVersionSummary[]>>(`/v1/admin/agent-workflows/${id}/versions`),
  rollbackVersion: (id: string | number, version: number) =>
    api.post<R<AgentWorkflowDetail>>(`/v1/admin/agent-workflows/${id}/versions/${version}/rollback`),
  listTools: () => api.get<R<AgentToolSummary[]>>('/v1/admin/agent-tools'),
  listAgents: () => api.get<R<AgentDefinitionSummary[]>>('/v1/admin/agent-definitions'),
  listSchedules: () => api.get<R<AgentScheduleSummary[]>>('/v1/admin/agent-schedules'),
  createSchedule: (schedule: Partial<AgentScheduleSummary> & { workflowId: string | number; cronExpr: string }) =>
    api.post<R<AgentScheduleSummary>>('/v1/admin/agent-schedules', schedule),
  updateSchedule: (id: string | number, schedule: Partial<AgentScheduleSummary>) =>
    api.put<R<AgentScheduleSummary>>(`/v1/admin/agent-schedules/${id}`, schedule),
  deleteSchedule: (id: string | number) => api.delete<R<null>>(`/v1/admin/agent-schedules/${id}`),
  testTool: (code: string, args: Record<string, unknown> = {}) =>
    api.post<R<{ status: string; output?: unknown; errorMessage?: string; durationMs: number }>>(`/v1/admin/agent-tools/${code}/test`, { args }),
  listVariables: (workflowId: string | number) =>
    api.get<R<AgentVariableSpec[]>>(`/v1/admin/agent-workflows/${workflowId}/variables`),
  upsertVariable: (workflowId: string | number, variable: AgentVariableSpec) =>
    api.put<R<AgentVariableSpec>>(`/v1/admin/agent-workflows/${workflowId}/variables`, variable),
  metrics: (workflowId: string | number) =>
    api.get<R<AgentWorkflowMetrics>>(`/v1/admin/agent-workflows/${workflowId}/metrics`),
  publishWorkflow: (workflowId: string | number, publication: AgentPublicationRequest = {}) =>
    api.put<R<AgentPublicationSummary>>(`/v1/admin/agent-workflows/${workflowId}/publication`, publication),
  unpublishWorkflow: (workflowId: string | number) =>
    api.delete<R<null>>(`/v1/admin/agent-workflows/${workflowId}/publication`),
  listPublished: (limit = 50) => api.get<R<AgentPublicationSummary[]>>('/v1/agent/published', { params: { limit } }),
  invokePublished: (slug: string, inputs: Record<string, unknown>, simulateExternal = false) =>
    api.post<R<AgentWorkflowRunSummary>>(`/v1/agent/published/${slug}/invoke`, { inputs, simulateExternal }),
  listRuns: (workflowId: string | number, limit = 50) =>
    api.get<R<AgentWorkflowRunSummary[]>>(`/v1/admin/agent-workflows/${workflowId}/runs`, { params: { limit } }),
  getRun: (runId: string | number) => api.get<R<AgentWorkflowRunDetail>>(`/v1/agent/runs/${runId}`),
  getRunLogs: (runId: string | number) => api.get<R<AgentWorkflowNodeLog[]>>(`/v1/agent/runs/${runId}/logs`),
  startRun: (workflowId: string | number, inputs: Record<string, unknown>, simulateExternal = false, extra: Record<string, unknown> = {}) =>
    api.post<R<AgentWorkflowRunSummary>>(`/v1/agent/workflows/${workflowId}/runs`, { inputs, simulateExternal, ...extra }),
  cancelRun: (runId: string | number) => api.post<R<AgentWorkflowRunSummary>>(`/v1/agent/runs/${runId}/cancel`),
  retryRun: (runId: string | number, fromFailedNode = false) =>
    api.post<R<AgentWorkflowRunSummary>>(`/v1/agent/runs/${runId}/retry`, { fromFailedNode }),
  resumeRun: (runId: string | number, resumeFromNode?: string) =>
    api.post<R<AgentWorkflowRunSummary>>(`/v1/agent/runs/${runId}/resume`, { resumeFromNode }),
  canonicalizeRun: (runId: string | number) =>
    api.post<R<AgentWorkflowDetail>>(`/v1/agent/runs/${runId}/canonicalize`),
  testNode: (workflowId: string | number, nodeId: string, inputs: Record<string, unknown>) =>
    api.post<R<{ runId?: string | number; status: string; message?: string }>>(`/v1/admin/agent-workflows/${workflowId}/node-test`, { nodeId, inputs }),
};
