import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Box,
  Braces,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Code2,
  Database,
  FileCheck2,
  FlaskConical,
  GitBranch,
  Globe2,
  KeyRound,
  LibraryBig,
  ListTree,
  LockKeyhole,
  Network,
  PencilLine,
  PanelRight,
  Play,
  Plus,
  Route,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Workflow,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AgentRunTraceItem,
  AgentToolSummary,
  AgentWorkflowCapabilityState,
  AgentWorkflowDefinition,
  AgentWorkflowInputSpec,
  AgentWorkflowNodeLog,
  AgentWorkflowNode,
  AgentWorkflowNodeType,
  AgentWorkflowRunMode,
  AgentWorkflowRunSummary,
  AgentWorkflowSummary,
  AgentWorkflowTemplateSummary,
  AgentWorkflowVersionSummary,
  AgentWorkflowMetrics,
} from '@aetherblog/types';
import { cn } from '@/lib/utils';
import {
  agentWorkflowService,
  defaultAgentWorkflowCapabilities,
  defaultAgentWorkflowDefinition,
  getLocalAgentWorkflowDefinition,
  isAgentWorkflowRunMode,
  loadLocalAgentWorkflowBundle,
  mergeBackendAndLocalWorkflowSummaries,
  removeLocalAgentWorkflowDraft,
  saveLocalAgentWorkflowBundle,
  storeLocalAgentWorkflowDefinition,
  unknownAgentWorkflowCapabilities,
  type AgentWorkflowBundle,
} from '@/services/agentWorkflowService';
import {
  IntelligenceHeader,
  IntelligencePanel,
  IntelligenceShell,
  IntelligenceStatusStrip,
} from '@/components/intelligence/IntelligenceShell';
import {
  WORKFLOW_GOAL_STARTERS,
  buildWorkflowEntrySourceKey,
  buildWorkflowDefinitionFromGoal,
  getRunTruth,
  getWorkflowEntryAction,
  getWorkflowTruth,
  resolveWorkflowEntryDraftId,
  type WorkflowEntryPhase,
  type WorkflowGoalStarter,
  type WorkflowTruth,
} from './workflowEntryModel';
import {
  buildWorkflowRunActions,
  isWorkflowExecutionReady,
  isWorkflowRunSelected,
  resolveSelectedRunId,
  selectWorkflowRun,
  shouldShowWorkflowTracePlaceholder,
  workflowRunStatusLabel,
  workflowToolTestFeedback,
  type WorkflowRunAction,
} from './workflowOperationsModel';

const nodeMeta: Record<AgentWorkflowNodeType, { label: string; icon: typeof Workflow; tone: string }> = {
  input: { label: 'Input', icon: CircleDot, tone: 'text-sky-500' },
  output: { label: 'Output', icon: CheckCircle2, tone: 'text-emerald-500' },
  llm: { label: 'LLM', icon: Sparkles, tone: 'text-indigo-500' },
  agent: { label: 'Agent', icon: Bot, tone: 'text-cyan-500' },
  tool: { label: 'Tool', icon: Box, tone: 'text-amber-500' },
  extractor: { label: 'Extractor', icon: Braces, tone: 'text-teal-500' },
  branch: { label: 'Branch', icon: GitBranch, tone: 'text-orange-500' },
  loop: { label: 'Loop', icon: TimerReset, tone: 'text-fuchsia-500' },
  code: { label: 'Code', icon: Code2, tone: 'text-rose-500' },
};

const palette: Array<{ type: AgentWorkflowNodeType; title: string; desc: string }> = [
  { type: 'input', title: '用户输入', desc: '运行参数' },
  { type: 'agent', title: 'Agent', desc: '模型 + 工具' },
  { type: 'tool', title: '工具', desc: 'HTTP / MCP / Skill' },
  { type: 'extractor', title: '提取', desc: 'JSONPath / 函数' },
  { type: 'branch', title: '分支', desc: '条件路由' },
  { type: 'loop', title: '循环', desc: '批量迭代' },
  { type: 'code', title: '代码', desc: '沙盒执行' },
  { type: 'output', title: '输出', desc: '结果发布' },
];

type RunInputDraft = Record<string, string | boolean>;

function toFlowNodes(definition: AgentWorkflowDefinition): FlowNode[] {
  return definition.nodes.map((node) => ({
    id: node.id,
    type: 'default',
    position: node.position,
    data: {
      raw: node,
      label: <WorkflowNodeCard node={node} />,
    },
    className: 'agent-workflow-flow-node',
  }));
}

function toFlowEdges(definition: AgentWorkflowDefinition): FlowEdge[] {
  return definition.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: edge.label === 'score < 0.85',
    markerEnd: { type: 'arrowclosed' },
    className: 'agent-workflow-edge',
  }));
}

function WorkflowNodeCard({ node }: { node: AgentWorkflowNode }) {
  const meta = nodeMeta[node.type];
  const Icon = meta.icon;
  return (
    <div className="agent-workflow-node-card">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <Icon className={cn('h-4 w-4', meta.tone)} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{node.label}</div>
          <div className="font-mono text-[10px] uppercase text-[var(--text-tertiary)]">{meta.label}</div>
        </div>
      </div>
      {node.description && (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">{node.description}</p>
      )}
    </div>
  );
}

function makeNode(type: AgentWorkflowNodeType, index: number): AgentWorkflowNode {
  const meta = nodeMeta[type];
  const id = `${type}_${Date.now().toString(36)}_${index}`;
  return {
    id,
    type,
    label: meta.label,
    description: `${meta.label} node`,
    position: { x: 180 + index * 48, y: 220 + index * 24 },
    data:
      type === 'agent'
        ? { agentId: 'article_auditor', maxIterations: 6, allowedTools: ['kb_search'] }
        : type === 'tool'
          ? { toolCode: 'kb_search', args: { query: '{{ inputs.query }}' } }
          : type === 'extractor'
            ? { mode: 'jsonpath', path: '$.data' }
            : type === 'loop'
              ? { over: '{{ inputs.items }}', maxIterations: 10 }
              : type === 'code'
                ? { language: 'python', sandboxRef: 'disabled-until-sandbox-worker', code: '# pending sandbox-worker' }
                : {},
  };
}

function getRawNode(node: FlowNode | undefined): AgentWorkflowNode | null {
  return (node?.data?.raw as AgentWorkflowNode | undefined) ?? null;
}

function statusTone(status: AgentRunTraceItem['status']) {
  if (status === 'success') return 'text-emerald-500';
  if (status === 'running') return 'text-sky-500';
  if (status === 'failed') return 'text-red-500';
  if (status === 'skipped') return 'text-amber-500';
  return 'text-[var(--text-tertiary)]';
}

function runStatusTone(status: AgentWorkflowRunSummary['status']) {
  if (status === 'success') return 'text-emerald-500';
  if (status === 'running') return 'text-sky-500';
  if (status === 'failed' || status === 'cancelled' || status === 'budget_exceeded') return 'text-red-500';
  if (status === 'paused') return 'text-amber-500';
  return 'text-[var(--text-tertiary)]';
}

function capabilityTone(enabled: boolean) {
  return enabled ? 'text-emerald-500' : 'text-amber-500';
}

function capabilityStateLabel(state: AgentWorkflowCapabilityState) {
  const labels: Record<AgentWorkflowCapabilityState, string> = {
    available: '可用',
    not_connected: '未接入',
    coming_soon: '规划中',
    disabled: '已停用',
    unknown: '状态未知',
  };
  return labels[state];
}

function runModeLabel(mode: AgentWorkflowRunMode) {
  return mode === 'simulate' ? '模拟运行' : '真实运行';
}

function protocolIcon(tool: AgentToolSummary) {
  if (tool.protocol === 'mcp') return Network;
  if (tool.protocol === 'skill') return FlaskConical;
  if (tool.protocol === 'http' || tool.protocol === 'openapi') return Globe2;
  return Database;
}

function hasBackendWorkflowId(id: string | number) {
  return typeof id === 'number' || /^\d+$/.test(String(id));
}

function workflowIdEquals(left: string | number | null | undefined, right: string | number | null | undefined) {
  return left != null && right != null && String(left) === String(right);
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '请求失败');
  }
  return '请求失败';
}

function selectedNodeIdFor(definition: AgentWorkflowDefinition) {
  return definition.nodes.find((node) => node.type === 'agent')?.id ?? definition.nodes[0]?.id ?? null;
}

function isFulfilled<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
  return result.status === 'fulfilled';
}

function traceFromRun(
  definition: AgentWorkflowDefinition,
  runTrace: AgentRunTraceItem[] | undefined,
  status: AgentWorkflowRunSummary['status'],
): AgentRunTraceItem[] {
  if (runTrace?.length) return runTrace;
  if (!shouldShowWorkflowTracePlaceholder(status)) return [];
  return definition.nodes.map((node, index) => ({
    id: `${node.id}:${index}`,
    nodeId: node.id,
    nodeLabel: node.label,
    nodeType: node.type,
    status: 'pending',
    summary: '运行记录已创建，等待执行器回填 trace',
  }));
}

function traceFromLogs(definition: AgentWorkflowDefinition, logs: AgentWorkflowNodeLog[]): AgentRunTraceItem[] {
  const labels = new Map(definition.nodes.map((node) => [node.id, node.label]));
  return logs.map((log) => ({
    id: log.id,
    nodeId: log.nodeId,
    nodeLabel: labels.get(log.nodeId) || log.nodeId,
    nodeType: log.nodeType,
    status: log.status,
    durationMs: log.durationMs,
    startedAt: log.startedAt,
    finishedAt: log.finishedAt,
    summary: log.errorMessage || `#${log.sequence} ${log.status}`,
  }));
}

function defaultInputValue(name: string, spec: AgentWorkflowInputSpec): string | boolean {
  if (spec.type === 'boolean') return false;
  if (spec.type === 'integer' || spec.type === 'number') return name === 'post_id' ? '171' : '';
  if (spec.type === 'object') return '{}';
  if (spec.type.startsWith('array')) return '[]';
  return '';
}

function initialRunInputs(definition: AgentWorkflowDefinition): RunInputDraft {
  return Object.fromEntries(
    Object.entries(definition.inputs || {}).map(([name, spec]) => [name, defaultInputValue(name, spec)]),
  );
}

function normalizeRunInputs(definition: AgentWorkflowDefinition, draft: RunInputDraft): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(definition.inputs || {})) {
    const value = draft[name];
    const text = typeof value === 'boolean' ? String(value) : String(value ?? '').trim();
    if (spec.required && text === '') {
      throw new Error(`运行输入 ${name} 不能为空`);
    }
    if (text === '') continue;

    if (spec.type === 'boolean') {
      inputs[name] = value === true || text === 'true';
    } else if (spec.type === 'integer') {
      const parsed = Number.parseInt(text, 10);
      if (!Number.isFinite(parsed)) throw new Error(`运行输入 ${name} 必须是整数`);
      inputs[name] = parsed;
    } else if (spec.type === 'number') {
      const parsed = Number.parseFloat(text);
      if (!Number.isFinite(parsed)) throw new Error(`运行输入 ${name} 必须是数字`);
      inputs[name] = parsed;
    } else if (spec.type === 'object' || spec.type === 'array' || spec.type === 'array[object]') {
      try {
        inputs[name] = JSON.parse(text);
      } catch {
        throw new Error(`运行输入 ${name} 必须是合法 JSON`);
      }
    } else if (spec.type === 'array[string]') {
      try {
        inputs[name] = text.startsWith('[')
          ? JSON.parse(text)
          : text.split(',').map((item) => item.trim()).filter(Boolean);
      } catch {
        throw new Error(`运行输入 ${name} 必须是合法 JSON 数组`);
      }
    } else if (spec.type === 'array[number]' || spec.type === 'array[boolean]') {
      try {
        inputs[name] = JSON.parse(text);
      } catch {
        throw new Error(`运行输入 ${name} 必须是合法 JSON 数组`);
      }
    } else {
      inputs[name] = text;
    }
  }
  return inputs;
}

export default function AgentWorkflowsPage() {
  const [bundle, setBundle] = useState<AgentWorkflowBundle>(() => loadLocalAgentWorkflowBundle());
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | number>(() => bundle.activeWorkflowId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('audit_agent');
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(bundle.activeDefinition));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(bundle.activeDefinition));
  const [runInputs, setRunInputs] = useState<RunInputDraft>(() => initialRunInputs(bundle.activeDefinition));
  const [query, setQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const [capabilities, setCapabilities] = useState(defaultAgentWorkflowCapabilities);
  const [runMode, setRunMode] = useState<AgentWorkflowRunMode>(defaultAgentWorkflowCapabilities.defaultRunMode);
  const [toolArgsDrafts, setToolArgsDrafts] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<AgentWorkflowTemplateSummary[]>([]);
  const [versions, setVersions] = useState<AgentWorkflowVersionSummary[]>([]);
  const [metrics, setMetrics] = useState<AgentWorkflowMetrics | null>(null);
  const [isRuntimeActionBusy, setIsRuntimeActionBusy] = useState(false);
  const [entryPhase, setEntryPhase] = useState<WorkflowEntryPhase>('goal');
  const [goalDraft, setGoalDraft] = useState('');
  const [selectedGoalKey, setSelectedGoalKey] = useState<WorkflowGoalStarter['key'] | null>(null);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<AgentWorkflowRunSummary['id'] | null>(
    () => bundle.runHistory[0]?.id ?? null,
  );
  const activeWorkflowIdRef = useRef<string | number>(bundle.activeWorkflowId);
  const workflowSelectionRequestRef = useRef(0);
  const selectedRunIdRef = useRef<AgentWorkflowRunSummary['id'] | null>(bundle.runHistory[0]?.id ?? null);

  const selectedNode = useMemo(
    () => getRawNode(nodes.find((node) => node.id === selectedNodeId)),
    [nodes, selectedNodeId],
  );
  const selectedToolArgsText =
    selectedNode?.type === 'tool'
      ? (toolArgsDrafts[selectedNode.id] ?? JSON.stringify(selectedNode.data.args || {}, null, 2))
      : '';

  const activeWorkflow = useMemo(
    () => bundle.workflows.find((workflow) => workflowIdEquals(workflow.id, activeWorkflowId)) ?? bundle.workflows[0],
    [activeWorkflowId, bundle.workflows],
  );

  const capabilityItems = useMemo(
    () => [
      capabilities.realLLM,
      capabilities.realTools,
      capabilities.sandbox,
      capabilities.scheduler,
      capabilities.autonomous,
    ],
    [capabilities],
  );
  const unavailableCapabilityCount = capabilityItems.filter((item) => !item.enabled).length;
  const unknownCapabilityCount = capabilityItems.filter((item) => item.state === 'unknown').length;
  const trueRuntimeReady = isWorkflowExecutionReady(capabilities);
  const selectedRun = useMemo(
    () => selectWorkflowRun(bundle.runHistory, selectedRunId),
    [bundle.runHistory, selectedRunId],
  );
  const workflowRunActions = useMemo(
    () => buildWorkflowRunActions(selectedRun),
    [selectedRun],
  );
  const selectedGoal = WORKFLOW_GOAL_STARTERS.find((starter) => starter.key === selectedGoalKey) ?? null;
  const selectedTemplate = templates.find((template) => template.templateKey === selectedTemplateKey) ?? null;
  const entryAction = getWorkflowEntryAction(entryPhase, goalDraft.trim().length > 0);
  const activeWorkflowTruth = activeWorkflow ? getWorkflowTruth(activeWorkflow) : null;
  const activeRunTruth = getRunTruth({ hasRun: Boolean(selectedRun), simulated: selectedRun?.simulated });
  const reviewSteps = selectedTemplate
    ? selectedTemplate.definition.nodes.slice(0, 6).map((node) => node.label)
    : selectedGoal?.steps ?? ['确认内容范围与运行输入', '选择需要使用的资料与工具', '设置判断条件与人工确认点', '生成可审阅的结果'];
  const reviewBoundaries = selectedTemplate
    ? ['载入模板只会更新当前草稿，不会自动发布', '真实运行仍需通过能力检查，并使用明确的运行输入']
    : selectedGoal?.boundaries ?? ['不会因为描述了目标就创建后端运行', '进入画布后仍需确认每个节点、工具和发布状态'];

  useEffect(() => {
    setSelectedRunId((current) => {
      const next = resolveSelectedRunId(bundle.runHistory, current);
      selectedRunIdRef.current = next;
      return next;
    });
  }, [bundle.runHistory]);

  const refreshRunHistory = async (workflowId: string | number) => {
    if (!workflowIdEquals(workflowId, activeWorkflowIdRef.current)) return;
    if (!hasBackendWorkflowId(workflowId)) {
      selectedRunIdRef.current = null;
      setSelectedRunId(null);
      setBundle((current) => ({ ...current, runHistory: [] }));
      return;
    }
    const response = await agentWorkflowService.listRuns(workflowId, 50);
    if (!workflowIdEquals(workflowId, activeWorkflowIdRef.current)) return;
    setBundle((current) => {
      const next = { ...current, runHistory: response.data || [] };
      saveLocalAgentWorkflowBundle(next);
      return next;
    });
  };

  const refreshWorkflowMeta = async (workflowId: string | number) => {
    if (!workflowIdEquals(workflowId, activeWorkflowIdRef.current)) return;
    if (!hasBackendWorkflowId(workflowId)) {
      setVersions([]);
      setMetrics(null);
      return;
    }
    try {
      const [versionResult, metricResult] = await Promise.all([
        agentWorkflowService.listVersions(workflowId),
        agentWorkflowService.metrics(workflowId),
      ]);
      if (!workflowIdEquals(workflowId, activeWorkflowIdRef.current)) return;
      setVersions(versionResult.data || []);
      setMetrics(metricResult.data || null);
    } catch {
      if (!workflowIdEquals(workflowId, activeWorkflowIdRef.current)) return;
      setVersions([]);
      setMetrics(null);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      setIsHydrating(true);
      const current = loadLocalAgentWorkflowBundle();
      try {
        const [capabilityResult, workflowResult, toolResult, agentResult, scheduleResult, templateResult] = await Promise.allSettled([
          agentWorkflowService.getCapabilities(),
          agentWorkflowService.listWorkflows(),
          agentWorkflowService.listTools(),
          agentWorkflowService.listAgents(),
          agentWorkflowService.listSchedules(),
          agentWorkflowService.listTemplates(),
        ]);
        if (cancelled) return;

        const nextCapabilities =
          isFulfilled(capabilityResult) && capabilityResult.value.data
            ? capabilityResult.value.data
            : unknownAgentWorkflowCapabilities;
        const nextRunMode = isAgentWorkflowRunMode(nextCapabilities.defaultRunMode)
          ? nextCapabilities.defaultRunMode
          : defaultAgentWorkflowCapabilities.defaultRunMode;
        const workflows = isFulfilled(workflowResult) && workflowResult.value.data?.length
          ? mergeBackendAndLocalWorkflowSummaries(workflowResult.value.data, current.workflows)
          : current.workflows;
        const tools = isFulfilled(toolResult) && toolResult.value.data?.length ? toolResult.value.data : current.tools;
        const agents = isFulfilled(agentResult) && agentResult.value.data?.length ? agentResult.value.data : current.agents;
        const schedules = isFulfilled(scheduleResult) ? scheduleResult.value.data || [] : current.schedules;
        const nextTemplates = isFulfilled(templateResult) ? templateResult.value.data || [] : [];
        const nextActiveWorkflow = workflows.find((workflow) =>
          workflowIdEquals(workflow.id, current.activeWorkflowId),
        ) ?? workflows[0];
        const nextActiveWorkflowId = nextActiveWorkflow?.id ?? current.activeWorkflowId;
        let activeDefinition = getLocalAgentWorkflowDefinition(current, nextActiveWorkflowId)
          ?? current.activeDefinition;

        if (hasBackendWorkflowId(nextActiveWorkflowId)) {
          try {
            const detail = await agentWorkflowService.getWorkflow(nextActiveWorkflowId);
            if (!cancelled && detail.data?.definition) {
              activeDefinition = detail.data.definition;
            }
          } catch {
            activeDefinition = current.activeDefinition;
          }
        }

        if (cancelled) return;
        let runHistory = current.runHistory;
        let nextVersions: AgentWorkflowVersionSummary[] = [];
        let nextMetrics: AgentWorkflowMetrics | null = null;
        if (hasBackendWorkflowId(nextActiveWorkflowId)) {
          try {
            const [runResult, versionResult, metricResult] = await Promise.all([
              agentWorkflowService.listRuns(nextActiveWorkflowId, 50),
              agentWorkflowService.listVersions(nextActiveWorkflowId),
              agentWorkflowService.metrics(nextActiveWorkflowId),
            ]);
            if (!cancelled) {
              runHistory = runResult.data || [];
              nextVersions = versionResult.data || [];
              nextMetrics = metricResult.data || null;
            }
          } catch {
            runHistory = current.runHistory;
          }
        }
        if (cancelled) return;
        const next: AgentWorkflowBundle = {
          ...current,
          workflows,
          tools,
          agents,
          schedules,
          runHistory,
          activeWorkflowId: nextActiveWorkflowId,
          activeDefinition,
        };
        setBundle(next);
        setNodes(toFlowNodes(activeDefinition));
        setEdges(toFlowEdges(activeDefinition));
        setCapabilities(nextCapabilities);
        setRunMode(nextRunMode);
        setTemplates(nextTemplates);
        setVersions(nextVersions);
        setMetrics(nextMetrics);
        activeWorkflowIdRef.current = nextActiveWorkflowId;
        setActiveWorkflowId(nextActiveWorkflowId);
        setRunInputs(initialRunInputs(activeDefinition));
        setSelectedNodeId(selectedNodeIdFor(activeDefinition));
        saveLocalAgentWorkflowBundle(next);
      } catch {
        if (!cancelled) {
          setCapabilities(unknownAgentWorkflowCapabilities);
          setRunMode('simulate');
          toast.error('智能体编排后端数据加载失败，已继续使用本地草稿');
        }
      } finally {
        if (!cancelled) setIsHydrating(false);
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [setEdges, setNodes]);

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bundle.tools;
    return bundle.tools.filter((tool) => {
      return (
        tool.code.toLowerCase().includes(q) ||
        tool.displayName.toLowerCase().includes(q) ||
        tool.protocol.toLowerCase().includes(q)
      );
    });
  }, [bundle.tools, query]);

  const handleConnect = (connection: Connection) => {
    setEdges((eds) =>
      addEdge(
        {
          ...connection,
          animated: false,
          className: 'agent-workflow-edge',
          markerEnd: { type: 'arrowclosed' },
        },
        eds,
      ),
    );
  };

  const addNode = (type: AgentWorkflowNodeType) => {
    const raw = makeNode(type, nodes.length + 1);
    setNodes((current) => [
      ...current,
      {
        id: raw.id,
        type: 'default',
        position: raw.position,
        data: { raw, label: <WorkflowNodeCard node={raw} /> },
        className: 'agent-workflow-flow-node',
      },
    ]);
    setSelectedNodeId(raw.id);
  };

  const updateSelectedNode = (patch: Partial<AgentWorkflowNode>) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== selectedNodeId) return node;
        const raw = getRawNode(node);
        if (!raw) return node;
        const nextRaw = { ...raw, ...patch, data: patch.data ?? raw.data };
        return {
          ...node,
          data: {
            ...node.data,
            raw: nextRaw,
            label: <WorkflowNodeCard node={nextRaw} />,
          },
        };
      }),
    );
  };

  const updateSelectedNodeData = (key: string, value: unknown) => {
    if (!selectedNode) return;
    updateSelectedNode({
      data: {
        ...selectedNode.data,
        [key]: value,
      },
    });
  };

  const buildDefinition = (): AgentWorkflowDefinition => {
    const rawNodes = nodes.map((node) => {
      const raw = getRawNode(node);
      return {
        ...(raw || makeNode('tool', 0)),
        id: node.id,
        position: node.position,
      };
    });
    return {
      ...bundle.activeDefinition,
      nodes: rawNodes,
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: typeof edge.label === 'string' ? edge.label : undefined,
      })),
    };
  };

  const applyActiveDefinition = (definition: AgentWorkflowDefinition) => {
    setNodes(toFlowNodes(definition));
    setEdges(toFlowEdges(definition));
    setRunInputs(initialRunInputs(definition));
    setSelectedNodeId(selectedNodeIdFor(definition));
    setToolArgsDrafts({});
  };

  const snapshotActiveLocalDraft = () => {
    if (hasBackendWorkflowId(activeWorkflowId)) return bundle;
    const definition = buildDefinition();
    const stored = storeLocalAgentWorkflowDefinition(bundle, activeWorkflowId, definition);
    const next: AgentWorkflowBundle = {
      ...stored,
      activeWorkflowId,
      activeDefinition: definition,
      workflows: stored.workflows.map((workflow) =>
        workflowIdEquals(workflow.id, activeWorkflowId)
          ? {
              ...workflow,
              name: definition.name,
              description: definition.description,
              mode: definition.mode,
              nodeCount: definition.nodes.length,
              updatedAt: new Date().toISOString(),
            }
          : workflow,
      ),
    };
    setBundle(next);
    saveLocalAgentWorkflowBundle(next);
    return next;
  };

  const selectWorkflow = async (workflow: AgentWorkflowSummary) => {
    const selectionRequest = workflowSelectionRequestRef.current + 1;
    workflowSelectionRequestRef.current = selectionRequest;
    const current = snapshotActiveLocalDraft();
    if (workflowIdEquals(workflow.id, activeWorkflowId)) return true;

    if (!hasBackendWorkflowId(workflow.id)) {
      const localDefinition = getLocalAgentWorkflowDefinition(current, workflow.id) ?? {
        ...defaultAgentWorkflowDefinition,
        name: workflow.name,
        mode: workflow.mode,
        description: workflow.description || defaultAgentWorkflowDefinition.description,
      };
      const stored = storeLocalAgentWorkflowDefinition(current, workflow.id, localDefinition);
      const next: AgentWorkflowBundle = {
        ...stored,
        activeWorkflowId: workflow.id,
        activeDefinition: localDefinition,
        runHistory: [],
      };
      selectedRunIdRef.current = null;
      setSelectedRunId(null);
      activeWorkflowIdRef.current = workflow.id;
      setActiveWorkflowId(workflow.id);
      applyActiveDefinition(localDefinition);
      setBundle(next);
      saveLocalAgentWorkflowBundle(next);
      setVersions([]);
      setMetrics(null);
      return true;
    }

    setIsHydrating(true);
    setVersions([]);
    setMetrics(null);
    try {
      const detail = await agentWorkflowService.getWorkflow(workflow.id);
      if (selectionRequest !== workflowSelectionRequestRef.current) return false;
      if (!detail.data?.definition) {
        throw new Error('后端未返回工作流定义');
      }
      const definition = detail.data.definition;
      const next: AgentWorkflowBundle = {
        ...current,
        activeWorkflowId: workflow.id,
        activeDefinition: definition,
        runHistory: [],
      };
      selectedRunIdRef.current = null;
      setSelectedRunId(null);
      activeWorkflowIdRef.current = workflow.id;
      setActiveWorkflowId(workflow.id);
      applyActiveDefinition(definition);
      setBundle(next);
      saveLocalAgentWorkflowBundle(next);
      void refreshRunHistory(workflow.id);
      void refreshWorkflowMeta(workflow.id);
      return true;
    } catch (error) {
      if (selectionRequest !== workflowSelectionRequestRef.current) return false;
      toast.error(`工作流加载失败：${errorMessage(error)}`);
      return false;
    } finally {
      if (selectionRequest === workflowSelectionRequestRef.current) setIsHydrating(false);
    }
  };

  const persistDraft = async () => {
    const activeIndex = bundle.workflows.findIndex((workflow) => workflowIdEquals(workflow.id, activeWorkflowId));
    const workflowIndex = activeIndex >= 0 ? activeIndex : 0;
    const primary = bundle.workflows[workflowIndex];
    const definition = buildDefinition();
    const draft: AgentWorkflowBundle = {
      ...bundle,
      activeWorkflowId: primary.id,
      activeDefinition: definition,
      workflows: bundle.workflows.map((wf, index) =>
        index === workflowIndex
          ? {
              ...wf,
              nodeCount: nodes.length,
              updatedAt: new Date().toISOString(),
            }
        : wf,
      ),
    };
    const next = storeLocalAgentWorkflowDefinition(draft, primary.id, definition);
    setBundle(next);
    saveLocalAgentWorkflowBundle(next);
    const response = hasBackendWorkflowId(primary.id)
      ? await agentWorkflowService.updateWorkflow(primary.id, next.activeDefinition)
      : await agentWorkflowService.createWorkflow(next.activeDefinition);
    const saved = response.data;
    if (!saved?.definition) {
      throw new Error('后端没有返回已保存的工作流');
    }

    const promoted = hasBackendWorkflowId(primary.id)
      ? next
      : removeLocalAgentWorkflowDraft(next, primary.id);

    const synced: AgentWorkflowBundle = {
      ...promoted,
      activeWorkflowId: saved.id,
      activeDefinition: saved.definition,
      workflows: next.workflows.map((workflow, index) =>
        index === workflowIndex
          ? {
              ...workflow,
              id: saved.id,
              name: saved.name,
              description: saved.description,
              version: saved.version,
              nodeCount: saved.nodeCount,
              runCount: saved.runCount,
              updatedAt: saved.updatedAt,
              published: saved.published,
            }
          : workflow,
      ),
    };
    activeWorkflowIdRef.current = saved.id;
    setActiveWorkflowId(saved.id);
    setBundle(synced);
    saveLocalAgentWorkflowBundle(synced);
    return synced;
  };

  const saveDraft = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await persistDraft();
      toast.success('智能体编排草稿已保存并同步');
    } catch (error) {
      toast.error(`后端同步失败，本地草稿已保留：${errorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const resetDraft = () => {
    const reset: AgentWorkflowBundle = {
      ...bundle,
      activeWorkflowId,
      activeDefinition: defaultAgentWorkflowDefinition,
      workflows: bundle.workflows.map((workflow) =>
        workflowIdEquals(workflow.id, activeWorkflowId)
          ? {
              ...workflow,
              name: defaultAgentWorkflowDefinition.name,
              description: defaultAgentWorkflowDefinition.description,
              mode: defaultAgentWorkflowDefinition.mode,
              nodeCount: defaultAgentWorkflowDefinition.nodes.length,
              updatedAt: new Date().toISOString(),
            }
          : workflow,
      ),
    };
    const next = storeLocalAgentWorkflowDefinition(reset, activeWorkflowId, defaultAgentWorkflowDefinition);
    setBundle(next);
    applyActiveDefinition(defaultAgentWorkflowDefinition);
    saveLocalAgentWorkflowBundle(next);
    toast.success('已恢复默认编排');
  };

  const simulateRun = async () => {
    if (isRunning) return;
    setIsRunning(true);
    try {
      const runDefinition = buildDefinition();
      const inputs = normalizeRunInputs(runDefinition, runInputs);
      const simulateExternal = runMode === 'simulate';
      const synced = await persistDraft();
      const workflowId = synced.workflows.find((workflow) =>
        workflowIdEquals(workflow.id, synced.activeWorkflowId),
      )?.id;
      if (workflowId == null) {
        throw new Error('没有可运行的工作流');
      }
      const response = await agentWorkflowService.startRun(
        workflowId,
        inputs,
        simulateExternal,
        {
          sourceType: 'canvas',
          redactionPolicy: runMode === 'real' ? 'manual' : 'auto',
          maxNodes: 200,
          maxDurationMs: 15 * 60 * 1000,
        },
      );
      const run = response.data;
      if (!run) {
        throw new Error('后端没有返回运行记录');
      }
      const nextTrace = traceFromRun(synced.activeDefinition, run.trace, run.status);
      selectedRunIdRef.current = run.id;
      setSelectedRunId(run.id);
      setBundle((current) => {
        const next: AgentWorkflowBundle = {
          ...current,
          trace: nextTrace,
          workflows: current.workflows.map((workflow) =>
            workflowIdEquals(workflow.id, workflowId)
              ? {
                  ...workflow,
                  runCount: workflow.runCount + 1,
                  lastRunAt: new Date().toISOString(),
                }
              : workflow,
          ),
          runHistory: [run, ...current.runHistory.filter((item) => !workflowIdEquals(item.id, run.id))].slice(0, 50),
        };
        saveLocalAgentWorkflowBundle(next);
        return next;
      });
      if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'budget_exceeded') {
        toast.error(`${runModeLabel(runMode)}失败：${run.errorMessage || '执行器返回失败状态'}`);
      } else if (run.status === 'paused') {
        toast.warning(`${runModeLabel(runMode)}：${workflowRunStatusLabel(run.status)}`);
      } else {
        toast.success(`${runModeLabel(runMode)}：${workflowRunStatusLabel(run.status)}`);
      }
      if (workflowId != null) {
        void refreshRunHistory(workflowId);
        void refreshWorkflowMeta(workflowId);
      }
    } catch (error) {
      toast.error(`${runModeLabel(runMode)}失败：${errorMessage(error)}`);
    } finally {
      setIsRunning(false);
    }
  };

  const togglePublication = async () => {
    if (isPublishing) return;
    setIsPublishing(true);
    try {
      if (activeWorkflow?.published && hasBackendWorkflowId(activeWorkflow.id)) {
        await agentWorkflowService.unpublishWorkflow(activeWorkflow.id);
        setBundle((current) => {
          const next: AgentWorkflowBundle = {
            ...current,
            workflows: current.workflows.map((workflow) =>
              workflowIdEquals(workflow.id, activeWorkflow.id) ? { ...workflow, published: false } : workflow,
            ),
          };
          saveLocalAgentWorkflowBundle(next);
          return next;
        });
        toast.success('已停用发布入口');
        return;
      }

      const synced = await persistDraft();
      const workflow = synced.workflows.find((item) =>
        workflowIdEquals(item.id, synced.activeWorkflowId),
      );
      if (!workflow || !hasBackendWorkflowId(workflow.id)) {
        throw new Error('请先保存为后端工作流');
      }
      const response = await agentWorkflowService.publishWorkflow(workflow.id, {
        displayName: synced.activeDefinition.name,
        description: synced.activeDefinition.description,
      });
      const publication = response.data;
      if (!publication?.slug) {
        throw new Error('后端没有返回可用的发布入口');
      }
      setBundle((current) => {
        const next: AgentWorkflowBundle = {
          ...current,
          workflows: current.workflows.map((item) =>
            workflowIdEquals(item.id, workflow.id) ? { ...item, published: true } : item,
          ),
        };
        saveLocalAgentWorkflowBundle(next);
        return next;
      });
      toast.success(`已发布：/${publication.slug}`);
    } catch (error) {
      toast.error(`发布状态更新失败：${errorMessage(error)}`);
    } finally {
      setIsPublishing(false);
    }
  };

  const inspectRun = async (run: AgentWorkflowRunSummary) => {
    selectedRunIdRef.current = run.id;
    setSelectedRunId(run.id);
    setBundle((current) => {
      const next = { ...current, trace: traceFromRun(current.activeDefinition, run.trace, run.status) };
      saveLocalAgentWorkflowBundle(next);
      return next;
    });
    if (!hasBackendWorkflowId(run.id)) return;
    try {
      const detail = await agentWorkflowService.getRun(run.id);
      if (!isWorkflowRunSelected(run.id, selectedRunIdRef.current)) return;
      const runDetail = detail.data;
      if (!runDetail) {
        throw new Error('后端没有返回运行详情');
      }
      const logs = runDetail.logs || [];
      const nextTrace = logs.length
        ? traceFromLogs(bundle.activeDefinition, logs)
        : traceFromRun(bundle.activeDefinition, runDetail.trace, runDetail.status);
      setBundle((current) => {
        const next = {
          ...current,
          trace: nextTrace,
          runHistory: current.runHistory.map((item) => workflowIdEquals(item.id, runDetail.id) ? runDetail : item),
        };
        saveLocalAgentWorkflowBundle(next);
        return next;
      });
      toast.success(`已加载运行记录 #${run.id}`);
    } catch (error) {
      toast.error(`运行记录加载失败：${errorMessage(error)}`);
    }
  };

  const updateRunInBundle = (run: AgentWorkflowRunSummary) => {
    setBundle((current) => {
      const exists = current.runHistory.some((item) => workflowIdEquals(item.id, run.id));
      const next: AgentWorkflowBundle = {
        ...current,
        runHistory: exists
          ? current.runHistory.map((item) => workflowIdEquals(item.id, run.id) ? run : item)
          : [run, ...current.runHistory].slice(0, 50),
      };
      saveLocalAgentWorkflowBundle(next);
      return next;
    });
  };

  const runRuntimeAction = async (action: WorkflowRunAction) => {
    const operation = workflowRunActions.find((item) => item.action === action);
    if (!selectedRun || !operation?.visible || operation.disabled || isRuntimeActionBusy) return;
    if (!workflowIdEquals(selectedRun.id, operation.targetRunId)) return;
    setIsRuntimeActionBusy(true);
    try {
      if (action === 'canonicalize') {
        const response = await agentWorkflowService.canonicalizeRun(operation.targetRunId);
        if (!response.data?.definition) {
          throw new Error('后端没有返回可编辑的回放草稿');
        }
        const replayDraft = response.data;
        applyActiveDefinition(replayDraft.definition);
        selectedRunIdRef.current = null;
        setSelectedRunId(null);
        activeWorkflowIdRef.current = replayDraft.id;
        setActiveWorkflowId(replayDraft.id);
        setBundle((current) => {
          const next: AgentWorkflowBundle = {
            ...current,
            activeWorkflowId: replayDraft.id,
            activeDefinition: replayDraft.definition,
            workflows: [replayDraft, ...current.workflows.filter((workflow) => !workflowIdEquals(workflow.id, replayDraft.id))],
            runHistory: [],
          };
          saveLocalAgentWorkflowBundle(next);
          return next;
        });
        void refreshWorkflowMeta(replayDraft.id);
        toast.success('已生成运行结果回放草稿，请核对节点后再运行');
        return;
      }
      const response =
        action === 'cancel'
          ? await agentWorkflowService.cancelRun(operation.targetRunId)
          : action === 'retry'
            ? await agentWorkflowService.retryRun(operation.targetRunId, true)
            : await agentWorkflowService.resumeRun(operation.targetRunId, selectedRun.currentNode);
      const updatedRun = response.data;
      if (!updatedRun) {
        throw new Error('后端没有返回更新后的运行状态');
      }
      updateRunInBundle(updatedRun);
      if (isWorkflowRunSelected(operation.targetRunId, selectedRunIdRef.current)) {
        selectedRunIdRef.current = updatedRun.id;
        setSelectedRunId(updatedRun.id);
      }
      toast.success(`运行 #${updatedRun.id} 已更新为“${workflowRunStatusLabel(updatedRun.status)}”`);
      if (activeWorkflow?.id) {
        void refreshRunHistory(activeWorkflow.id);
        void refreshWorkflowMeta(activeWorkflow.id);
      }
    } catch (error) {
      toast.error(`运行操作失败：${errorMessage(error)}`);
    } finally {
      setIsRuntimeActionBusy(false);
    }
  };

  const activateEntryDraft = (
    current: AgentWorkflowBundle,
    workflowId: string,
    sourceKey: string,
    definition: AgentWorkflowDefinition,
  ) => {
    const updatedAt = new Date().toISOString();
    const summary: AgentWorkflowSummary = {
      id: workflowId,
      name: definition.name,
      description: definition.description,
      mode: definition.mode,
      version: 1,
      nodeCount: definition.nodes.length,
      runCount: 0,
      updatedAt,
      published: false,
    };
    const hasEntryDraft = current.workflows.some((workflow) =>
      workflowIdEquals(workflow.id, workflowId),
    );
    const workflows = hasEntryDraft
      ? current.workflows.map((workflow) =>
          workflowIdEquals(workflow.id, workflowId) ? summary : workflow,
        )
      : [summary, ...current.workflows];
    const stored = storeLocalAgentWorkflowDefinition(current, workflowId, definition);
    const next: AgentWorkflowBundle = {
      ...stored,
      workflows,
      activeWorkflowId: workflowId,
      activeDefinition: definition,
      entryDraftSourceKeys: {
        ...stored.entryDraftSourceKeys,
        [workflowId]: sourceKey,
      },
      runHistory: [],
    };

    activeWorkflowIdRef.current = workflowId;
    setActiveWorkflowId(workflowId);
    applyActiveDefinition(definition);
    setBundle(next);
    saveLocalAgentWorkflowBundle(next);
    setVersions([]);
    setMetrics(null);
  };

  const openEntryDraft = (
    sourceKey: string,
    createDefinition: () => AgentWorkflowDefinition,
  ) => {
    const current = snapshotActiveLocalDraft();
    const workflowId = resolveWorkflowEntryDraftId(sourceKey, current.entryDraftSourceKeys);
    const existingDefinition = getLocalAgentWorkflowDefinition(current, workflowId);
    activateEntryDraft(current, workflowId, sourceKey, existingDefinition ?? createDefinition());
    return Boolean(existingDefinition);
  };

  const applyTemplate = (template: AgentWorkflowTemplateSummary) => {
    const sourceKey = buildWorkflowEntrySourceKey({
      kind: 'template',
      templateKey: template.templateKey,
    });
    const restored = openEntryDraft(sourceKey, () => template.definition);
    toast.success(restored ? `已恢复模板草稿：${template.title}` : `已载入模板：${template.title}`);
  };

  const chooseGoalStarter = (starter: WorkflowGoalStarter) => {
    setSelectedGoalKey(starter.key);
    setSelectedTemplateKey(null);
    setGoalDraft(starter.goal);
    setEntryPhase('goal');
  };

  const chooseBackendTemplate = (template: AgentWorkflowTemplateSummary) => {
    setSelectedGoalKey(null);
    setSelectedTemplateKey(template.templateKey);
    setGoalDraft(template.description || template.title);
    setEntryPhase('goal');
  };

  const advanceGoalEntry = () => {
    if (entryAction.disabled) return;
    if (entryAction.nextPhase === 'review') {
      setEntryPhase('review');
      return;
    }
    if (entryAction.nextPhase === 'canvas') {
      if (selectedTemplate) {
        applyTemplate(selectedTemplate);
      } else {
        const draftName = selectedGoal?.kicker || goalDraft.trim().slice(0, 28) || '自定义任务草稿';
        const sourceKey = buildWorkflowEntrySourceKey({
          kind: 'goal',
          goal: goalDraft,
          steps: reviewSteps,
          boundaries: reviewBoundaries,
        });
        const restored = openEntryDraft(sourceKey, () => buildWorkflowDefinitionFromGoal({
          name: draftName,
          goal: goalDraft,
          steps: reviewSteps,
          boundaries: reviewBoundaries,
        }));
        toast.success(restored ? '已恢复这个目标的本地草稿' : '已根据执行草案创建本地工作流草稿');
      }
      setEntryPhase('canvas');
    }
  };

  const continueWorkflow = async (workflow: AgentWorkflowSummary) => {
    const opened = await selectWorkflow(workflow);
    if (opened) setEntryPhase('canvas');
  };

  const returnToEntryReview = () => {
    snapshotActiveLocalDraft();
    setEntryPhase('review');
  };

  const exportActiveWorkflow = async () => {
    if (!activeWorkflow || !hasBackendWorkflowId(activeWorkflow.id)) {
      toast.error('请先保存后再导出');
      return;
    }
    try {
      const response = await agentWorkflowService.exportWorkflow(activeWorkflow.id);
      if (!response.data?.definition) {
        throw new Error('后端没有返回可导出的工作流定义');
      }
      if (!navigator.clipboard) {
        throw new Error('当前浏览器不支持复制到剪贴板');
      }
      await navigator.clipboard.writeText(JSON.stringify(response.data.definition, null, 2));
      toast.success('工作流 JSON 已复制');
    } catch (error) {
      toast.error(`导出失败：${errorMessage(error)}`);
    }
  };

  const rollbackLatestVersion = async () => {
    if (!activeWorkflow || !hasBackendWorkflowId(activeWorkflow.id) || versions.length < 2) return;
    const previous = versions[1];
    try {
      const response = await agentWorkflowService.rollbackVersion(activeWorkflow.id, previous.version);
      const rolledBack = response.data;
      if (!rolledBack?.definition) {
        throw new Error('后端没有返回回滚后的工作流');
      }
      applyActiveDefinition(rolledBack.definition);
      setBundle((current) => {
        const next = {
          ...current,
          activeDefinition: rolledBack.definition,
          workflows: current.workflows.map((workflow) =>
            workflowIdEquals(workflow.id, rolledBack.id) ? rolledBack : workflow,
          ),
        };
        saveLocalAgentWorkflowBundle(next);
        return next;
      });
      toast.success(`已回滚到 v${previous.version}`);
      void refreshWorkflowMeta(activeWorkflow.id);
    } catch (error) {
      toast.error(`回滚失败：${errorMessage(error)}`);
    }
  };

  const testTool = async (tool: AgentToolSummary) => {
    try {
      const response = await agentWorkflowService.testTool(tool.code, tool.code === 'text_join' ? { items: ['Aether', 'Blog'], separator: ' ' } : {});
      const feedback = workflowToolTestFeedback(response.data);
      const message = `${tool.displayName}：${feedback.message}`;
      if (feedback.tone === 'success') toast.success(message);
      else if (feedback.tone === 'warning') toast.warning(message);
      else toast.error(message);
    } catch (error) {
      toast.error(`工具测试失败：${errorMessage(error)}`);
    }
  };

  if (entryPhase !== 'canvas') {
    return (
      <WorkflowGoalEntry
        phase={entryPhase}
        goal={goalDraft}
        onGoalChange={(value) => {
          setGoalDraft(value);
          setSelectedGoalKey(null);
          setSelectedTemplateKey(null);
          if (entryPhase === 'review') setEntryPhase('goal');
        }}
        selectedGoalKey={selectedGoalKey}
        selectedTemplateKey={selectedTemplateKey}
        selectedGoal={selectedGoal}
        selectedTemplate={selectedTemplate}
        action={entryAction}
        steps={reviewSteps}
        boundaries={reviewBoundaries}
        workflows={bundle.workflows}
        templates={templates}
        activeWorkflowTruth={activeWorkflowTruth}
        activeRunTruth={activeRunTruth}
        isHydrating={isHydrating}
        onChooseGoal={chooseGoalStarter}
        onChooseTemplate={chooseBackendTemplate}
        onAdvance={advanceGoalEntry}
        onEdit={() => setEntryPhase('goal')}
        onContinueWorkflow={(workflow) => void continueWorkflow(workflow)}
      />
    );
  }

  return (
    <div className="agent-workflows-page min-h-0 min-w-0 overflow-auto pb-4 xl:h-[calc(100dvh-6rem)] xl:overflow-hidden">
      <div className="grid min-h-0 grid-cols-1 gap-3 xl:h-full xl:grid-cols-[280px_minmax(0,1fr)_330px]">
        <aside className="surface-raised flex max-h-[460px] min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] xl:max-h-none">
          <div className="border-b border-[var(--border-subtle)] p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--ink-primary)] text-[var(--bg-void)]">
                <Route className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-base font-bold text-[var(--text-primary)]">智能体编排</h1>
                <p className="text-xs text-[var(--text-muted)]">Agent Workflow Canvas</p>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <SectionTitle icon={Workflow} title="工作流" />
            <div className="space-y-2">
              {bundle.workflows.map((workflow) => {
                const isActive = workflowIdEquals(workflow.id, activeWorkflow?.id);
                return (
                <button
                  key={workflow.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => void selectWorkflow(workflow)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                    isActive
                      ? 'border-[var(--ink-primary)] bg-[var(--ink-primary)] text-[var(--bg-void)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{workflow.name}</span>
                    <span className="flex shrink-0 items-center gap-1 font-mono text-[10px]">
                      {workflow.published && <Globe2 className="h-3 w-3" />}
                      v{workflow.version}
                    </span>
                  </div>
                  <p className={cn('mt-1 line-clamp-2 text-xs', isActive ? 'text-white/70' : 'text-[var(--text-muted)]')}>
                    {workflow.description}
                  </p>
                </button>
                );
              })}
            </div>

            {templates.length > 0 && (
              <div className="mt-5">
                <SectionTitle icon={Sparkles} title="模板" />
                <div className="space-y-2">
                  {templates.slice(0, 4).map((template) => (
                    <button
                      key={template.templateKey}
                      type="button"
                      onClick={() => applyTemplate(template)}
                      className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-card-hover)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{template.title}</span>
                        <span className="font-mono text-[10px] uppercase text-[var(--text-tertiary)]">{template.category}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]">{template.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5">
              <SectionTitle icon={Plus} title="添加节点" />
              <div className="grid grid-cols-2 gap-2">
                {palette.map((item) => {
                  const meta = nodeMeta[item.type];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => addNode(item.type)}
                      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-card-hover)]"
                    >
                      <Icon className={cn('mb-2 h-4 w-4', meta.tone)} />
                      <div className="text-xs font-semibold text-[var(--text-primary)]">{item.title}</div>
                      <div className="text-[10px] text-[var(--text-tertiary)]">{item.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        <main className="surface-raised flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] xl:min-h-0">
          <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--border-subtle)] px-4 py-3 md:h-14 md:flex-row md:items-center md:justify-between md:py-0">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:flex-nowrap md:gap-2">
                <h2 className="truncate text-sm font-bold text-[var(--text-primary)]">{bundle.activeDefinition.name}</h2>
                <span className="rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--text-tertiary)]">
                  {bundle.activeDefinition.mode}
                </span>
                {activeWorkflowTruth && <WorkflowTruthPill truth={activeWorkflowTruth} compact />}
                <span className={cn(
                  'rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase',
                  trueRuntimeReady
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-500',
                )}>
                  {trueRuntimeReady ? '真实能力就绪' : '真实能力受限'}
                </span>
              </div>
              <p className="truncate text-xs text-[var(--text-muted)]">{bundle.activeDefinition.description}</p>
            </div>
            <div className="flex w-full items-center justify-end gap-1 md:gap-2 md:w-auto">
              <button className="toolbar-button" type="button" onClick={returnToEntryReview} title="返回目标与执行草案" aria-label="返回目标与执行草案">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden md:inline">目标</span>
              </button>
              {isHydrating && (
                <span className="hidden rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] md:inline">
                  同步中
                </span>
              )}
              <button className="toolbar-button" type="button" onClick={resetDraft} title="重置" aria-label="重置工作流草稿">
                <TimerReset className="h-4 w-4" />
                <span className="hidden md:inline">重置</span>
              </button>
              <button className="toolbar-button" type="button" onClick={saveDraft} disabled={isSaving} title="保存" aria-label={isSaving ? '正在保存工作流' : '保存工作流'}>
                <Save className="h-4 w-4" />
                <span className="hidden md:inline">{isSaving ? '保存中' : '保存'}</span>
              </button>
              <button className="toolbar-button" type="button" onClick={exportActiveWorkflow} title="导出 JSON" aria-label="导出工作流 JSON">
                <Database className="h-4 w-4" />
                <span className="hidden md:inline">导出</span>
              </button>
              <button
                className="toolbar-button"
                type="button"
                onClick={togglePublication}
                disabled={isPublishing}
                title={activeWorkflow?.published ? '停用发布' : '发布'}
                aria-label={isPublishing ? '正在更新发布入口' : activeWorkflow?.published ? '停用发布入口' : '开启发布入口'}
              >
                {activeWorkflow?.published ? <LockKeyhole className="h-4 w-4" /> : <Globe2 className="h-4 w-4" />}
                <span className="hidden md:inline">{isPublishing ? '处理中' : activeWorkflow?.published ? '停用发布' : '发布'}</span>
              </button>
              <button className="toolbar-button-primary" type="button" onClick={simulateRun} disabled={isRunning} title={runModeLabel(runMode)} aria-label={isRunning ? '工作流运行中' : runModeLabel(runMode)}>
                <Play className="h-4 w-4" />
                <span className="hidden md:inline">{isRunning ? '运行中' : runMode === 'simulate' ? '模拟运行' : '真实运行'}</span>
              </button>
            </div>
          </div>
          <div className="min-h-[420px] flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={handleConnect}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              fitView
              minZoom={0.25}
              maxZoom={1.4}
            >
              <Background gap={28} size={1} />
              <Controls position="bottom-left" />
              <MiniMap pannable zoomable position="bottom-right" nodeStrokeWidth={2} />
            </ReactFlow>
          </div>
        </main>

        <aside className="surface-raised flex max-h-[620px] min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] xl:max-h-none">
          <div className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] px-4">
            <div className="flex items-center gap-2">
              <PanelRight className="h-4 w-4 text-[var(--text-tertiary)]" />
              <span className="text-sm font-bold text-[var(--text-primary)]">设置与运行</span>
            </div>
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]',
                trueRuntimeReady
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-500',
              )}
              title={
                unknownCapabilityCount > 0
                  ? '能力状态读取失败，当前不能确认真实运行能力'
                  : trueRuntimeReady
                    ? '真实运行能力已接入'
                    : '真实运行能力尚未全部接入'
              }
            >
              {trueRuntimeReady ? <ShieldCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              <span>
                {unknownCapabilityCount > 0
                  ? `${unknownCapabilityCount} 项状态未知`
                  : trueRuntimeReady
                    ? '真实可用'
                    : `${unavailableCapabilityCount} 项未接入`}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <SectionTitle icon={ListTree} title="节点设置" />
            {selectedNode ? (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{selectedNode.label}</div>
                    <div className="mt-1 font-mono text-[11px] text-[var(--text-tertiary)]">{selectedNode.id}</div>
                  </div>
                  <span className="rounded-md bg-[var(--bg-card)] px-2 py-1 text-[10px] uppercase text-[var(--text-muted)]">{selectedNode.type}</span>
                </div>
                <div className="mt-3 space-y-2">
                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">label</span>
                    <input
                      value={selectedNode.label}
                      onChange={(event) => updateSelectedNode({ label: event.target.value })}
                      className="agent-workflow-field"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">description</span>
                    <textarea
                      value={selectedNode.description || ''}
                      onChange={(event) => updateSelectedNode({ description: event.target.value })}
                      className="agent-workflow-field min-h-16 resize-y"
                    />
                  </label>
                  {selectedNode.type === 'tool' && (
                    <>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">toolCode</span>
                        <input
                          value={String(selectedNode.data.toolCode || '')}
                          onChange={(event) => updateSelectedNodeData('toolCode', event.target.value)}
                          className="agent-workflow-field"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">args JSON</span>
                        <textarea
                          value={selectedToolArgsText}
                          onChange={(event) => {
                            const nextText = event.target.value;
                            setToolArgsDrafts((current) => ({ ...current, [selectedNode.id]: nextText }));
                            try {
                              updateSelectedNodeData('args', JSON.parse(nextText || '{}'));
                            } catch {
                              // 保持无效的草稿文本可见；仅在其变为有效的 JSON 后才提交到节点参数。
                            }
                          }}
                          className="agent-workflow-field min-h-24 resize-y font-mono"
                        />
                      </label>
                    </>
                  )}
                  {selectedNode.type === 'agent' && (
                    <>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">agentId</span>
                        <input
                          value={String(selectedNode.data.agentId || '')}
                          onChange={(event) => updateSelectedNodeData('agentId', event.target.value)}
                          className="agent-workflow-field"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">model</span>
                        <input
                          value={String(selectedNode.data.model || '')}
                          onChange={(event) => updateSelectedNodeData('model', event.target.value)}
                          className="agent-workflow-field"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">maxIterations</span>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={Number(selectedNode.data.maxIterations || 1)}
                          onChange={(event) => updateSelectedNodeData('maxIterations', Number(event.target.value))}
                          className="agent-workflow-field"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">allowedTools</span>
                        <input
                          value={Array.isArray(selectedNode.data.allowedTools) ? selectedNode.data.allowedTools.join(', ') : ''}
                          onChange={(event) =>
                            updateSelectedNodeData(
                              'allowedTools',
                              event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                            )
                          }
                          className="agent-workflow-field"
                        />
                      </label>
                    </>
                  )}
                  {selectedNode.type === 'extractor' && (
                    <>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">mode</span>
                        <input
                          value={String(selectedNode.data.mode || '')}
                          onChange={(event) => updateSelectedNodeData('mode', event.target.value)}
                          className="agent-workflow-field"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">path</span>
                        <input
                          value={String(selectedNode.data.path || '')}
                          onChange={(event) => updateSelectedNodeData('path', event.target.value)}
                          className="agent-workflow-field"
                        />
                      </label>
                    </>
                  )}
                  {selectedNode.type === 'branch' && (
                    <label className="block">
                      <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">when</span>
                      <input
                        value={String(selectedNode.data.when || '')}
                        onChange={(event) => updateSelectedNodeData('when', event.target.value)}
                        className="agent-workflow-field"
                      />
                    </label>
                  )}
                  {selectedNode.type === 'loop' && (
                    <>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">over</span>
                        <input
                          value={String(selectedNode.data.over || '')}
                          onChange={(event) => updateSelectedNodeData('over', event.target.value)}
                          className="agent-workflow-field"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">maxIterations</span>
                        <input
                          type="number"
                          min={1}
                          max={200}
                          value={Number(selectedNode.data.maxIterations || 1)}
                          onChange={(event) => updateSelectedNodeData('maxIterations', Number(event.target.value))}
                          className="agent-workflow-field"
                        />
                      </label>
                    </>
                  )}
                  {selectedNode.type === 'code' && (
                    <>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">language</span>
                        <input
                          value={String(selectedNode.data.language || '')}
                          onChange={(event) => updateSelectedNodeData('language', event.target.value)}
                          className="agent-workflow-field"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">sandboxRef</span>
                        <input
                          value={String(selectedNode.data.sandboxRef || '')}
                          onChange={(event) => updateSelectedNodeData('sandboxRef', event.target.value)}
                          className="agent-workflow-field"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">code</span>
                        <textarea
                          value={String(selectedNode.data.code || '')}
                          onChange={(event) => updateSelectedNodeData('code', event.target.value)}
                          className="agent-workflow-field min-h-24 resize-y font-mono"
                        />
                      </label>
                    </>
                  )}
                  {selectedNode.type === 'output' && (
                    <label className="block">
                      <span className="mb-1 block font-mono text-[10px] uppercase text-[var(--text-tertiary)]">outputPath</span>
                      <input
                        value={String(selectedNode.data.outputPath || '')}
                        onChange={(event) => updateSelectedNodeData('outputPath', event.target.value)}
                        className="agent-workflow-field"
                      />
                    </label>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-4 text-sm text-[var(--text-muted)]">未选择节点</div>
            )}

            <div className="mt-5">
              <SectionTitle icon={Play} title="运行设置" />
              <div className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 p-2">
                <div className="grid grid-cols-2 gap-1" role="group" aria-label="运行模式">
                  {([
                    { mode: 'real' as const, label: '真实', icon: ShieldCheck },
                    { mode: 'simulate' as const, label: '模拟', icon: FlaskConical },
                  ]).map((item) => {
                    const Icon = item.icon;
                    const selected = runMode === item.mode;
                    const disabled = item.mode === 'real' && unknownCapabilityCount > 0;
                    return (
                      <button
                        key={item.mode}
                        type="button"
                        aria-pressed={selected}
                        disabled={disabled}
                        onClick={() => setRunMode(item.mode)}
                        className={cn(
                          'flex h-11 md:h-9 items-center justify-center gap-1.5 rounded-md border text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                          selected
                            ? 'border-[var(--ink-primary)] bg-[var(--ink-primary)] text-[var(--bg-void)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">
                  {runMode === 'simulate'
                    ? unknownCapabilityCount > 0
                      ? '能力状态读取失败，已保持模拟运行；刷新状态前不会把未知能力当成未接入或可用。'
                      : '模拟运行会显式标记 run，不代表真实工具或模型已接入。'
                    : trueRuntimeReady
                      ? '真实运行会调用已接入执行器并记录真实结果。'
                      : '你仍可手动发起真实运行；未接入能力会返回明确失败，不会伪装成功。'}
                </p>
              </div>
              <div className="mb-3 space-y-1.5">
                {capabilityItems.map((item) => (
                  <div key={item.label} className="flex items-start justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/35 px-2.5 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-[var(--text-primary)]">{item.label}</div>
                      {item.detail && <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--text-muted)]">{item.detail}</div>}
                    </div>
                    <span className={cn('shrink-0 text-[10px] font-semibold', capabilityTone(item.enabled))}>
                      {capabilityStateLabel(item.state)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 p-2">
                <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5 text-[10px] text-[var(--text-tertiary)]">
                  <span>当前查看</span>
                  <span className="font-mono">{selectedRun ? `#${selectedRun.id} · ${workflowRunStatusLabel(selectedRun.status)}` : '请选择运行记录'}</span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {workflowRunActions.filter((item) => item.visible).map((item) => (
                    <button
                      key={item.action}
                      type="button"
                      disabled={item.disabled || isRuntimeActionBusy}
                      onClick={() => void runRuntimeAction(item.action)}
                      className="h-11 md:h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[11px] font-semibold text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-[var(--bg-card)] px-2 py-1">
                    <div className="font-mono text-xs text-[var(--text-primary)]">{metrics?.totalRuns ?? '—'}</div>
                    <div className="text-[10px] text-[var(--text-tertiary)]">总运行</div>
                  </div>
                  <div className="rounded-md bg-[var(--bg-card)] px-2 py-1">
                    <div className="font-mono text-xs text-emerald-500">{metrics?.successRuns ?? '—'}</div>
                    <div className="text-[10px] text-[var(--text-tertiary)]">成功</div>
                  </div>
                  <div className="rounded-md bg-[var(--bg-card)] px-2 py-1">
                    <div className="font-mono text-xs text-[var(--text-primary)]">{versions[0]?.version ? `v${versions[0].version}` : '—'}</div>
                    <div className="text-[10px] text-[var(--text-tertiary)]">当前版本</div>
                  </div>
                </div>
                {versions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void rollbackLatestVersion()}
                    className="mt-2 h-11 md:h-9 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[11px] font-semibold text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)]"
                  >
                    回滚到 v{versions[1].version}
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {Object.entries(bundle.activeDefinition.inputs || {}).map(([name, spec]) => (
                  <label key={name} className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 px-3 py-2">
                    <span className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-[var(--text-primary)]">{name}</span>
                      <span className="text-[10px] uppercase text-[var(--text-tertiary)]">{spec.type}{spec.required ? ' · 必填' : ''}</span>
                    </span>
                    {spec.type === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={runInputs[name] === true}
                        onChange={(event) => setRunInputs((current) => ({ ...current, [name]: event.target.checked }))}
                        className="h-5 w-5 accent-[var(--ink-primary)]"
                      />
                    ) : (
                      <input
                        value={String(runInputs[name] ?? '')}
                        onChange={(event) => setRunInputs((current) => ({ ...current, [name]: event.target.value }))}
                        className="agent-workflow-field"
                      />
                    )}
                    {spec.description && <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{spec.description}</span>}
                  </label>
                ))}
                {Object.keys(bundle.activeDefinition.inputs || {}).length === 0 && (
                  <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--text-muted)]">当前工作流没有声明运行输入</div>
                )}
              </div>
            </div>

            <div className="mt-5">
              <SectionTitle icon={KeyRound} title="变量" />
              <div className="space-y-2">
                {bundle.variables.map((variable) => (
                  <div key={`${variable.scope}:${variable.name}`} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-[var(--text-primary)]">{variable.name}</div>
                      <div className="text-[10px] uppercase text-[var(--text-tertiary)]">{variable.scope} · {variable.type}</div>
                    </div>
                    {variable.secretRef ? <LockKeyhole className="h-4 w-4 text-amber-500" /> : <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <SectionTitle icon={Search} title="工具" />
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2">
                <Search className="h-4 w-4 text-[var(--text-tertiary)]" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="搜索工具目录"
                  className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] md:h-9"
                  placeholder="搜索工具 / MCP / Skill"
                />
              </div>
              <div className="space-y-2">
                {filteredTools.map((tool) => {
                  const Icon = protocolIcon(tool);
                  return (
                    <div key={tool.code} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon className="h-4 w-4 text-[var(--text-tertiary)]" />
                          <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{tool.displayName}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void testTool(tool)}
                            aria-label={`测试工具：${tool.displayName}`}
                            className="h-11 min-w-11 rounded border border-[var(--border-subtle)] px-1.5 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] md:h-9 md:min-w-9"
                          >
                            测试
                          </button>
                          <span className="font-mono text-[10px] uppercase text-[var(--text-tertiary)]">{tool.protocol}</span>
                        </div>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]">{tool.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-5">
              <SectionTitle icon={CalendarClock} title="运行记录" />
              <div className="space-y-2">
                {bundle.runHistory.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    aria-pressed={workflowIdEquals(run.id, selectedRunId)}
                    onClick={() => void inspectRun(run)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-[var(--bg-card-hover)]',
                      workflowIdEquals(run.id, selectedRunId)
                        ? 'border-[var(--ink-primary)] bg-[var(--bg-card)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className={cn('font-mono text-xs', runStatusTone(run.status))}>
                          {workflowRunStatusLabel(run.status)}
                        </span>
                        <span className={cn(
                          'rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase',
                          run.simulated
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
                        )}>
                          {run.simulated ? '模拟' : '真实'}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-[var(--text-tertiary)]">#{run.id}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                      <span>{new Date(run.createdAt).toLocaleString()}</span>
                      <span>{run.durationMs != null ? `${run.durationMs}ms` : `${run.totalNodeCount} 个节点`}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {run.sourceType && (
                        <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase text-[var(--text-tertiary)]">
                          {run.sourceType}
                        </span>
                      )}
                      {run.pausedReason && (
                        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-amber-500">
                          {run.pausedReason}
                        </span>
                      )}
                      {run.errorCategory && (
                        <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-red-500">
                          {run.errorCategory}
                        </span>
                      )}
                    </div>
                    {run.errorMessage && <p className="mt-1 line-clamp-2 text-[11px] text-red-500">{run.errorMessage}</p>}
                  </button>
                ))}
                {bundle.runHistory.length === 0 && (
                  <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--text-muted)]">暂无运行记录</div>
                )}
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <SectionTitle icon={Play} title="执行轨迹" className="mb-0" />
                <WorkflowTruthPill truth={activeRunTruth} compact />
              </div>
              <div className="space-y-2">
                {bundle.trace.map((item) => (
                  <div key={item.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <CircleDot className={cn('h-3.5 w-3.5', statusTone(item.status))} />
                        <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{item.nodeLabel}</span>
                      </div>
                      {item.durationMs != null && <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{item.durationMs}ms</span>}
                    </div>
                    {item.summary && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{item.summary}</p>}
                  </div>
                ))}
                {bundle.trace.length === 0 && (
                  <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-3 text-xs leading-5 text-[var(--text-muted)]">
                    这次运行没有返回可核验的执行轨迹；页面不会根据节点定义补造已完成步骤。
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

const goalStarterIcons: Record<WorkflowGoalStarter['key'], typeof Workflow> = {
  review: FileCheck2,
  organize: LibraryBig,
  maintain: CalendarClock,
};

const workflowTruthToneClass: Record<WorkflowTruth['tone'], string> = {
  neutral: 'text-[var(--ink-secondary)]',
  success: 'text-[var(--signal-success)]',
  warning: 'text-[var(--signal-warn)]',
};

function WorkflowTruthPill({ truth, compact = false }: { truth: WorkflowTruth; compact?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] font-semibold',
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
        workflowTruthToneClass[truth.tone],
      )}
      title={truth.detail}
      aria-label={`${truth.label}：${truth.detail}`}
    >
      <CircleDot className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      {truth.label}
    </span>
  );
}

interface WorkflowGoalEntryProps {
  phase: Exclude<WorkflowEntryPhase, 'canvas'>;
  goal: string;
  selectedGoalKey: WorkflowGoalStarter['key'] | null;
  selectedTemplateKey: string | null;
  selectedGoal: WorkflowGoalStarter | null;
  selectedTemplate: AgentWorkflowTemplateSummary | null;
  action: ReturnType<typeof getWorkflowEntryAction>;
  steps: string[];
  boundaries: string[];
  workflows: AgentWorkflowSummary[];
  templates: AgentWorkflowTemplateSummary[];
  activeWorkflowTruth: WorkflowTruth | null;
  activeRunTruth: WorkflowTruth;
  isHydrating: boolean;
  onGoalChange: (value: string) => void;
  onChooseGoal: (starter: WorkflowGoalStarter) => void;
  onChooseTemplate: (template: AgentWorkflowTemplateSummary) => void;
  onAdvance: () => void;
  onEdit: () => void;
  onContinueWorkflow: (workflow: AgentWorkflowSummary) => void;
}

function WorkflowGoalEntry({
  phase,
  goal,
  selectedGoalKey,
  selectedTemplateKey,
  selectedGoal,
  selectedTemplate,
  action,
  steps,
  boundaries,
  workflows,
  templates,
  activeWorkflowTruth,
  activeRunTruth,
  isHydrating,
  onGoalChange,
  onChooseGoal,
  onChooseTemplate,
  onAdvance,
  onEdit,
  onContinueWorkflow,
}: WorkflowGoalEntryProps) {
  const hasGoal = goal.trim().length > 0;

  return (
    <IntelligenceShell className="agent-workflows-page">
      <IntelligenceHeader
        eyebrow="AGENT WORKFLOW"
        currentLabel={phase === 'review' ? '执行草案' : '目标入口'}
        icon={Route}
        title="先定义要完成的事"
        description="把目标、业务步骤和不可越过的边界先说清楚；确认后再进入节点画布。"
        activeSummary="目标入口不会创建运行、发布流程，也不会把本地示例当成后端结果。"
        className="intelligence-context-header"
      />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
        <div className="min-w-0 space-y-4">
          <IntelligencePanel
            icon={PencilLine}
            title="1. 选择目标"
            description="从常见任务开始，或者直接用自己的话描述。"
          >
            <div className="grid gap-2 md:grid-cols-3" role="group" aria-label="常见目标">
              {WORKFLOW_GOAL_STARTERS.map((starter) => {
                const Icon = goalStarterIcons[starter.key];
                const selected = selectedGoalKey === starter.key;
                return (
                  <button
                    key={starter.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onChooseGoal(starter)}
                    className={cn(
                      'group flex min-h-20 items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]',
                      selected
                        ? 'border-[var(--intelligence-border-strong)] bg-[var(--intelligence-control-hover)]'
                        : 'border-[var(--intelligence-border)] bg-[var(--intelligence-control)] hover:border-[var(--intelligence-border-strong)] hover:bg-[var(--intelligence-control-hover)]',
                    )}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--intelligence-border)] bg-[var(--intelligence-panel-strong)] text-[var(--aurora-1)]">
                        <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="block text-[13px] font-bold leading-5 text-[var(--ink-primary)]">{starter.kicker}</span>
                        <span className={cn(
                          'shrink-0 font-mono text-[9px] uppercase tracking-[0.08em]',
                          selected ? 'text-[var(--aurora-1)]' : 'text-[var(--intelligence-muted)]',
                        )}>
                          {selected ? '已选' : '选择'}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-[var(--intelligence-muted)]">{starter.title}</span>
                      <span className="sr-only">{starter.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {(isHydrating || templates.length > 0) && (
              <div className="mt-4 border-t border-[var(--intelligence-border)] pt-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-[var(--ink-primary)]">后端模板</div>
                    <div className="mt-0.5 text-[11px] text-[var(--intelligence-muted)]">载入后仍是草稿，需要确认并发布。</div>
                  </div>
                  <Box className="h-4 w-4 text-[var(--intelligence-muted)]" />
                </div>
                {isHydrating ? (
                  <div className="grid gap-2 sm:grid-cols-2" aria-label="正在读取后端模板">
                    <div className="h-16 animate-pulse rounded-lg bg-[var(--intelligence-control)]" />
                    <div className="h-16 animate-pulse rounded-lg bg-[var(--intelligence-control)]" />
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {templates.slice(0, 4).map((template) => {
                      const selected = selectedTemplateKey === template.templateKey;
                      return (
                        <button
                          key={template.templateKey}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => onChooseTemplate(template)}
                          className={cn(
                            'min-h-16 rounded-lg border px-3 py-2 text-left transition-colors',
                            selected
                              ? 'border-[var(--intelligence-border-strong)] bg-[var(--intelligence-control-hover)]'
                              : 'border-[var(--intelligence-border)] bg-[var(--intelligence-control)] hover:bg-[var(--intelligence-control-hover)]',
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-bold text-[var(--ink-primary)]">{template.title}</span>
                            <span className="shrink-0 font-mono text-[9px] uppercase text-[var(--intelligence-muted)]">{template.category}</span>
                          </span>
                          <span className="mt-1 line-clamp-1 block text-[11px] text-[var(--intelligence-muted)]">{template.description}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <label className="mt-4 block">
              <span className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[var(--ink-primary)]">或者直接描述目标</span>
                <span className="font-mono text-[10px] text-[var(--intelligence-muted)]">{goal.length}/240</span>
              </span>
              <textarea
                value={goal}
                maxLength={240}
                onChange={(event) => onGoalChange(event.target.value)}
                placeholder="例如：检查这批已发布文章中的过期链接，列出证据和修改建议，但不要直接改文章。"
                className="min-h-20 w-full resize-y rounded-xl border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] px-3 py-2.5 text-sm leading-6 text-[var(--ink-primary)] outline-none transition focus:border-[var(--intelligence-border-strong)] focus:ring-2 focus:ring-[var(--intelligence-border-strong)] placeholder:text-[var(--intelligence-muted)]"
              />
            </label>

            <div className="mt-4 flex flex-col gap-3 border-t border-[var(--intelligence-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-xs leading-5 text-[var(--intelligence-muted)]">
                {phase === 'review'
                  ? '执行草案已就绪。进入高级编排后，仍需确认节点、工具、输入与发布状态。'
                  : '先核对系统理解，再决定是否进入工程画布；此处不会发起真实运行。'}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                {phase === 'review' && (
                  <button type="button" className="toolbar-button" onClick={onEdit}>
                    修改目标
                  </button>
                )}
                <button
                  type="button"
                  className="intelligence-action-button-primary !h-11 !min-h-11 md:!h-9 md:!min-h-9"
                  disabled={action.disabled}
                  onClick={onAdvance}
                >
                  {action.label}
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </IntelligencePanel>

          <IntelligencePanel
            icon={Workflow}
            title="继续已有工作流"
            description="打开的是现有工作流，不会创建副本；发布入口可能仍指向其他版本。"
          >
            <div className="grid gap-2 md:grid-cols-2">
              {workflows.map((workflow) => {
                const truth = getWorkflowTruth(workflow);
                return (
                  <button
                    key={workflow.id}
                    type="button"
                    onClick={() => onContinueWorkflow(workflow)}
                    className="rounded-xl border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] p-3 text-left transition-colors hover:border-[var(--intelligence-border-strong)] hover:bg-[var(--intelligence-control-hover)]"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-[var(--ink-primary)]">{workflow.name}</span>
                        <span className="mt-1 line-clamp-1 block text-xs text-[var(--intelligence-muted)]">{workflow.description}</span>
                      </span>
                      <WorkflowTruthPill truth={truth} compact />
                    </span>
                    <span className="mt-2 flex items-center justify-between gap-2 font-mono text-[10px] text-[var(--intelligence-muted)]">
                      <span>{workflow.nodeCount} 个节点 · v{workflow.version}</span>
                      <span className="inline-flex items-center gap-1">继续编辑 <ChevronRight className="h-3 w-3" /></span>
                    </span>
                  </button>
                );
              })}
            </div>
          </IntelligencePanel>
        </div>

        <IntelligencePanel
          icon={ListTree}
          title="2. 核对执行草案"
          description={phase === 'review' ? '确认顺序和边界，再进入高级编排。' : '选择或描述目标后，这里会解释系统将怎样处理。'}
          className="self-start xl:sticky xl:top-4"
          actions={hasGoal ? <WorkflowTruthPill truth={{ label: phase === 'review' ? '待确认' : '草案预览', detail: '还没有创建后端工作流或运行', tone: 'neutral' }} /> : undefined}
        >
          {!hasGoal ? (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--intelligence-border)] px-6 text-center">
              <PencilLine className="h-6 w-6 text-[var(--intelligence-muted)]" />
              <div className="mt-3 text-sm font-bold text-[var(--ink-primary)]">先说清楚目标</div>
              <p className="mt-1 max-w-xs text-xs leading-5 text-[var(--intelligence-muted)]">系统会把目标翻译成业务步骤与安全边界，而不是直接把你丢进空白画布。</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--intelligence-muted)]">目标</span>
                  <span className="text-[10px] font-semibold text-[var(--aurora-1)]">
                    {selectedTemplate ? '后端模板' : selectedGoal ? '目标参考' : '自定义目标'}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold leading-6 text-[var(--ink-primary)]">{goal.trim()}</p>
                {selectedTemplate && (
                  <p className="mt-2 text-[11px] leading-5 text-[var(--intelligence-muted)]">进入高级编排时将载入“{selectedTemplate.title}”的真实模板定义。</p>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-[var(--ink-primary)]">业务步骤</h3>
                  <span className="font-mono text-[10px] text-[var(--intelligence-muted)]">{steps.length} STEPS</span>
                </div>
                <ol className="space-y-0">
                  {steps.map((step, index) => (
                    <li key={`${step}:${index}`} className="relative flex gap-3 pb-3 last:pb-0">
                      {index < steps.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-1rem)] w-px bg-[var(--intelligence-border)]" />}
                      <span className="relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--intelligence-border-strong)] bg-[var(--intelligence-panel-strong)] font-mono text-[10px] font-bold text-[var(--aurora-1)]">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="pt-1 text-xs font-semibold leading-5 text-[var(--ink-secondary)]">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <IntelligenceStatusStrip tone="warning" icon={ShieldCheck}>
                <div className="text-xs font-bold text-[var(--ink-primary)]">不可越过的边界</div>
                <ul className="mt-1.5 space-y-1 text-xs leading-5 text-[var(--ink-secondary)]">
                  {boundaries.map((boundary) => (
                    <li key={boundary} className="flex gap-2">
                      <span aria-hidden="true">·</span>
                      <span>{boundary}</span>
                    </li>
                  ))}
                </ul>
              </IntelligenceStatusStrip>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {activeWorkflowTruth && (
                  <div className="rounded-lg border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] p-2.5">
                    <WorkflowTruthPill truth={activeWorkflowTruth} compact />
                    <p className="mt-1.5 text-[11px] leading-5 text-[var(--intelligence-muted)]">{activeWorkflowTruth.detail}</p>
                  </div>
                )}
                <div className="rounded-lg border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] p-2.5">
                  <WorkflowTruthPill truth={activeRunTruth} compact />
                  <p className="mt-1.5 text-[11px] leading-5 text-[var(--intelligence-muted)]">{activeRunTruth.detail}</p>
                </div>
              </div>
            </div>
          )}
        </IntelligencePanel>
      </div>
    </IntelligenceShell>
  );
}

function SectionTitle({ icon: Icon, title, className }: { icon: typeof Workflow; title: string; className?: string }) {
  return (
    <div className={cn('mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]', className)}>
      <Icon className="h-3.5 w-3.5" />
      {title}
    </div>
  );
}
