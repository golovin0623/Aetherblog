/**
 * Intelligence product navigation is deliberately UI-free.
 *
 * Sidebar, command/search surfaces, route registration and layout classification
 * consume this contract so a capability cannot silently disappear from one
 * surface or acquire a conflicting label/icon elsewhere.
 */

export const INTELLIGENCE_ROUTES = {
  workspace: '/intelligence',
  aetherhub: '/aetherhub',
  notes: '/notes',
  atlas: '/atlas',
  knowledge: '/intelligence/knowledge',
  agentWorkflows: '/agent-workflows',
  aiTools: '/ai-tools',
  qa: '/qa',
} as const;

export type IntelligenceRouteKey = keyof typeof INTELLIGENCE_ROUTES;

export type IntelligenceDestinationId =
  | 'workspace'
  | 'aetherhub'
  | 'notes'
  | 'atlas'
  | 'knowledge'
  | 'agent-workflows'
  | 'ai-tools'
  | 'qa';

export type IntelligencePlacement = 'sidebar' | 'command-palette' | 'sidebar-search';

export type IntelligenceShell = 'standalone' | 'admin-default' | 'admin-canvas';

export type IntelligenceIconKey =
  | 'workspace'
  | 'aetherhub'
  | 'notes'
  | 'atlas'
  | 'knowledge'
  | 'agent-workflows'
  | 'ai-tools'
  | 'qa'
  | 'create-note';

export interface IntelligenceQuickAction {
  id: string;
  destinationId: IntelligenceDestinationId;
  label: string;
  description: string;
  iconKey: IntelligenceIconKey;
  route: string;
  keywords: readonly string[];
  placements: readonly IntelligencePlacement[];
}

export interface IntelligenceDestination {
  id: IntelligenceDestinationId;
  label: string;
  description: string;
  iconKey: IntelligenceIconKey;
  order: number;
  homeRoute: IntelligenceRouteKey;
  routeKeys: readonly IntelligenceRouteKey[];
  keywords: readonly string[];
  placements: readonly IntelligencePlacement[];
  shell: IntelligenceShell;
  /**
   * The workspace is an exact landing route. Treating it as a generic prefix
   * would incorrectly classify typos such as /intelligence/knowledgebase.
   * Domain destinations own their segment-boundary descendants.
   */
  match: 'exact' | 'segment-prefix';
  quickActions: readonly IntelligenceQuickAction[];
}

const COMMAND_AND_SEARCH = ['command-palette', 'sidebar-search'] as const;
const EVERY_DISCOVERY_SURFACE = ['sidebar', ...COMMAND_AND_SEARCH] as const;

export const INTELLIGENCE_DESTINATIONS: readonly IntelligenceDestination[] = [
  {
    id: 'workspace',
    label: '知识工作台',
    description: '从资料到答案的统一入口',
    iconKey: 'workspace',
    order: 10,
    homeRoute: 'workspace',
    routeKeys: ['workspace'],
    keywords: ['knowledge', 'workspace', '知识', '工作台', '资料工作台'],
    placements: EVERY_DISCOVERY_SURFACE,
    shell: 'admin-default',
    match: 'exact',
    quickActions: [],
  },
  {
    id: 'aetherhub',
    label: '灵境',
    description: '基于可信来源提问',
    iconKey: 'aetherhub',
    order: 20,
    homeRoute: 'aetherhub',
    routeKeys: ['aetherhub'],
    keywords: ['aetherhub', 'chat', 'agent', '对话', '问答', '提问', '灵境'],
    placements: EVERY_DISCOVERY_SURFACE,
    shell: 'standalone',
    match: 'segment-prefix',
    quickActions: [],
  },
  {
    id: 'notes',
    label: '智能笔记',
    description: '记录、整理并继续追问',
    iconKey: 'notes',
    order: 30,
    homeRoute: 'notes',
    routeKeys: ['notes'],
    keywords: ['notes', 'note', '智能笔记', '笔记', '记录'],
    placements: COMMAND_AND_SEARCH,
    shell: 'admin-default',
    match: 'segment-prefix',
    quickActions: [
      {
        id: 'new-note',
        destinationId: 'notes',
        label: '新建笔记',
        description: '快速记录一个想法',
        iconKey: 'create-note',
        route: '/notes/new',
        keywords: ['new', 'create', 'note', '新建', '创建', '笔记'],
        placements: COMMAND_AND_SEARCH,
      },
    ],
  },
  {
    id: 'atlas',
    label: '知识图集',
    description: '阅读、标注与连接知识',
    iconKey: 'atlas',
    order: 40,
    homeRoute: 'atlas',
    routeKeys: ['atlas'],
    keywords: ['atlas', '知识图谱', '图谱', '图集', '知识点', '阅读'],
    placements: COMMAND_AND_SEARCH,
    shell: 'admin-default',
    match: 'segment-prefix',
    quickActions: [],
  },
  {
    id: 'knowledge',
    label: '知识库',
    description: '管理可检索的可信资料',
    iconKey: 'knowledge',
    order: 50,
    homeRoute: 'knowledge',
    routeKeys: ['knowledge'],
    keywords: ['knowledge', 'knowledge base', 'kb', 'rag', '知识库', '资料', '检索'],
    placements: COMMAND_AND_SEARCH,
    shell: 'admin-default',
    match: 'segment-prefix',
    quickActions: [],
  },
  {
    id: 'agent-workflows',
    label: '智能编排',
    description: '把重复任务变成流程',
    iconKey: 'agent-workflows',
    order: 60,
    homeRoute: 'agentWorkflows',
    routeKeys: ['agentWorkflows'],
    keywords: ['agent', 'workflow', '流程', '编排', '自动化'],
    placements: COMMAND_AND_SEARCH,
    shell: 'admin-canvas',
    match: 'segment-prefix',
    quickActions: [],
  },
  {
    id: 'ai-tools',
    label: '写作助手',
    description: '用 AI 处理与改写内容',
    iconKey: 'ai-tools',
    order: 70,
    homeRoute: 'aiTools',
    routeKeys: ['aiTools'],
    keywords: ['ai', 'tools', 'writing', '写作', '助手', '改写'],
    placements: COMMAND_AND_SEARCH,
    shell: 'admin-canvas',
    match: 'segment-prefix',
    quickActions: [],
  },
  {
    id: 'qa',
    label: '试卷拆题',
    description: '拆分、校对与复核试卷',
    iconKey: 'qa',
    order: 80,
    homeRoute: 'qa',
    routeKeys: ['qa'],
    keywords: ['qa', 'exam', '试卷', '拆题', '校对', '题目'],
    placements: COMMAND_AND_SEARCH,
    shell: 'admin-default',
    match: 'segment-prefix',
    quickActions: [],
  },
] as const;

export function normalizeIntelligencePath(input: string): string {
  const withoutQueryOrHash = input.trim().split(/[?#]/, 1)[0] ?? '';
  const withLeadingSlash = withoutQueryOrHash.startsWith('/')
    ? withoutQueryOrHash
    : `/${withoutQueryOrHash}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '');
  return withoutTrailingSlash || '/';
}

export function getIntelligenceHomeHref(destination: IntelligenceDestination): string {
  return INTELLIGENCE_ROUTES[destination.homeRoute];
}

function isSegmentBoundaryMatch(path: string, route: string): boolean {
  return path === route || path.startsWith(`${route}/`);
}

function destinationMatchesPath(
  destination: IntelligenceDestination,
  normalizedPath: string,
): boolean {
  return destination.routeKeys.some((routeKey) => {
    const route = INTELLIGENCE_ROUTES[routeKey];
    return destination.match === 'exact'
      ? normalizedPath === route
      : isSegmentBoundaryMatch(normalizedPath, route);
  });
}

export function getIntelligenceDestination(path: string): IntelligenceDestination | null {
  const normalizedPath = normalizeIntelligencePath(path);
  const candidates = INTELLIGENCE_DESTINATIONS.filter((destination) =>
    destinationMatchesPath(destination, normalizedPath),
  );

  // Knowledge Base is nested under the workspace prefix. Sorting by the most
  // specific canonical route makes the rule stable if more nested routes arrive.
  return (
    candidates.sort(
      (left, right) =>
        getIntelligenceHomeHref(right).length - getIntelligenceHomeHref(left).length,
    )[0] ?? null
  );
}

export function isIntelligencePath(path: string): boolean {
  return getIntelligenceDestination(path) !== null;
}

export function getIntelligenceShell(path: string): IntelligenceShell | null {
  return getIntelligenceDestination(path)?.shell ?? null;
}

export function getIntelligenceDestinationsForPlacement(
  placement: IntelligencePlacement,
): IntelligenceDestination[] {
  return INTELLIGENCE_DESTINATIONS.filter((destination) =>
    destination.placements.includes(placement),
  ).sort((left, right) => left.order - right.order);
}

function matchesSearchText(
  query: string,
  fields: readonly (string | readonly string[])[],
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return false;
  const haystack = fields.flat().join(' ').toLocaleLowerCase();
  return haystack.includes(normalizedQuery);
}

export function findIntelligenceDestinations(
  query: string,
  placement: IntelligencePlacement,
): IntelligenceDestination[] {
  return getIntelligenceDestinationsForPlacement(placement).filter((destination) =>
    matchesSearchText(query, [destination.label, destination.description, destination.keywords]),
  );
}

export function findIntelligenceQuickActions(
  query: string,
  placement: IntelligencePlacement,
): IntelligenceQuickAction[] {
  return INTELLIGENCE_DESTINATIONS.flatMap((destination) => destination.quickActions)
    .filter((action) => action.placements.includes(placement))
    .filter((action) =>
      matchesSearchText(query, [action.label, action.description, action.keywords]),
    );
}

export function getIntelligenceQuickActionsForPlacement(
  placement: IntelligencePlacement,
): IntelligenceQuickAction[] {
  return INTELLIGENCE_DESTINATIONS.flatMap((destination) => destination.quickActions).filter(
    (action) => action.placements.includes(placement),
  );
}

export function getIntelligenceSidebarDestination(
  path: string,
): IntelligenceDestination | null {
  const active = getIntelligenceDestination(path);
  if (!active) return null;

  const sidebarId: IntelligenceDestinationId =
    active.id === 'aetherhub' ? 'aetherhub' : 'workspace';
  return (
    getIntelligenceDestinationsForPlacement('sidebar').find(
      (destination) => destination.id === sidebarId,
    ) ?? null
  );
}
