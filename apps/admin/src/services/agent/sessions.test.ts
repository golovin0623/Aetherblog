import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PINNED_GROUP_LABEL,
  createEmptySession,
  exportFileName,
  groupSessionsByRecency,
  loadSessions,
  normalizeContextBreak,
  readAgentSessionDraft,
  resolveAgentSessionDraftAfterRequestStart,
  sessionMatchesQuery,
  sessionToMarkdown,
  sliceContextMessages,
  withAgentSessionDraft,
  type AgentMessage,
  type AgentSession,
} from './sessions';
import type { AgentRetrievalReceipt } from '@aetherblog/agent-kit';

// ---- 测试基建：vitest 跑在 node 环境，浏览器全局需要手动搭 ----

interface LocalStorageMock {
  store: Map<string, string>;
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
  clear: () => void;
}

function createLocalStorageMock(): LocalStorageMock {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
}

type Listener = () => void;

function createWindowMock() {
  const listeners = new Map<string, Listener[]>();
  return {
    listeners,
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    dispatch(type: string) {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
}

function createDocumentMock() {
  const listeners = new Map<string, Listener[]>();
  return {
    visibilityState: 'visible' as 'visible' | 'hidden',
    listeners,
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    dispatch(type: string) {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
}

const STORAGE_KEY = 'aetherblog.admin.agent.sessions.7';

function makeMessage(patch: Partial<AgentMessage> & { id: string }): AgentMessage {
  return { role: 'user', content: '', createdAt: 0, ...patch };
}

function makeSession(patch: Partial<AgentSession> & { id: string }): AgentSession {
  return {
    title: patch.id,
    mode: 'chat',
    createdAt: 0,
    updatedAt: 0,
    messages: [],
    ...patch,
  };
}

describe('Agent session drafts', () => {
  it('creates new sessions with an empty persisted draft', () => {
    expect(createEmptySession().draft).toBe('');
  });

  it('keeps unsent composer text isolated by session', () => {
    const first = withAgentSessionDraft(createEmptySession(), '第一段未发送草稿');
    const second = withAgentSessionDraft(createEmptySession(), '第二段未发送草稿');

    expect(readAgentSessionDraft(first)).toBe('第一段未发送草稿');
    expect(readAgentSessionDraft(second)).toBe('第二段未发送草稿');
  });

  it('loads legacy sessions without a draft as an empty composer', () => {
    const legacy = {
      id: 'legacy',
      title: '旧会话',
      mode: 'chat',
      createdAt: 100,
      updatedAt: 100,
      messages: [],
    } satisfies AgentSession;

    expect(readAgentSessionDraft(legacy)).toBe('');
  });

  it('clears the composer for a new send but preserves it when replaying history', () => {
    const session = withAgentSessionDraft(createEmptySession(), '正在写的下一条问题');

    expect(resolveAgentSessionDraftAfterRequestStart(session, false)).toBe('');
    expect(resolveAgentSessionDraftAfterRequestStart(session, true)).toBe(
      '正在写的下一条问题',
    );
  });
});

describe('groupSessionsByRecency', () => {
  it('returns an empty list for no sessions', () => {
    expect(groupSessionsByRecency([])).toEqual([]);
  });

  it('puts the pinned group first even when pinned sessions are old', () => {
    const now = Date.now();
    const old = now - 30 * 24 * 60 * 60 * 1000;
    const groups = groupSessionsByRecency([
      makeSession({ id: 'today', updatedAt: now }),
      makeSession({ id: 'pinned-old', updatedAt: old, pinned: true }),
    ]);

    expect(groups[0].label).toBe(PINNED_GROUP_LABEL);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['pinned-old']);
    expect(groups[1].label).toBe('今天');
    expect(groups[1].sessions.map((s) => s.id)).toEqual(['today']);
  });

  it('omits the pinned group when nothing is pinned and sorts by recency', () => {
    const now = Date.now();
    const groups = groupSessionsByRecency([
      makeSession({ id: 'older', updatedAt: now - 1000 }),
      makeSession({ id: 'newer', updatedAt: now }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('今天');
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['newer', 'older']);
  });
});

describe('sessionMatchesQuery', () => {
  const session = makeSession({
    id: 's',
    title: '部署方案讨论',
    messages: [
      makeMessage({ id: 'm1', content: '怎么配置 Nginx 反向代理？' }),
      makeMessage({ id: 'm2', role: 'assistant', content: '可以用 proxy_pass……' }),
    ],
  });

  it('matches everything on an empty query', () => {
    expect(sessionMatchesQuery(session, '')).toBe(true);
  });

  it('matches the title', () => {
    expect(sessionMatchesQuery(session, '部署')).toBe(true);
  });

  it('matches any message body case-insensitively', () => {
    expect(sessionMatchesQuery(session, 'nginx')).toBe(true);
    expect(sessionMatchesQuery(session, 'proxy_pass')).toBe(true);
  });

  it('rejects when nothing matches', () => {
    expect(sessionMatchesQuery(session, 'kubernetes')).toBe(false);
  });
});

describe('context break helpers', () => {
  const messages = [
    makeMessage({ id: 'a' }),
    makeMessage({ id: 'b', role: 'assistant' }),
    makeMessage({ id: 'c' }),
  ];

  it('sends all history without a break', () => {
    expect(sliceContextMessages(messages, null)).toEqual(messages);
    expect(sliceContextMessages(messages, undefined)).toEqual(messages);
  });

  it('slices history after the break message', () => {
    expect(sliceContextMessages(messages, 'b').map((m) => m.id)).toEqual(['c']);
  });

  it('falls back to full history when the break id dangles', () => {
    expect(sliceContextMessages(messages, 'gone')).toEqual(messages);
  });

  it('normalizes a dangling break id to null and keeps a live one', () => {
    expect(normalizeContextBreak(messages, 'gone')).toBeNull();
    expect(normalizeContextBreak(messages, null)).toBeNull();
    expect(normalizeContextBreak(messages, 'b')).toBe('b');
  });
});

describe('sessionToMarkdown / exportFileName', () => {
  const retrieval: AgentRetrievalReceipt = {
    version: 1,
    status: 'matched',
    requested: { knowledgeBaseIds: [1], atlasKnowledgePointIds: [], atlasCarrierIds: [] },
    hits: [
      { key: 'k1', kind: 'knowledge_base_chunk', title: '分片一', sourceTitle: '知识库 A', rank: 1, href: '/kb/1' },
      { key: 'k2', kind: 'knowledge_base_chunk', title: '分片二', rank: 2 },
    ],
    warnings: [],
  };

  const session = makeSession({
    id: 's',
    title: '导出测试',
    createdAt: new Date(2026, 0, 5, 10, 30).getTime(),
    updatedAt: new Date(2026, 0, 6).getTime(),
    messages: [
      makeMessage({ id: 'u1', content: '问题正文' }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: '回答正文',
        think: '思考轨迹',
        retrieval,
      }),
      makeMessage({ id: 'a2', role: 'assistant', content: '', error: '已中断（页面关闭）' }),
    ],
  });

  it('renders the admin export banner, think details and retrieval footnotes', () => {
    const md = sessionToMarkdown(session);
    expect(md).toContain('# 导出测试');
    expect(md).toContain('导出自 灵境 AI 工作台（后台）');
    expect(md).toContain('3 条消息');
    expect(md).toContain('<details><summary>思考过程</summary>');
    expect(md).toContain('思考轨迹');
    expect(md).toContain('**知识来源：**');
    expect(md).toContain('1. [分片一 — 知识库 A](/kb/1)');
    expect(md).toContain('2. 分片二');
    // 空正文回落到错误占位
    expect(md).toContain('*（已中断（页面关闭））*');
  });

  it('builds a lingjing-prefixed cross-platform-safe file name', () => {
    const name = exportFileName(
      makeSession({ id: 's2', title: 'a/b:c*d 测试', updatedAt: new Date(2026, 0, 6).getTime() }),
    );
    expect(name).toBe('lingjing-a-b-c-d-测试-20260106.md');
  });

  it('falls back to "conversation" when the title is empty', () => {
    const name = exportFileName(
      makeSession({ id: 's3', title: '', updatedAt: new Date(2026, 0, 6).getTime() }),
    );
    expect(name).toBe('lingjing-conversation-20260106.md');
  });
});

describe('loadSessions 加载期收敛', () => {
  let storage: LocalStorageMock;

  beforeEach(() => {
    storage = createLocalStorageMock();
    vi.stubGlobal('window', createWindowMock());
    vi.stubGlobal('document', createDocumentMock());
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('settles pending messages as interrupted while keeping received content', () => {
    const persisted: AgentSession[] = [
      makeSession({
        id: 's',
        updatedAt: 1234,
        messages: [
          makeMessage({
            id: 'a1',
            role: 'assistant',
            content: '流到一半的内容',
            pending: true,
          }),
        ],
      }),
    ];
    storage.setItem(STORAGE_KEY, JSON.stringify(persisted));

    const [session] = loadSessions(7);
    const [message] = session.messages;
    expect(message.pending).toBe(false);
    expect(message.error).toBe('已中断（页面关闭）');
    expect(message.finishedAt).toBe(1234);
    expect(message.content).toBe('流到一半的内容');
  });

  it('settles a pending translation with partial content and drops an empty one', () => {
    const persisted: AgentSession[] = [
      makeSession({
        id: 's',
        messages: [
          makeMessage({
            id: 'a1',
            role: 'assistant',
            content: 'done',
            translation: { lang: 'en', content: 'half translated', pending: true },
          }),
          makeMessage({
            id: 'a2',
            role: 'assistant',
            content: 'done too',
            translation: { lang: 'en', content: '', pending: true },
          }),
        ],
      }),
    ];
    storage.setItem(STORAGE_KEY, JSON.stringify(persisted));

    const [session] = loadSessions(7);
    expect(session.messages[0].translation).toEqual({
      lang: 'en',
      content: 'half translated',
      pending: false,
      error: '翻译已中断',
    });
    expect(session.messages[1].translation).toBeUndefined();
  });

  it('keeps settled sessions untouched and tolerates corrupted payloads', () => {
    const settled: AgentSession[] = [
      makeSession({ id: 's', messages: [makeMessage({ id: 'a1', content: 'ok' })] }),
    ];
    storage.setItem(STORAGE_KEY, JSON.stringify(settled));
    expect(loadSessions(7)).toEqual(settled);

    storage.setItem(STORAGE_KEY, '{broken json');
    expect(loadSessions(7)).toEqual([]);
  });
});

describe('scheduleSaveSessions / flushSaveSessions', () => {
  let storage: LocalStorageMock;
  let windowMock: ReturnType<typeof createWindowMock>;
  let documentMock: ReturnType<typeof createDocumentMock>;

  // 节流器是 module 级状态（timer / pending / 监听器注册标记）—— 每个用例
  // 重置模块拿一份干净实例，避免用例间互相污染。
  async function importFreshModule() {
    vi.resetModules();
    return import('./sessions');
  }

  beforeEach(() => {
    vi.useFakeTimers();
    storage = createLocalStorageMock();
    windowMock = createWindowMock();
    documentMock = createDocumentMock();
    vi.stubGlobal('window', windowMock);
    vi.stubGlobal('document', documentMock);
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('merges rapid writes into one trailing persist with the latest snapshot', async () => {
    const mod = await importFreshModule();
    const setItem = vi.spyOn(storage, 'setItem');

    mod.scheduleSaveSessions(7, [makeSession({ id: 'v1' })]);
    vi.advanceTimersByTime(300);
    mod.scheduleSaveSessions(7, [makeSession({ id: 'v2' })]);
    mod.scheduleSaveSessions(7, [makeSession({ id: 'v3' })]);

    expect(setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500); // 距首次调度满 800ms
    expect(setItem).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!) as AgentSession[];
    expect(persisted[0].id).toBe('v3');
  });

  it('starts a fresh throttle window after the trailing persist fires', async () => {
    const mod = await importFreshModule();
    const setItem = vi.spyOn(storage, 'setItem');

    mod.scheduleSaveSessions(7, [makeSession({ id: 'v1' })]);
    vi.advanceTimersByTime(800);
    mod.scheduleSaveSessions(7, [makeSession({ id: 'v2' })]);
    vi.advanceTimersByTime(800);

    expect(setItem).toHaveBeenCalledTimes(2);
    const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!) as AgentSession[];
    expect(persisted[0].id).toBe('v2');
  });

  it('flushSaveSessions persists immediately and cancels the pending timer', async () => {
    const mod = await importFreshModule();
    const setItem = vi.spyOn(storage, 'setItem');

    mod.scheduleSaveSessions(7, [makeSession({ id: 'v1' })]);
    mod.flushSaveSessions();

    expect(setItem).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1600); // 定时器已取消，不应产生第二次写
    expect(setItem).toHaveBeenCalledTimes(1);

    mod.flushSaveSessions(); // 无在途快照时是 no-op
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('flushes on pagehide and on visibilitychange(hidden)', async () => {
    const mod = await importFreshModule();

    mod.scheduleSaveSessions(7, [makeSession({ id: 'closing' })]);
    windowMock.dispatch('pagehide');
    expect((JSON.parse(storage.getItem(STORAGE_KEY)!) as AgentSession[])[0].id).toBe('closing');

    mod.scheduleSaveSessions(7, [makeSession({ id: 'backgrounded' })]);
    documentMock.visibilityState = 'hidden';
    documentMock.dispatch('visibilitychange');
    expect((JSON.parse(storage.getItem(STORAGE_KEY)!) as AgentSession[])[0].id).toBe(
      'backgrounded',
    );

    // visible 状态的 visibilitychange 不触发 flush
    mod.scheduleSaveSessions(7, [makeSession({ id: 'still-pending' })]);
    documentMock.visibilityState = 'visible';
    documentMock.dispatch('visibilitychange');
    expect((JSON.parse(storage.getItem(STORAGE_KEY)!) as AgentSession[])[0].id).toBe(
      'backgrounded',
    );
  });

  it('an immediate saveSessions supersedes a stale scheduled snapshot', async () => {
    const mod = await importFreshModule();
    const setItem = vi.spyOn(storage, 'setItem');

    mod.scheduleSaveSessions(7, [makeSession({ id: 'stale' })]);
    mod.saveSessions(7, [makeSession({ id: 'fresh' })]);
    vi.advanceTimersByTime(1600);

    expect(setItem).toHaveBeenCalledTimes(1);
    expect((JSON.parse(storage.getItem(STORAGE_KEY)!) as AgentSession[])[0].id).toBe('fresh');
  });

  it('warns exactly once when localStorage keeps rejecting writes', async () => {
    const mod = await importFreshModule();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    mod.saveSessions(7, [makeSession({ id: 'v1' })]);
    mod.scheduleSaveSessions(7, [makeSession({ id: 'v2' })]);
    vi.advanceTimersByTime(800);

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
