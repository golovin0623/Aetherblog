import { useEffect, useMemo, useState } from 'react';
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
  Bot,
  Box,
  Braces,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Code2,
  Database,
  FlaskConical,
  GitBranch,
  Globe2,
  KeyRound,
  ListTree,
  LockKeyhole,
  Network,
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
  AgentWorkflowDefinition,
  AgentWorkflowInputSpec,
  AgentWorkflowNodeLog,
  AgentWorkflowNode,
  AgentWorkflowNodeType,
  AgentWorkflowRunSummary,
  AgentWorkflowSummary,
} from '@aetherblog/types';
import { cn } from '@/lib/utils';
import {
  agentWorkflowService,
  defaultAgentWorkflowDefinition,
  loadLocalAgentWorkflowBundle,
  saveLocalAgentWorkflowBundle,
  type AgentWorkflowBundle,
} from '@/services/agentWorkflowService';

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

function traceFromRun(definition: AgentWorkflowDefinition, runTrace: AgentRunTraceItem[] | undefined): AgentRunTraceItem[] {
  if (runTrace?.length) return runTrace;
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
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | number>(() => bundle.workflows[0]?.id ?? 'wf_article_audit');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('audit_agent');
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(bundle.activeDefinition));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(bundle.activeDefinition));
  const [runInputs, setRunInputs] = useState<RunInputDraft>(() => initialRunInputs(bundle.activeDefinition));
  const [query, setQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const [toolArgsDrafts, setToolArgsDrafts] = useState<Record<string, string>>({});

  const selectedNode = useMemo(
    () => getRawNode(nodes.find((node) => node.id === selectedNodeId)),
    [nodes, selectedNodeId],
  );
  const selectedToolArgsText =
    selectedNode?.type === 'tool'
      ? (toolArgsDrafts[selectedNode.id] ?? JSON.stringify(selectedNode.data.args || {}, null, 2))
      : '';

  const stats = [
    { label: 'Nodes', value: nodes.length, icon: Workflow },
    { label: 'Tools', value: bundle.tools.length, icon: Box },
    { label: 'Agents', value: bundle.agents.length, icon: Bot },
    { label: 'Schedules', value: bundle.schedules.length, icon: CalendarClock },
  ];

  const activeWorkflow = useMemo(
    () => bundle.workflows.find((workflow) => workflowIdEquals(workflow.id, activeWorkflowId)) ?? bundle.workflows[0],
    [activeWorkflowId, bundle.workflows],
  );

  const refreshRunHistory = async (workflowId: string | number) => {
    if (!hasBackendWorkflowId(workflowId)) {
      setBundle((current) => ({ ...current, runHistory: [] }));
      return;
    }
    const response = await agentWorkflowService.listRuns(workflowId, 50);
    setBundle((current) => {
      const next = { ...current, runHistory: response.data || [] };
      saveLocalAgentWorkflowBundle(next);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      setIsHydrating(true);
      const current = loadLocalAgentWorkflowBundle();
      try {
        const [workflowResult, toolResult, agentResult, scheduleResult] = await Promise.allSettled([
          agentWorkflowService.listWorkflows(),
          agentWorkflowService.listTools(),
          agentWorkflowService.listAgents(),
          agentWorkflowService.listSchedules(),
        ]);
        if (cancelled) return;

        const workflows =
          isFulfilled(workflowResult) && workflowResult.value.data?.length
            ? workflowResult.value.data
            : current.workflows;
        const tools = isFulfilled(toolResult) && toolResult.value.data?.length ? toolResult.value.data : current.tools;
        const agents = isFulfilled(agentResult) && agentResult.value.data?.length ? agentResult.value.data : current.agents;
        const schedules = isFulfilled(scheduleResult) ? scheduleResult.value.data || [] : current.schedules;
        let activeDefinition = current.activeDefinition;

        if (workflows.length > 0 && hasBackendWorkflowId(workflows[0].id)) {
          try {
            const detail = await agentWorkflowService.getWorkflow(workflows[0].id);
            if (!cancelled && detail.data?.definition) {
              activeDefinition = detail.data.definition;
            }
          } catch {
            activeDefinition = current.activeDefinition;
          }
        }

        if (cancelled) return;
        let runHistory = current.runHistory;
        if (workflows.length > 0 && hasBackendWorkflowId(workflows[0].id)) {
          try {
            const runResult = await agentWorkflowService.listRuns(workflows[0].id, 50);
            if (!cancelled) {
              runHistory = runResult.data || [];
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
          activeDefinition,
        };
        setBundle(next);
        setNodes(toFlowNodes(activeDefinition));
        setEdges(toFlowEdges(activeDefinition));
        setActiveWorkflowId(workflows[0]?.id ?? current.workflows[0]?.id ?? 'wf_article_audit');
        setRunInputs(initialRunInputs(activeDefinition));
        setSelectedNodeId(selectedNodeIdFor(activeDefinition));
        saveLocalAgentWorkflowBundle(next);
      } catch {
        if (!cancelled) {
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

  const selectWorkflow = async (workflow: AgentWorkflowSummary) => {
    if (workflowIdEquals(workflow.id, activeWorkflowId)) return;

    if (!hasBackendWorkflowId(workflow.id)) {
      const localDefinition: AgentWorkflowDefinition = {
        ...defaultAgentWorkflowDefinition,
        name: workflow.name,
        mode: workflow.mode,
        description: workflow.description || defaultAgentWorkflowDefinition.description,
      };
      setActiveWorkflowId(workflow.id);
      applyActiveDefinition(localDefinition);
      setBundle((current) => {
        const next = { ...current, activeDefinition: localDefinition, runHistory: [] };
        saveLocalAgentWorkflowBundle(next);
        return next;
      });
      return;
    }

    setIsHydrating(true);
    try {
      const detail = await agentWorkflowService.getWorkflow(workflow.id);
      if (!detail.data?.definition) {
        throw new Error('后端未返回工作流定义');
      }
      const definition = detail.data.definition;
      setActiveWorkflowId(workflow.id);
      applyActiveDefinition(definition);
      setBundle((current) => {
        const next = { ...current, activeDefinition: definition };
        saveLocalAgentWorkflowBundle(next);
        return next;
      });
      void refreshRunHistory(workflow.id);
    } catch (error) {
      toast.error(`工作流加载失败：${errorMessage(error)}`);
    } finally {
      setIsHydrating(false);
    }
  };

  const persistDraft = async () => {
    const activeIndex = bundle.workflows.findIndex((workflow) => workflowIdEquals(workflow.id, activeWorkflowId));
    const workflowIndex = activeIndex >= 0 ? activeIndex : 0;
    const primary = bundle.workflows[workflowIndex];
    const next: AgentWorkflowBundle = {
      ...bundle,
      activeDefinition: buildDefinition(),
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
    setBundle(next);
    saveLocalAgentWorkflowBundle(next);
    const response = hasBackendWorkflowId(primary.id)
      ? await agentWorkflowService.updateWorkflow(primary.id, next.activeDefinition)
      : await agentWorkflowService.createWorkflow(next.activeDefinition);
    const saved = response.data;
    if (!saved) return next;

    const synced: AgentWorkflowBundle = {
      ...next,
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
      toast.error(`后端同步失败：${errorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const resetDraft = () => {
    const next = { ...bundle, activeDefinition: defaultAgentWorkflowDefinition };
    setBundle(next);
    setNodes(toFlowNodes(defaultAgentWorkflowDefinition));
    setEdges(toFlowEdges(defaultAgentWorkflowDefinition));
    setSelectedNodeId(selectedNodeIdFor(defaultAgentWorkflowDefinition));
    saveLocalAgentWorkflowBundle(next);
    toast.success('已恢复默认编排');
  };

  const simulateRun = async () => {
    if (isRunning) return;
    setIsRunning(true);
    try {
      const runDefinition = buildDefinition();
      const inputs = normalizeRunInputs(runDefinition, runInputs);
      const synced = await persistDraft();
      const workflowId = synced.workflows.find((workflow) => workflowIdEquals(workflow.id, activeWorkflowId))?.id
        ?? synced.workflows[0]?.id;
      if (workflowId == null) {
        throw new Error('没有可运行的工作流');
      }
      const response = await agentWorkflowService.startRun(
        workflowId,
        inputs,
        true,
      );
      const run = response.data;
      const nextTrace = traceFromRun(synced.activeDefinition, run?.trace);
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
          runHistory: run ? [run, ...current.runHistory.filter((item) => !workflowIdEquals(item.id, run.id))].slice(0, 50) : current.runHistory,
        };
        saveLocalAgentWorkflowBundle(next);
        return next;
      });
      if (run?.status === 'failed') {
        toast.error(`试运行失败：${run.errorMessage || '执行器返回失败状态'}`);
      } else {
        toast.success(`试运行已完成：${run?.status || 'pending'}`);
      }
    } catch (error) {
      toast.error(`试运行失败：${errorMessage(error)}`);
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
      const workflow = synced.workflows.find((item) => workflowIdEquals(item.id, activeWorkflowId)) ?? synced.workflows[0];
      if (!workflow || !hasBackendWorkflowId(workflow.id)) {
        throw new Error('请先保存为后端工作流');
      }
      const response = await agentWorkflowService.publishWorkflow(workflow.id, {
        displayName: synced.activeDefinition.name,
        description: synced.activeDefinition.description,
      });
      const publication = response.data;
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
      toast.success(`已发布：/${publication?.slug || workflow.id}`);
    } catch (error) {
      toast.error(`发布状态更新失败：${errorMessage(error)}`);
    } finally {
      setIsPublishing(false);
    }
  };

  const inspectRun = async (run: AgentWorkflowRunSummary) => {
    if (!hasBackendWorkflowId(run.id)) return;
    try {
      const detail = await agentWorkflowService.getRun(run.id);
      const logs = detail.data?.logs || [];
      const nextTrace = logs.length ? traceFromLogs(bundle.activeDefinition, logs) : traceFromRun(bundle.activeDefinition, detail.data?.trace);
      setBundle((current) => {
        const next = { ...current, trace: nextTrace };
        saveLocalAgentWorkflowBundle(next);
        return next;
      });
      toast.success(`已加载运行记录 #${run.id}`);
    } catch (error) {
      toast.error(`运行记录加载失败：${errorMessage(error)}`);
    }
  };

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
            <div className="mt-4 grid grid-cols-2 gap-2">
              {stats.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm text-[var(--text-primary)]">{item.value}</span>
                      <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                    </div>
                    <div className="mt-1 text-[10px] uppercase text-[var(--text-tertiary)]">{item.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <SectionTitle icon={Workflow} title="Workflows" />
            <div className="space-y-2">
              {bundle.workflows.map((workflow) => {
                const isActive = workflowIdEquals(workflow.id, activeWorkflow?.id);
                return (
                <button
                  key={workflow.id}
                  type="button"
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

            <div className="mt-5">
              <SectionTitle icon={Plus} title="Node Palette" />
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

        <main className="surface-raised min-h-[520px] overflow-hidden rounded-xl border border-[var(--border-subtle)] xl:min-h-0">
          <div className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] px-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-bold text-[var(--text-primary)]">{bundle.activeDefinition.name}</h2>
                <span className="rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--text-tertiary)]">
                  {bundle.activeDefinition.mode}
                </span>
              </div>
              <p className="truncate text-xs text-[var(--text-muted)]">{bundle.activeDefinition.description}</p>
            </div>
            <div className="flex items-center gap-2">
              {isHydrating && (
                <span className="hidden rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] md:inline">
                  同步中
                </span>
              )}
              <button className="toolbar-button" type="button" onClick={resetDraft} title="重置">
                <TimerReset className="h-4 w-4" />
                <span className="hidden md:inline">重置</span>
              </button>
              <button className="toolbar-button" type="button" onClick={saveDraft} disabled={isSaving} title="保存">
                <Save className="h-4 w-4" />
                <span className="hidden md:inline">{isSaving ? '保存中' : '保存'}</span>
              </button>
              <button
                className="toolbar-button"
                type="button"
                onClick={togglePublication}
                disabled={isPublishing}
                title={activeWorkflow?.published ? '停用发布' : '发布'}
              >
                {activeWorkflow?.published ? <LockKeyhole className="h-4 w-4" /> : <Globe2 className="h-4 w-4" />}
                <span className="hidden md:inline">{isPublishing ? '处理中' : activeWorkflow?.published ? '停用发布' : '发布'}</span>
              </button>
              <button className="toolbar-button-primary" type="button" onClick={simulateRun} disabled={isRunning} title="试运行">
                <Play className="h-4 w-4" />
                <span className="hidden md:inline">{isRunning ? '运行中' : '试运行'}</span>
              </button>
            </div>
          </div>
          <div className="h-[calc(100%-3.5rem)]">
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
              <span className="text-sm font-bold text-[var(--text-primary)]">Inspector</span>
            </div>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <SectionTitle icon={ListTree} title="Selected Node" />
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
                              // Keep invalid draft text visible; commit to node args only after it becomes valid JSON.
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
              <SectionTitle icon={Play} title="Run Inputs" />
              <div className="space-y-2">
                {Object.entries(bundle.activeDefinition.inputs || {}).map(([name, spec]) => (
                  <label key={name} className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 px-3 py-2">
                    <span className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-[var(--text-primary)]">{name}</span>
                      <span className="text-[10px] uppercase text-[var(--text-tertiary)]">{spec.type}{spec.required ? ' · required' : ''}</span>
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
              <SectionTitle icon={KeyRound} title="Variables" />
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
              <SectionTitle icon={Search} title="Tool Catalog" />
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2">
                <Search className="h-4 w-4 text-[var(--text-tertiary)]" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-9 min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
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
                        <span className="font-mono text-[10px] uppercase text-[var(--text-tertiary)]">{tool.protocol}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]">{tool.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-5">
              <SectionTitle icon={CalendarClock} title="Run History" />
              <div className="space-y-2">
                {bundle.runHistory.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => void inspectRun(run)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-card-hover)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('font-mono text-xs', runStatusTone(run.status))}>
                        {run.status}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--text-tertiary)]">#{run.id}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                      <span>{new Date(run.createdAt).toLocaleString()}</span>
                      <span>{run.durationMs != null ? `${run.durationMs}ms` : `${run.totalNodeCount} nodes`}</span>
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
              <SectionTitle icon={Play} title="Trace" />
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
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof Workflow; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">
      <Icon className="h-3.5 w-3.5" />
      {title}
    </div>
  );
}
