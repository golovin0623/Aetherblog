import { describe, expect, it } from 'vitest';
import type { AgentWorkflowDefinition, AgentWorkflowSummary } from '@aetherblog/types';
import {
  defaultAgentWorkflowCapabilities,
  defaultAgentWorkflowBundle,
  defaultAgentWorkflowDefinition,
  getLocalAgentWorkflowDefinition,
  mergeBackendAndLocalWorkflowSummaries,
  normalizeLocalAgentWorkflowBundle,
  removeLocalAgentWorkflowDraft,
  storeLocalAgentWorkflowDefinition,
  toPersistedAgentWorkflowBundle,
} from './agentWorkflowService';

describe('agent workflow capability defaults', () => {
  it('never advertises automatic scheduling before the daemon exists', () => {
    expect(defaultAgentWorkflowCapabilities.scheduler).toMatchObject({
      enabled: false,
      state: 'coming_soon',
    });
    expect(defaultAgentWorkflowCapabilities.scheduler.detail).toContain('仅可持久化周期配置');
    expect(defaultAgentWorkflowCapabilities.scheduler.detail).toContain('不会自动运行');
  });
});

function definition(name: string, nodeLabel: string): AgentWorkflowDefinition {
  return {
    ...defaultAgentWorkflowDefinition,
    name,
    description: `${name} description`,
    nodes: [
      {
        id: `${name}-node`,
        type: 'agent',
        label: nodeLabel,
        position: { x: 40, y: 40 },
        data: { draftOnly: true },
      },
    ],
    edges: [],
  };
}

function summary(id: string, value: AgentWorkflowDefinition): AgentWorkflowSummary {
  return {
    id,
    name: value.name,
    description: value.description,
    mode: value.mode,
    version: 1,
    nodeCount: value.nodes.length,
    runCount: 0,
    updatedAt: '2026-07-13T00:00:00.000Z',
    published: false,
  };
}

describe('local agent workflow definitions', () => {
  it('never restores backend runtime evidence from a browser draft cache', () => {
    const staleRun = {
      id: 91,
      workflowId: 7,
      version: 3,
      status: 'success' as const,
      simulated: false,
      inputs: {},
      totalNodeCount: 2,
      createdAt: '2026-07-14T01:00:00.000Z',
    };
    const restored = normalizeLocalAgentWorkflowBundle({
      ...defaultAgentWorkflowBundle,
      runHistory: [staleRun],
      trace: [{
        id: 'stale-trace',
        nodeId: 'done',
        nodeLabel: '旧运行',
        nodeType: 'output' as const,
        status: 'success' as const,
      }],
    });

    expect(restored.runHistory).toEqual([]);
    expect(restored.trace).toEqual(defaultAgentWorkflowBundle.trace);
  });

  it('does not write backend runtime evidence into the browser draft payload', () => {
    const persisted = toPersistedAgentWorkflowBundle({
      ...defaultAgentWorkflowBundle,
      runHistory: [{
        id: 92,
        workflowId: 7,
        version: 3,
        status: 'failed',
        simulated: false,
        inputs: {},
        totalNodeCount: 2,
        createdAt: '2026-07-14T02:00:00.000Z',
      }],
      trace: [{
        id: 'live-trace',
        nodeId: 'failed',
        nodeLabel: '当前运行',
        nodeType: 'agent',
        status: 'failed',
      }],
    });

    expect(persisted.runHistory).toEqual([]);
    expect(persisted.trace).toEqual(defaultAgentWorkflowBundle.trace);
  });

  it('stores and restores an exact definition for every local workflow id', () => {
    const first = definition('First draft', 'First edited node');
    const second = definition('Second draft', 'Second edited node');
    const base = {
      ...defaultAgentWorkflowBundle,
      workflows: [summary('wf_local_first', first), summary('wf_local_second', second)],
      localDefinitions: {},
    };

    const withFirst = storeLocalAgentWorkflowDefinition(base, 'wf_local_first', first);
    const withBoth = storeLocalAgentWorkflowDefinition(withFirst, 'wf_local_second', second);

    expect(getLocalAgentWorkflowDefinition(withBoth, 'wf_local_first')).toEqual(first);
    expect(getLocalAgentWorkflowDefinition(withBoth, 'wf_local_second')).toEqual(second);
    expect(getLocalAgentWorkflowDefinition(withBoth, 42)).toBeUndefined();
  });

  it('snapshots one edited local draft without overwriting another draft', () => {
    const first = definition('First draft', 'Original first node');
    const editedFirst = definition('First draft', 'Unsaved first edit');
    const second = definition('Second draft', 'Keep this node');
    const base = {
      ...defaultAgentWorkflowBundle,
      workflows: [summary('wf_local_first', first), summary('wf_local_second', second)],
      localDefinitions: {
        wf_local_first: first,
        wf_local_second: second,
      },
    };

    const snapshot = storeLocalAgentWorkflowDefinition(base, 'wf_local_first', editedFirst);

    expect(getLocalAgentWorkflowDefinition(snapshot, 'wf_local_first')?.nodes[0].label).toBe('Unsaved first edit');
    expect(getLocalAgentWorkflowDefinition(snapshot, 'wf_local_second')?.nodes[0].label).toBe('Keep this node');
  });

  it('migrates a legacy bundle by attaching its active definition to the matching local summary', () => {
    const legacyDefinition = definition('Legacy draft', 'Legacy edited node');
    const migrated = normalizeLocalAgentWorkflowBundle({
      ...defaultAgentWorkflowBundle,
      workflows: [summary('wf_legacy', legacyDefinition)],
      activeDefinition: legacyDefinition,
      localDefinitions: undefined,
      entryDraftSourceKeys: undefined,
    });

    expect(getLocalAgentWorkflowDefinition(migrated, 'wf_legacy')).toEqual(legacyDefinition);
    expect(migrated.activeWorkflowId).toBe('wf_legacy');
    expect(migrated.entryDraftSourceKeys).toEqual({});
  });

  it('restores the active local workflow from its own mapped definition', () => {
    const first = definition('First draft', 'First node');
    const second = definition('Second draft', 'Second unsaved edit');
    const restored = normalizeLocalAgentWorkflowBundle({
      ...defaultAgentWorkflowBundle,
      workflows: [summary('wf_first', first), summary('wf_second', second)],
      activeWorkflowId: 'wf_second',
      activeDefinition: first,
      localDefinitions: {
        wf_first: first,
        wf_second: second,
      },
    });

    expect(restored.activeWorkflowId).toBe('wf_second');
    expect(restored.activeDefinition).toEqual(second);
  });

  it('keeps local draft summaries discoverable when backend workflows hydrate', () => {
    const localDefinition = definition('Local draft', 'Local edited node');
    const backendDefinition = definition('Backend draft', 'Backend node');
    const local = summary('wf_local', localDefinition);
    const staleBackend = { ...summary('42', backendDefinition), name: 'Stale backend name' };
    const freshBackend = { ...summary('42', backendDefinition), name: 'Fresh backend name' };

    expect(mergeBackendAndLocalWorkflowSummaries([freshBackend], [local, staleBackend])).toEqual([
      freshBackend,
      local,
    ]);
  });

  it('removes the promoted local definition and source key without touching other drafts', () => {
    const first = definition('First draft', 'First node');
    const second = definition('Second draft', 'Second node');
    const promoted = removeLocalAgentWorkflowDraft({
      ...defaultAgentWorkflowBundle,
      localDefinitions: { wf_first: first, wf_second: second },
      entryDraftSourceKeys: { wf_first: 'first-source', wf_second: 'second-source' },
    }, 'wf_first');

    expect(promoted.localDefinitions).toEqual({ wf_second: second });
    expect(promoted.entryDraftSourceKeys).toEqual({ wf_second: 'second-source' });
  });
});
