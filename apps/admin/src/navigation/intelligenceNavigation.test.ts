import { describe, expect, it } from 'vitest';

import {
  INTELLIGENCE_DESTINATIONS,
  INTELLIGENCE_ROUTES,
  findIntelligenceDestinations,
  findIntelligenceQuickActions,
  getIntelligenceDestination,
  getIntelligenceDestinationsForPlacement,
  getIntelligenceHomeHref,
  getIntelligenceShell,
  getIntelligenceSidebarDestination,
  isIntelligencePath,
  normalizeIntelligencePath,
} from './intelligenceNavigation';

describe('intelligence navigation contract', () => {
  it('publishes every canonical admin route without leaking the /admin basename', () => {
    expect(INTELLIGENCE_ROUTES).toEqual({
      workspace: '/intelligence',
      aetherhub: '/aetherhub',
      notes: '/notes',
      atlas: '/atlas',
      knowledge: '/intelligence/knowledge',
      agentWorkflows: '/agent-workflows',
      aiTools: '/ai-tools',
      qa: '/qa',
    });

    for (const route of Object.values(INTELLIGENCE_ROUTES)) {
      expect(route).toMatch(/^\/[a-z]/);
      expect(route).not.toMatch(/^\/admin(?:\/|$)/);
      expect(route).not.toMatch(/[?#]/);
      expect(route.endsWith('/')).toBe(false);
    }
  });

  it('keeps destination ids and order unique and resolves every home route', () => {
    const ids = INTELLIGENCE_DESTINATIONS.map((destination) => destination.id);
    const orders = INTELLIGENCE_DESTINATIONS.map((destination) => destination.order);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(orders).size).toBe(orders.length);
    expect(orders).toEqual([...orders].sort((left, right) => left - right));

    for (const destination of INTELLIGENCE_DESTINATIONS) {
      expect(getIntelligenceDestination(getIntelligenceHomeHref(destination))?.id).toBe(
        destination.id,
      );
    }
  });

  it.each([
    ['/notes/26/edit', 'notes'],
    ['/notes/new', 'notes'],
    ['/atlas/reader/pdf/42', 'atlas'],
    ['/atlas/kp/71', 'atlas'],
    ['/intelligence/knowledge/test-en', 'knowledge'],
    ['/agent-workflows/draft/2', 'agent-workflows'],
    ['/ai-tools?tool=summary#editor', 'ai-tools'],
    ['/qa/8/proofread', 'qa'],
    ['/qa/8/diff/12', 'qa'],
  ])('resolves representative deep link %s', (path, expectedId) => {
    expect(getIntelligenceDestination(path)?.id).toBe(expectedId);
  });

  it.each([
    ['/notes-old', null],
    ['/atlasical', null],
    ['/qa-old', null],
    ['/intelligence/knowledgebase', null],
    ['/analytics', null],
    ['/ai-config', null],
    ['/search-config', null],
  ])('does not mistake pseudo-prefix or non-domain path %s for Intelligence', (path, expected) => {
    expect(getIntelligenceDestination(path)).toBe(expected);
    expect(isIntelligencePath(path)).toBe(false);
  });

  it('normalizes query, hash and trailing slashes before matching', () => {
    expect(normalizeIntelligencePath('/notes/26/edit///?mode=split#body')).toBe('/notes/26/edit');
    expect(getIntelligenceDestination('/atlas///?tab=readings#recent')?.id).toBe('atlas');
    expect(getIntelligenceDestination('/intelligence/knowledge///#files')?.id).toBe('knowledge');
  });

  it('uses longest segment-boundary matching for the nested knowledge route', () => {
    expect(getIntelligenceDestination('/intelligence')?.id).toBe('workspace');
    expect(getIntelligenceDestination('/intelligence/knowledge')?.id).toBe('knowledge');
    expect(getIntelligenceDestination('/intelligence/knowledge/demo')?.id).toBe('knowledge');
  });

  it('shows only the unified workbench and AetherHub in the sidebar', () => {
    const sidebar = getIntelligenceDestinationsForPlacement('sidebar');

    expect(sidebar.map((destination) => destination.id)).toEqual(['workspace', 'aetherhub']);
    expect(sidebar.map((destination) => getIntelligenceHomeHref(destination))).toEqual([
      '/intelligence',
      '/aetherhub',
    ]);
  });

  it.each(['command-palette', 'sidebar-search'] as const)(
    'keeps all destinations discoverable through %s',
    (placement) => {
      expect(getIntelligenceDestinationsForPlacement(placement).map(({ id }) => id)).toEqual([
        'workspace',
        'aetherhub',
        'notes',
        'atlas',
        'knowledge',
        'agent-workflows',
        'ai-tools',
        'qa',
      ]);
    },
  );

  it.each([
    ['知识库', 'knowledge'],
    ['RAG', 'knowledge'],
    ['资料', 'knowledge'],
    ['图谱', 'atlas'],
    ['atlas', 'atlas'],
    ['对话', 'aetherhub'],
    ['chat', 'aetherhub'],
    ['灵境', 'aetherhub'],
    ['流程', 'agent-workflows'],
    ['workflow', 'agent-workflows'],
    ['编排', 'agent-workflows'],
    ['笔记', 'notes'],
  ])('finds %s as %s', (query, expectedId) => {
    expect(
      findIntelligenceDestinations(query, 'sidebar-search').some(
        (destination) => destination.id === expectedId,
      ),
    ).toBe(true);
  });

  it('derives quick actions from the same contract', () => {
    expect(findIntelligenceQuickActions('新建笔记', 'sidebar-search')).toEqual([
      expect.objectContaining({
        id: 'new-note',
        route: '/notes/new',
        destinationId: 'notes',
      }),
    ]);
  });

  it('separates domain membership from shell layout', () => {
    expect(getIntelligenceShell('/aetherhub')).toBe('standalone');
    expect(getIntelligenceShell('/agent-workflows')).toBe('admin-canvas');
    expect(getIntelligenceShell('/ai-tools')).toBe('admin-canvas');
    expect(getIntelligenceShell('/intelligence')).toBe('admin-default');
    expect(getIntelligenceShell('/notes/26/edit')).toBe('admin-default');
    expect(getIntelligenceShell('/analytics')).toBeNull();
    expect(getIntelligenceShell('/ai-config')).toBeNull();
  });

  it('keeps the workbench highlighted while visiting a legacy Intelligence destination', () => {
    expect(getIntelligenceSidebarDestination('/notes/26/edit')?.id).toBe('workspace');
    expect(getIntelligenceSidebarDestination('/atlas/reader/pdf/42')?.id).toBe('workspace');
    expect(getIntelligenceSidebarDestination('/agent-workflows')?.id).toBe('workspace');
    expect(getIntelligenceSidebarDestination('/aetherhub')?.id).toBe('aetherhub');
    expect(getIntelligenceSidebarDestination('/analytics')).toBeNull();
  });
});
