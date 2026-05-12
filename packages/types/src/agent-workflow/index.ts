export type AgentWorkflowMode = 'fixed' | 'autonomous' | 'hybrid';

export type AgentWorkflowNodeType =
  | 'input'
  | 'output'
  | 'llm'
  | 'agent'
  | 'tool'
  | 'extractor'
  | 'branch'
  | 'loop'
  | 'code';

export type AgentWorkflowInputType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'array[string]'
  | 'array[number]'
  | 'array[object]'
  | 'array[boolean]'
  | 'file';

export type AgentConnectorProtocol = 'builtin' | 'http' | 'openapi' | 'mcp' | 'skill';

export type AgentVariableScope = 'system' | 'user' | 'workflow' | 'run';

export type AgentRunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'budget_exceeded';

export interface AgentWorkflowInputSpec {
  type: AgentWorkflowInputType;
  required?: boolean;
  description?: string;
}

export interface AgentWorkflowNode {
  id: string;
  type: AgentWorkflowNodeType;
  label: string;
  description?: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface AgentWorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface AgentWorkflowDefinition {
  version: 1;
  name: string;
  mode: AgentWorkflowMode;
  description?: string;
  inputs: Record<string, AgentWorkflowInputSpec>;
  nodes: AgentWorkflowNode[];
  edges: AgentWorkflowEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface AgentWorkflowSummary {
  id: string | number;
  name: string;
  description?: string;
  mode: AgentWorkflowMode;
  version: number;
  nodeCount: number;
  runCount: number;
  lastRunAt?: string;
  updatedAt: string;
  published: boolean;
  template?: boolean;
}

export interface AgentWorkflowDetail extends AgentWorkflowSummary {
  definition: AgentWorkflowDefinition;
  createdAt: string;
}

export interface AgentToolSummary {
  id?: string | number;
  code: string;
  displayName: string;
  description?: string;
  category: string;
  protocol: AgentConnectorProtocol;
  enabled: boolean;
  requiresApproval: boolean;
}

export interface AgentDefinitionSummary {
  id: string | number;
  code?: string;
  name: string;
  description?: string;
  model?: string;
  maxIterations: number;
  toolCodes: string[];
  enabled?: boolean;
}

export interface AgentVariableSpec {
  name: string;
  scope: AgentVariableScope;
  type: AgentWorkflowInputType;
  value?: unknown;
  secretRef?: string;
}

export interface AgentScheduleSummary {
  id: string | number;
  workflowId: string | number;
  enabled: boolean;
  cronExpr: string;
  timezone: string;
  nextRunAt?: string;
}

export interface AgentPublicationRequest {
  slug?: string;
  displayName?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  allowedOrigins?: string[];
  rateLimitPerMin?: number;
  enabled?: boolean;
}

export interface AgentPublicationSummary {
  id: string | number;
  workflowId: string | number;
  version: number;
  slug: string;
  displayName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  allowedOrigins: string[];
  rateLimitPerMin: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentWorkflowRunSummary {
  id: string | number;
  workflowId: string | number;
  version: number;
  status: AgentRunStatus;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  currentNode?: string;
  totalNodeCount: number;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  trace?: AgentRunTraceItem[];
}

export interface AgentWorkflowRunDetail extends AgentWorkflowRunSummary {
  logs: AgentWorkflowNodeLog[];
}

export interface AgentWorkflowNodeLog {
  id: string | number;
  runId: string | number;
  sequence: number;
  nodeId: string;
  nodeType: AgentWorkflowNodeType;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  durationMs?: number;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface AgentRunTraceItem {
  id: string | number;
  nodeId: string;
  nodeLabel: string;
  nodeType: AgentWorkflowNodeType;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  summary?: string;
}
