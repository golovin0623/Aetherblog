import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureAgentSessionSync,
  deleteAgentSessionRemote,
  flushAgentSessionSync,
  inspectAgentSessionSyncForTests,
  isSessionAwaitingHydration,
  mergeAdoptedServerSession,
  messageFromWire,
  messageToWire,
  notifyAgentSessionActivated,
  reconcileAgentSessions,
  resetAgentSessionSyncForTests,
  scheduleAgentSessionSync,
  selectSessionsToPush,
  sessionFromWire,
  sessionHasPendingWork,
  sessionStubFromWireMeta,
  sessionToWire,
  sessionWorthSyncing,
  setAgentSessionSyncFetchForTests,
  type AgentSessionWireDetail,
  type AgentSessionWireMeta,
  type AgentSessionSyncConfig,
} from './sessionsSync';
import type { AgentMessage, AgentSession } from './sessions';
import type { AgentRetrievalReceipt } from '@aetherblog/agent-kit';

// ---- 构造器 ----

function makeMessage(patch: Partial<AgentMessage> & { id: string }): AgentMessage {
  return { role: 'user', content: 'hello', createdAt: 1000, ...patch };
}

function makeSession(patch: Partial<AgentSession> & { id: string }): AgentSession {
  return {
    title: '测试会话',
    mode: 'chat',
    modelId: null,
    providerCode: null,
    draft: '',
    createdAt: 1000,
    updatedAt: 2000,
    messages: [makeMessage({ id: 'msg_0001_aaaa' })],
    ...patch,
  };
}

const retrievalReceipt: AgentRetrievalReceipt = {
  version: 1,
  status: 'matched',
  requested: { knowledgeBaseIds: [3], atlasKnowledgePointIds: [], atlasCarrierIds: [] },
  hits: [{ key: 'kb:1', kind: 'knowledge_base_chunk', title: '命中', rank: 1, score: 0.9 }],
  warnings: [],
};

function richAssistantMessage(): AgentMessage {
  return makeMessage({
    id: 'msg_0002_bbbb',
    role: 'assistant',
    content: '回答正文',
    createdAt: 1234,
    think: '思考过程',
    sources: [{ title: '文章', slug: 'post-1' }],
    retrieval: retrievalReceipt,
    modelId: 'gpt-x',
    providerCode: 'openai',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimated: false },
    toolEvents: [
      {
        id: 'call_abc',
        name: 'search_posts',
        arguments: '{"query":"部署","limit":2}',
        result: '[{"id":1,"title":"部署手册"}]',
        isError: false,
        startedAt: 1240,
        finishedAt: 1260,
      },
      {
        id: 'call_def',
        name: 'search_knowledge_base',
        arguments: '{"query":"迁移"}',
        result: '工具执行失败',
        isError: true,
        startedAt: 1262,
        finishedAt: 1270,
      },
    ],
    alternatives: [
      {
        modelId: 'claude-y',
        providerCode: 'anthropic',
        content: '备选回答正文',
        usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13, estimated: true },
        elapsedMs: 4200,
      },
      { modelId: null, providerCode: null, content: '被替换的原回答' },
    ],
    translation: { lang: 'en', content: 'answer body' },
    error: '某错误',
    errorCode: 'some_code',
    retryable: true,
    startedAt: 1200,
    firstTokenAt: 1210,
    finishedAt: 1300,
  });
}

// ============================================================
// wire 映射纯函数
// ============================================================

describe('messageToWire / messageFromWire', () => {
  it('全量元数据往返无损（think/sources/retrieval/usage/toolEvents/alternatives/translation/错误与计时戳）', () => {
    const original = richAssistantMessage();
    const wire = messageToWire(original);
    // toolEvents / alternatives 是显式字段构建 —— payload 漏打包会在云同步中静默丢失。
    expect(wire.payload?.toolEvents).toHaveLength(2);
    expect(wire.payload?.alternatives).toHaveLength(2);
    const roundTripped = messageFromWire(wire);
    expect(roundTripped).toEqual(original);
  });

  it('user 消息携带 requestSnapshot 与附件往返；附件 dataUrl 上行剥离、回程补空', () => {
    const original = makeMessage({
      id: 'msg_0003_cccc',
      requestSnapshot: {
        schemaVersion: 1,
        knowledgeContext: { mode: 'auto' } as never,
        articleIds: [1, 2],
        tagSlugs: ['go'],
      },
      attachments: [
        {
          id: 'att_1',
          kind: 'image',
          mime: 'image/png',
          name: 'a.png',
          size: 123,
          dataUrl: 'data:image/png;base64,AAAA',
          width: 10,
          height: 20,
        },
      ],
    });
    const wire = messageToWire(original);
    // 上行 payload 不含 dataUrl（4MB body 上限 + 服务端不存原图）。
    expect(JSON.stringify(wire)).not.toContain('dataUrl');
    expect(wire.payload?.attachments?.[0]).toEqual({
      id: 'att_1',
      kind: 'image',
      mime: 'image/png',
      name: 'a.png',
      size: 123,
      width: 10,
      height: 20,
    });
    const back = messageFromWire(wire);
    expect(back.attachments?.[0].dataUrl).toBe('');
    expect(back.requestSnapshot).toEqual(original.requestSnapshot);
  });

  it('纯文本消息不产生 payload；pending 翻译不上行', () => {
    const plain = makeMessage({ id: 'msg_0004_dddd' });
    expect(messageToWire(plain).payload).toBeUndefined();

    const translating = makeMessage({
      id: 'msg_0005_eeee',
      translation: { lang: 'en', content: 'partial', pending: true },
    });
    expect(messageToWire(translating).payload).toBeUndefined();
  });

  it('非法 role 兜底为 user', () => {
    const back = messageFromWire({
      id: 'msg_0006_ffff',
      role: 'system' as never,
      content: 'x',
      createdAt: 1,
    });
    expect(back.role).toBe('user');
  });
});

describe('sessionToWire / sessionFromWire', () => {
  it('会话整体往返无损（meta + 消息，时间戳原值透传）', () => {
    const session = makeSession({
      id: 'sess_full_0001',
      title: '完整会话',
      mode: 'cowork',
      modelId: 'gpt-x',
      providerCode: 'openai',
      modelParams: { temperature: 0.7, reasoning_effort: 'high' },
      pinned: true,
      contextBreakId: 'msg_0001_aaaa',
      draft: '未发送草稿',
      createdAt: 111,
      updatedAt: 222,
      messages: [makeMessage({ id: 'msg_0001_aaaa' }), richAssistantMessage()],
    });
    const wire = sessionToWire(session);
    const back = sessionFromWire({ ...wire, id: session.id, messageCount: 2 });
    expect(back).toEqual(session);
  });

  it('可选字段缺省时上行归一为 null/空串，回程不产生多余键', () => {
    const session = makeSession({ id: 'sess_min_0001' });
    const wire = sessionToWire(session);
    expect(wire.modelParams).toBeNull();
    expect(wire.contextBreakId).toBeNull();
    expect(wire.pinned).toBe(false);
    const back = sessionFromWire({ ...wire, id: session.id, messageCount: 1 });
    expect(back.pinned).toBeUndefined();
    expect(back.contextBreakId).toBeUndefined();
    expect(back.modelParams).toBeUndefined();
  });

  it('非法 mode 兜底为 chat；占位会话 messages 为空', () => {
    const meta: AgentSessionWireMeta = {
      id: 'sess_stub_0001',
      title: '远端会话',
      mode: 'weird-mode',
      modelId: null,
      providerCode: null,
      pinned: false,
      contextBreakId: null,
      draft: '',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 9,
    };
    const stub = sessionStubFromWireMeta(meta);
    expect(stub.mode).toBe('chat');
    expect(stub.messages).toEqual([]);
    expect(stub.updatedAt).toBe(2);
  });
});

// ============================================================
// 同步判定纯函数
// ============================================================

describe('sessionHasPendingWork / sessionWorthSyncing / selectSessionsToPush', () => {
  it('流式回答或流式翻译 = pending', () => {
    expect(sessionHasPendingWork(makeSession({ id: 's1' }))).toBe(false);
    expect(
      sessionHasPendingWork(
        makeSession({ id: 's2', messages: [makeMessage({ id: 'm', pending: true })] }),
      ),
    ).toBe(true);
    expect(
      sessionHasPendingWork(
        makeSession({
          id: 's3',
          messages: [
            makeMessage({ id: 'm', translation: { lang: 'en', content: '', pending: true } }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it('空壳会话（无消息无草稿）不值得首推；有草稿即值得', () => {
    expect(sessionWorthSyncing(makeSession({ id: 's1', messages: [] }))).toBe(false);
    expect(sessionWorthSyncing(makeSession({ id: 's2', messages: [], draft: '  ' }))).toBe(false);
    expect(sessionWorthSyncing(makeSession({ id: 's3', messages: [], draft: '草稿' }))).toBe(true);
    expect(sessionWorthSyncing(makeSession({ id: 's4' }))).toBe(true);
  });

  it('水位判定：已同步跳过、流式跳过、无水位空壳跳过、结果按 updatedAt 倒序', () => {
    const synced = makeSession({ id: 'synced', updatedAt: 100 });
    const dirtyOld = makeSession({ id: 'dirty-old', updatedAt: 200 });
    const dirtyNew = makeSession({ id: 'dirty-new', updatedAt: 300 });
    const streamingSession = makeSession({
      id: 'streaming',
      updatedAt: 400,
      messages: [makeMessage({ id: 'm', pending: true })],
    });
    const emptyShell = makeSession({ id: 'shell', updatedAt: 500, messages: [] });
    const clearedButKnown = makeSession({ id: 'cleared', updatedAt: 600, messages: [] });

    const watermarks = new Map<string, number>([
      ['synced', 100],
      ['dirty-old', 150],
      ['cleared', 550], // 已同步过、随后被 /clear 清空 —— 仍要推送
    ]);
    const picked = selectSessionsToPush(
      [synced, dirtyOld, dirtyNew, streamingSession, emptyShell, clearedButKnown],
      watermarks,
    );
    expect(picked.map((s) => s.id)).toEqual(['cleared', 'dirty-new', 'dirty-old']);
  });

  it('仍带 serverNewer 懒加载标记（awaitingHydration）的会话拒绝入选 —— 本地不是权威版本', () => {
    const stale = makeSession({ id: 'stale', updatedAt: 300 });
    const normal = makeSession({ id: 'normal', updatedAt: 200 });
    const watermarks = new Map<string, number>([
      ['stale', 100],
      ['normal', 100],
    ]);
    const awaiting = new Map<string, number>([['stale', 9999]]);
    expect(selectSessionsToPush([stale, normal], watermarks, awaiting).map((s) => s.id)).toEqual([
      'normal',
    ]);
    // 不传 awaitingHydration 时行为不变（两个都 dirty）。
    expect(selectSessionsToPush([stale, normal], watermarks).map((s) => s.id)).toEqual([
      'stale',
      'normal',
    ]);
  });
});

describe('mergeAdoptedServerSession', () => {
  it('本地不存在（其他设备新建）→ 原样采纳服务端版本', () => {
    const server = makeSession({ id: 'sess_merge_001', updatedAt: 9000 });
    expect(mergeAdoptedServerSession(server, undefined)).toBe(server);
  });

  it('保留本地 draft（纯本地态）与 titleEdited（不在 wire 里）；pinned 用服务端值', () => {
    const server = makeSession({
      id: 'sess_merge_002',
      title: '服务端标题',
      draft: '服务端旧草稿',
      pinned: true,
      updatedAt: 9000,
    });
    const local = makeSession({
      id: 'sess_merge_002',
      title: '本地手改标题',
      draft: '正在输入的本地草稿',
      titleEdited: true,
      updatedAt: 5000,
    });
    const merged = mergeAdoptedServerSession(server, local);
    expect(merged).not.toBeNull();
    expect(merged?.draft).toBe('正在输入的本地草稿');
    expect(merged?.titleEdited).toBe(true);
    // 其余字段（含 pinned / title / messages / updatedAt）以服务端为准。
    expect(merged?.pinned).toBe(true);
    expect(merged?.title).toBe('服务端标题');
    expect(merged?.updatedAt).toBe(9000);
  });

  it('本地 draft 缺省（旧快照）归一为空串；本地未手改标题时不产生 titleEdited 键', () => {
    const server = makeSession({ id: 'sess_merge_003', updatedAt: 9000 });
    const local = makeSession({ id: 'sess_merge_003', updatedAt: 5000 });
    delete (local as Partial<AgentSession>).draft;
    const merged = mergeAdoptedServerSession(server, local);
    expect(merged?.draft).toBe('');
    expect(merged?.titleEdited).toBeUndefined();
  });

  it('采纳瞬间本地 updatedAt 更大（已有更新编辑）→ 返回 null 拒绝采纳', () => {
    const server = makeSession({ id: 'sess_merge_004', updatedAt: 9000 });
    const local = makeSession({ id: 'sess_merge_004', updatedAt: 9001 });
    expect(mergeAdoptedServerSession(server, local)).toBeNull();
    // 相等（幂等重放）不拒绝。
    const equal = makeSession({ id: 'sess_merge_004', updatedAt: 9000 });
    expect(mergeAdoptedServerSession(server, equal)).not.toBeNull();
  });
});

// ============================================================
// 网络层（注入 fetch mock）
// ============================================================

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeDetail(patch: Partial<AgentSessionWireDetail> & { id: string }): AgentSessionWireDetail {
  return {
    title: '服务端版本',
    mode: 'chat',
    modelId: null,
    providerCode: null,
    pinned: false,
    contextBreakId: null,
    draft: '',
    createdAt: 1000,
    updatedAt: 9000,
    messageCount: 1,
    messages: [{ id: 'msg_srv_0001', role: 'user', content: '来自服务端', createdAt: 1000 }],
    ...patch,
  };
}

function metaOf(detail: AgentSessionWireDetail): AgentSessionWireMeta {
  const { messages: _messages, ...meta } = detail;
  return meta;
}

describe('sessionsSync 网络层', () => {
  let calls: FetchCall[];
  let routes: Map<string, (call: FetchCall) => Response>;
  let adopted: AgentSession[];
  let serverOnly: AgentSession[];
  let notices: string[];
  let adoptResult: boolean;

  function route(method: string, path: string, handler: (call: FetchCall) => Response) {
    routes.set(`${method} ${path}`, handler);
  }

  function installFetch() {
    setAgentSessionSyncFetchForTests((url, init) => {
      const call: FetchCall = { url, init };
      calls.push(call);
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = url.split('?')[0];
      const handler = routes.get(`${method} ${path}`);
      if (!handler) return Promise.resolve(jsonResponse(404, { code: 404, data: null }));
      return Promise.resolve(handler(call));
    });
  }

  function configure(userId: string | null = 'u1', patch?: Partial<AgentSessionSyncConfig>) {
    configureAgentSessionSync({
      userId,
      onAdoptServerVersion: (session) => {
        if (!adoptResult) return false;
        adopted.push(session);
        return true;
      },
      onServerOnlySessions: (sessions) => serverOnly.push(...sessions),
      onSyncNotice: (message) => notices.push(message),
      ...patch,
    });
  }

  beforeEach(() => {
    calls = [];
    routes = new Map();
    adopted = [];
    serverOnly = [];
    notices = [];
    adoptResult = true;
    resetAgentSessionSyncForTests();
    installFetch();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetAgentSessionSyncForTests();
    setAgentSessionSyncFetchForTests(null);
    vi.restoreAllMocks();
  });

  it('首次迁移：服务端为空时把本地历史全量 PUT（空壳会话除外）', async () => {
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [] }));
    const putIds: string[] = [];
    for (const id of ['sess_aaa_0001', 'sess_bbb_0002']) {
      route('PUT', `/api/v1/agent/sessions/${id}`, (call) => {
        putIds.push(id);
        const body = JSON.parse(String(call.init?.body));
        return jsonResponse(200, { code: 200, data: { ...body, id, messageCount: body.messages.length } });
      });
    }
    const locals = [
      makeSession({ id: 'sess_aaa_0001', updatedAt: 300 }),
      makeSession({ id: 'sess_bbb_0002', updatedAt: 200 }),
      makeSession({ id: 'sess_shell_003', updatedAt: 400, messages: [] }), // 空壳不上云
    ];
    configure();
    await reconcileAgentSessions(locals);
    await flushAgentSessionSync();

    expect(putIds).toEqual(['sess_aaa_0001', 'sess_bbb_0002']);
    const { watermarks } = inspectAgentSessionSyncForTests();
    expect(watermarks.get('sess_aaa_0001')).toBe(300);
    expect(watermarks.get('sess_bbb_0002')).toBe(200);
    expect(watermarks.has('sess_shell_003')).toBe(false);
  });

  it('reconcile：服务端较新标懒加载不推送；仅存服务端生成占位；相等对齐水位', async () => {
    const newer = makeDetail({ id: 'sess_newer_001', updatedAt: 9999 });
    const remoteOnly = makeDetail({ id: 'sess_remote_01', updatedAt: 5000 });
    const equal = makeDetail({ id: 'sess_equal_001', updatedAt: 2000 });
    route('GET', '/api/v1/agent/sessions', () =>
      jsonResponse(200, { code: 200, data: [metaOf(newer), metaOf(remoteOnly), metaOf(equal)] }),
    );
    const locals = [
      makeSession({ id: 'sess_newer_001', updatedAt: 2000 }),
      makeSession({ id: 'sess_equal_001', updatedAt: 2000 }),
    ];
    configure();
    await reconcileAgentSessions(locals);
    await flushAgentSessionSync();

    // 服务端较新 / 相等 / 占位 —— 全都不产生 PUT。
    expect(calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(0);
    const { watermarks, serverNewer } = inspectAgentSessionSyncForTests();
    expect(serverNewer.get('sess_newer_001')).toBe(9999);
    expect(watermarks.get('sess_equal_001')).toBe(2000);
    expect(serverOnly.map((s) => s.id)).toEqual(['sess_remote_01']);
    expect(serverOnly[0].messages).toEqual([]);
  });

  it('跨页面生命周期的落盘占位（消息空、时间戳与服务端相等）仍标懒加载', async () => {
    const server = makeDetail({ id: 'sess_stub_persi', updatedAt: 5000, messageCount: 3 });
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [metaOf(server)] }));
    // 上个生命周期插入侧栏并被 localStorage 落盘的占位：messages 空、updatedAt 相等。
    const persistedStub = makeSession({ id: 'sess_stub_persi', updatedAt: 5000, messages: [] });
    configure();
    await reconcileAgentSessions([persistedStub]);

    const { serverNewer, watermarks } = inspectAgentSessionSyncForTests();
    expect(serverNewer.get('sess_stub_persi')).toBe(5000);
    expect(watermarks.get('sess_stub_persi')).toBe(5000);
    // 不产生 PUT（占位绝不能把空消息推上去覆盖服务端）。
    await flushAgentSessionSync();
    expect(calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(0);
  });

  it('激活被标记「服务端较新」的会话时 GET /:id 并采纳服务端版本（不弹冲突提示）', async () => {
    const newer = makeDetail({ id: 'sess_newer_001', updatedAt: 9999 });
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [metaOf(newer)] }));
    route('GET', '/api/v1/agent/sessions/sess_newer_001', () =>
      jsonResponse(200, { code: 200, data: newer }),
    );
    configure();
    await reconcileAgentSessions([makeSession({ id: 'sess_newer_001', updatedAt: 2000 })]);
    notifyAgentSessionActivated('sess_newer_001');
    await vi.waitFor(() => expect(adopted).toHaveLength(1));

    expect(adopted[0].id).toBe('sess_newer_001');
    expect(adopted[0].updatedAt).toBe(9999);
    expect(adopted[0].messages[0].content).toBe('来自服务端');
    expect(notices).toEqual([]);
    const { watermarks, serverNewer } = inspectAgentSessionSyncForTests();
    expect(watermarks.get('sess_newer_001')).toBe(9999);
    expect(serverNewer.has('sess_newer_001')).toBe(false);
  });

  it('懒加载读失败（5xx）保留 serverNewer 标记待重试，重试成功后才清除', async () => {
    const newer = makeDetail({ id: 'sess_hyd_err_1', updatedAt: 9999 });
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [metaOf(newer)] }));
    let detailFailures = 0;
    route('GET', '/api/v1/agent/sessions/sess_hyd_err_1', () => {
      if (detailFailures < 1) {
        detailFailures += 1;
        return jsonResponse(500, { code: 500 });
      }
      return jsonResponse(200, { code: 200, data: newer });
    });
    configure();
    await reconcileAgentSessions([makeSession({ id: 'sess_hyd_err_1', updatedAt: 2000 })]);
    notifyAgentSessionActivated('sess_hyd_err_1');
    // 等 hydrate 链路完整收尾（fetch mock 同步 resolve，一个宏任务足够）——
    // 直接 waitFor 计数会在 inflight 尚未释放时提前通过，干扰第二次激活。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(detailFailures).toBe(1);

    // 读失败：不采纳、标记保留（清了标记 = 空壳占位被误判为已同步，
    // 随后一次发消息就会以 LWW 覆盖服务端全量历史）。
    expect(adopted).toHaveLength(0);
    expect(inspectAgentSessionSyncForTests().serverNewer.has('sess_hyd_err_1')).toBe(true);
    expect(isSessionAwaitingHydration('sess_hyd_err_1')).toBe(true);

    // 再次激活 = 重试通道：第二次 GET 成功 → 采纳并清标记。
    notifyAgentSessionActivated('sess_hyd_err_1');
    await vi.waitFor(() => expect(adopted).toHaveLength(1));
    expect(inspectAgentSessionSyncForTests().serverNewer.has('sess_hyd_err_1')).toBe(false);
    expect(isSessionAwaitingHydration('sess_hyd_err_1')).toBe(false);
  });

  it('懒加载 404（服务端确已删）清除标记且不采纳，保留本地副本', async () => {
    const newer = makeDetail({ id: 'sess_hyd_del_1', updatedAt: 9999 });
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [metaOf(newer)] }));
    // 不注册 detail 路由 —— installFetch 的兜底即 404。
    configure();
    await reconcileAgentSessions([makeSession({ id: 'sess_hyd_del_1', updatedAt: 2000 })]);
    notifyAgentSessionActivated('sess_hyd_del_1');
    await vi.waitFor(() =>
      expect(inspectAgentSessionSyncForTests().serverNewer.has('sess_hyd_del_1')).toBe(false),
    );
    expect(adopted).toHaveLength(0);
  });

  it('仍带 serverNewer 标记的 dirty 会话拒绝 PUT，flush 改为触发一次懒加载重试', async () => {
    const server = makeDetail({ id: 'sess_stale_001', updatedAt: 9000 });
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [metaOf(server)] }));
    // detail 一直失败：标记持续在场，专门验证「绝不 PUT」。
    route('GET', '/api/v1/agent/sessions/sess_stale_001', () => jsonResponse(500, { code: 500 }));
    const local = makeSession({ id: 'sess_stale_001', updatedAt: 2000 });
    configure();
    await reconcileAgentSessions([local]);
    expect(isSessionAwaitingHydration('sess_stale_001')).toBe(true);

    // 懒加载完成前本地又被编辑（updatedAt 反超服务端）—— 修复前这里会
    // PUT 上去，以 LWW 把服务端 9000 的全量历史覆盖成本地旧壳。
    const edited = { ...local, updatedAt: 12000 };
    scheduleAgentSessionSync([edited]);
    await flushAgentSessionSync();

    expect(calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(0);
    // flush 触发了懒加载重试（GET /:id）。
    await vi.waitFor(() =>
      expect(
        calls.filter(
          (c) => (c.init?.method ?? 'GET') === 'GET' && c.url.endsWith('/sess_stale_001'),
        ).length,
      ).toBeGreaterThan(0),
    );
    expect(isSessionAwaitingHydration('sess_stale_001')).toBe(true);
  });

  it('PUT 永久 4xx：按失败时的 updatedAt 记 skip（内容再变才重试），提示只弹一次', async () => {
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [] }));
    let puts = 0;
    route('PUT', '/api/v1/agent/sessions/sess_4xx_00001', (call) => {
      puts += 1;
      const body = JSON.parse(String(call.init?.body)) as { updatedAt: number };
      if (body.updatedAt < 1000) return jsonResponse(422, { code: 422, message: '数据校验未通过' });
      return jsonResponse(200, { code: 200, data: { ...body, id: 'sess_4xx_00001' } });
    });
    const local = makeSession({ id: 'sess_4xx_00001', updatedAt: 900 });
    configure();
    await reconcileAgentSessions([local]);
    await flushAgentSessionSync();

    expect(puts).toBe(1);
    expect(notices).toEqual(['有对话未能同步到云端（数据校验未通过），仅保存在本设备']);
    expect(inspectAgentSessionSyncForTests().watermarks.has('sess_4xx_00001')).toBe(false);
    expect(inspectAgentSessionSyncForTests().permanentFailures.get('sess_4xx_00001')).toBe(900);

    // updatedAt 未变：skip，不再重推（修复前每轮 flush 都会白打一发 4xx）。
    scheduleAgentSessionSync([local]);
    await flushAgentSessionSync();
    expect(puts).toBe(1);

    // 内容再变（updatedAt bump）→ 恢复重试并成功；提示不重复。
    const edited = { ...local, updatedAt: 1500 };
    scheduleAgentSessionSync([edited]);
    await flushAgentSessionSync();
    expect(puts).toBe(2);
    expect(inspectAgentSessionSyncForTests().watermarks.get('sess_4xx_00001')).toBe(1500);
    expect(inspectAgentSessionSyncForTests().permanentFailures.has('sess_4xx_00001')).toBe(false);
    expect(notices).toHaveLength(1);
  });

  it('PUT 409：采纳 data 里的服务端版本，冲突提示只弹一次', async () => {
    const server = makeDetail({ id: 'sess_conf_0001', updatedAt: 9999 });
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [metaOf(server)] }));
    route('PUT', '/api/v1/agent/sessions/sess_conf_0001', () =>
      jsonResponse(409, { code: 409, message: '会话已在其他设备更新', data: server }),
    );
    const local = makeSession({ id: 'sess_conf_0001', updatedAt: 12000 }); // 本地较新 → 推送 → 撞 409
    configure();
    await reconcileAgentSessions([local]);
    await flushAgentSessionSync();

    expect(adopted.map((s) => s.updatedAt)).toEqual([9999]);
    expect(notices).toEqual(['已同步另一设备的更新']);
    expect(inspectAgentSessionSyncForTests().watermarks.get('sess_conf_0001')).toBe(9999);

    // 再冲突一次：水位已是 9999，本地仍 12000 → 再推 → 再 409，但提示不重复。
    scheduleAgentSessionSync([local]);
    await flushAgentSessionSync();
    expect(notices).toEqual(['已同步另一设备的更新']);
  });

  it('PUT 409 且 data=null：GET /:id 自取服务端版本', async () => {
    const server = makeDetail({ id: 'sess_null_0001', updatedAt: 8888 });
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [] }));
    route('PUT', '/api/v1/agent/sessions/sess_null_0001', () =>
      jsonResponse(409, { code: 409, data: null }),
    );
    route('GET', '/api/v1/agent/sessions/sess_null_0001', () =>
      jsonResponse(200, { code: 200, data: server }),
    );
    configure();
    await reconcileAgentSessions([makeSession({ id: 'sess_null_0001', updatedAt: 100 })]);
    await flushAgentSessionSync();

    expect(adopted.map((s) => s.updatedAt)).toEqual([8888]);
  });

  it('采纳被拒绝（会话正在流式）时水位不动，下轮 flush 重试', async () => {
    const server = makeDetail({ id: 'sess_busy_0001', updatedAt: 9999 });
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [] }));
    route('PUT', '/api/v1/agent/sessions/sess_busy_0001', () =>
      jsonResponse(409, { code: 409, data: server }),
    );
    adoptResult = false; // 页面回调：流式中，拒绝采纳
    const local = makeSession({ id: 'sess_busy_0001', updatedAt: 500 });
    configure();
    await reconcileAgentSessions([local]);
    await flushAgentSessionSync();

    expect(adopted).toHaveLength(0);
    expect(notices).toEqual([]);
    expect(inspectAgentSessionSyncForTests().watermarks.has('sess_busy_0001')).toBe(false);

    // 流结束后：回调放行 → 下轮 flush 采纳成功。
    adoptResult = true;
    scheduleAgentSessionSync([local]);
    await flushAgentSessionSync();
    expect(adopted).toHaveLength(1);
    expect(inspectAgentSessionSyncForTests().watermarks.get('sess_busy_0001')).toBe(9999);
  });

  it('流式中的会话（pending 消息）绝不 PUT，流结束后的 flush 才推', async () => {
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [] }));
    route('PUT', '/api/v1/agent/sessions/sess_strm_0001', (call) => {
      const body = JSON.parse(String(call.init?.body));
      return jsonResponse(200, { code: 200, data: { ...body, id: 'sess_strm_0001' } });
    });
    const streamingSession = makeSession({
      id: 'sess_strm_0001',
      updatedAt: 700,
      messages: [makeMessage({ id: 'msg_a' }), makeMessage({ id: 'msg_b', role: 'assistant', pending: true })],
    });
    configure();
    await reconcileAgentSessions([streamingSession]);
    await flushAgentSessionSync();
    expect(calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(0);

    const done = {
      ...streamingSession,
      updatedAt: 800,
      messages: streamingSession.messages.map((m) => ({ ...m, pending: false })),
    };
    scheduleAgentSessionSync([done]);
    await flushAgentSessionSync();
    expect(calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(1);
    expect(inspectAgentSessionSyncForTests().watermarks.get('sess_strm_0001')).toBe(800);
  });

  it('PUT 失败静默（warn 一次），水位不动、下轮重试成功', async () => {
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [] }));
    let failures = 0;
    route('PUT', '/api/v1/agent/sessions/sess_fail_0001', (call) => {
      if (failures < 1) {
        failures += 1;
        return jsonResponse(500, { code: 500 });
      }
      const body = JSON.parse(String(call.init?.body));
      return jsonResponse(200, { code: 200, data: { ...body, id: 'sess_fail_0001' } });
    });
    const local = makeSession({ id: 'sess_fail_0001', updatedAt: 900 });
    configure();
    await reconcileAgentSessions([local]);
    await flushAgentSessionSync();
    expect(inspectAgentSessionSyncForTests().watermarks.has('sess_fail_0001')).toBe(false);

    scheduleAgentSessionSync([local]);
    await flushAgentSessionSync();
    expect(inspectAgentSessionSyncForTests().watermarks.get('sess_fail_0001')).toBe(900);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('删除：fire-and-forget DELETE，清水位与懒加载标记，404 静默', async () => {
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [] }));
    configure();
    await reconcileAgentSessions([makeSession({ id: 'sess_del_00001', updatedAt: 100 })]);
    deleteAgentSessionRemote('sess_del_00001');
    await vi.waitFor(() =>
      expect(
        calls.some(
          (c) => c.init?.method === 'DELETE' && c.url.endsWith('/sess_del_00001'),
        ),
      ).toBe(true),
    );
    expect(inspectAgentSessionSyncForTests().watermarks.has('sess_del_00001')).toBe(false);
  });

  it('登录用户变化时清空水位与懒加载标记', async () => {
    route('GET', '/api/v1/agent/sessions', () => jsonResponse(200, { code: 200, data: [] }));
    route('PUT', '/api/v1/agent/sessions/sess_user_0001', (call) => {
      const body = JSON.parse(String(call.init?.body));
      return jsonResponse(200, { code: 200, data: { ...body, id: 'sess_user_0001' } });
    });
    configure('u1');
    await reconcileAgentSessions([makeSession({ id: 'sess_user_0001', updatedAt: 100 })]);
    await flushAgentSessionSync();
    expect(inspectAgentSessionSyncForTests().watermarks.get('sess_user_0001')).toBe(100);

    configure('u2');
    const snap = inspectAgentSessionSyncForTests();
    expect(snap.watermarks.size).toBe(0);
    expect(snap.reconciled).toBe(false);
  });

  it('userId=null（未登录）时所有入口静默 no-op', async () => {
    configure(null);
    await reconcileAgentSessions([makeSession({ id: 'sess_anon_0001' })]);
    scheduleAgentSessionSync([makeSession({ id: 'sess_anon_0001' })]);
    await flushAgentSessionSync();
    deleteAgentSessionRemote('sess_anon_0001');
    notifyAgentSessionActivated('sess_anon_0001');
    expect(calls).toHaveLength(0);
  });

  it('reconcile 网络失败静默，后续 flush 自动补对账再推送', async () => {
    let listFailures = 0;
    route('GET', '/api/v1/agent/sessions', () => {
      if (listFailures < 1) {
        listFailures += 1;
        return jsonResponse(500, { code: 500 });
      }
      return jsonResponse(200, { code: 200, data: [] });
    });
    route('PUT', '/api/v1/agent/sessions/sess_rcvr_0001', (call) => {
      const body = JSON.parse(String(call.init?.body));
      return jsonResponse(200, { code: 200, data: { ...body, id: 'sess_rcvr_0001' } });
    });
    const local = makeSession({ id: 'sess_rcvr_0001', updatedAt: 100 });
    configure();
    await reconcileAgentSessions([local]);
    expect(inspectAgentSessionSyncForTests().reconciled).toBe(false);

    scheduleAgentSessionSync([local]);
    await flushAgentSessionSync(); // flush 内部补对账（第二次 GET 成功）→ 推送
    expect(inspectAgentSessionSyncForTests().reconciled).toBe(true);
    expect(inspectAgentSessionSyncForTests().watermarks.get('sess_rcvr_0001')).toBe(100);
  });
});
