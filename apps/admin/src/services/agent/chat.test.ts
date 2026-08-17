import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamAgentChat, type ChatStreamRequest } from './chat';

const request: ChatStreamRequest = {
  sessionId: 'session-1',
  mode: 'chat',
  knowledgeContextMode: 'auto',
  messages: [{ role: 'user', content: '请总结资料' }],
};

function mockResponse(response: Response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamAgentChat HTTP errors', () => {
  it('keeps a safe business 403 message returned by the server', async () => {
    mockResponse(
      new Response(
        JSON.stringify({
          code: 403,
          message: '无法使用所选知识库',
          errorCategory: 'forbidden',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const onError = vi.fn();

    await streamAgentChat(request, { onError });

    expect(onError).toHaveBeenCalledWith('无法使用所选知识库');
  });

  it('maps a 401 response to an expired login message marked non-retryable', async () => {
    mockResponse(
      new Response(JSON.stringify({ code: 401, message: 'Token无效' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const onError = vi.fn();

    await streamAgentChat(request, { onError });

    // 登录态失效重试没有意义，必须显式标记 retryable: false
    expect(onError).toHaveBeenCalledWith('登录状态已过期，请重新登录', { retryable: false });
  });

  it('still treats an authentication-classified 403 as an expired login', async () => {
    mockResponse(
      new Response(
        JSON.stringify({
          code: 2002,
          message: 'Token无效',
          errorCategory: 'unauthorized',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const onError = vi.fn();

    await streamAgentChat(request, { onError });

    expect(onError).toHaveBeenCalledWith('登录状态已过期，请重新登录', { retryable: false });
  });
});

describe('streamAgentChat completion', () => {
  it('serializes the explicit knowledge context mode', async () => {
    mockResponse(
      new Response('data: {"type":"done"}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    await streamAgentChat(
      { ...request, knowledgeContextMode: 'none', kbIds: null, atlasScope: null },
      {},
    );

    const fetchMock = vi.mocked(fetch);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      knowledgeContextMode: 'none',
      kbIds: null,
      atlasScope: null,
    });
  });

  it('keeps a retrieval receipt before a controlled selected-context error', async () => {
    mockResponse(
      new Response(
        [
          'data: {"type":"retrieval","version":1,"status":"empty","requested":{"knowledgeBaseIds":[3],"atlasKnowledgePointIds":[],"atlasCarrierIds":[]},"hits":[],"warnings":[]}',
          'data: {"type":"error","code":"selected_context_not_grounded","message":"未能从所选来源找到足够依据。请调整问题或重新选择来源后再试。","retryable":true}',
          '',
        ].join('\n\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    const calls: string[] = [];

    await streamAgentChat(request, {
      onRetrieval: (receipt) => calls.push(`retrieval:${receipt.status}`),
      onDelta: (chunk) => calls.push(`delta:${chunk}`),
      onError: (message) => calls.push(`error:${message}`),
    });

    expect(calls).toEqual([
      'retrieval:empty',
      'error:未能从所选来源找到足够依据。请调整问题或重新选择来源后再试。',
    ]);
  });

  it('delivers a versioned retrieval receipt before answer chunks', async () => {
    mockResponse(
      new Response(
        [
          'data: {"type":"retrieval","version":1,"status":"matched","requested":{"knowledgeBaseIds":[3],"atlasKnowledgePointIds":[],"atlasCarrierIds":[]},"hits":[{"key":"kb:docs:9:2","kind":"knowledge_base_chunk","title":"部署手册","sourceTitle":"产品文档","snippet":"上线前先完成数据库迁移。","score":0.87,"rank":1,"href":"/admin/intelligence/knowledge/docs"}],"warnings":[]}',
          'data: {"type":"delta","content":"根据部署手册"}',
          'data: {"type":"done"}',
          '',
        ].join('\n\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    const calls: string[] = [];
    const onRetrieval = vi.fn((receipt) => calls.push(`retrieval:${receipt.hits.length}`));
    const onDelta = vi.fn((chunk) => calls.push(`delta:${chunk}`));

    await streamAgentChat(request, { onRetrieval, onDelta });

    expect(onRetrieval).toHaveBeenCalledWith({
      version: 1,
      status: 'matched',
      requested: {
        knowledgeBaseIds: [3],
        atlasKnowledgePointIds: [],
        atlasCarrierIds: [],
      },
      hits: [
        {
          key: 'kb:docs:9:2',
          kind: 'knowledge_base_chunk',
          title: '部署手册',
          sourceTitle: '产品文档',
          snippet: '上线前先完成数据库迁移。',
          score: 0.87,
          rank: 1,
          href: '/admin/intelligence/knowledge/docs',
        },
      ],
      warnings: [],
    });
    expect(calls).toEqual(['retrieval:1', 'delta:根据部署手册']);
  });

  it('ignores malformed retrieval receipts instead of trusting partial upstream data', async () => {
    mockResponse(
      new Response(
        [
          'data: {"type":"retrieval","version":2,"status":"matched","hits":"not-an-array"}',
          'data: {"type":"done"}',
          '',
        ].join('\n\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    const onRetrieval = vi.fn();

    await streamAgentChat(request, { onRetrieval });

    expect(onRetrieval).not.toHaveBeenCalled();
  });

  it('reports an incomplete stream when the connection reaches EOF without done', async () => {
    mockResponse(
      new Response('data: {"type":"delta","content":"部分回答"}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const onDelta = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamAgentChat(request, { onDelta, onDone, onError });

    expect(onDelta).toHaveBeenCalledWith('部分回答');
    expect(onDone).not.toHaveBeenCalled();
    // 未收 done 的断流是可恢复的网络故障，标记 retryable: true 让 UI 直接亮出重试按钮
    expect(onError).toHaveBeenCalledWith('回答流意外中断，请重试', { retryable: true });
  });

  it('processes a trailing event that arrives without the final blank line', async () => {
    // 部分服务端/代理在最后一个事件后直接断开、不发终止空行 ——
    // EOF 兜底必须补处理缓冲区里的尾事件，否则完整回答被误报成中断
    mockResponse(
      new Response('data: {"type":"delta","content":"完整回答"}\n\ndata: {"type":"done"}', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const onDelta = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamAgentChat(request, { onDelta, onDone, onError });

    expect(onDelta).toHaveBeenCalledWith('完整回答');
    expect(onDone).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onDone only after an explicit done event', async () => {
    mockResponse(
      new Response(
        'data: {"type":"delta","content":"完整回答"}\n\ndata: {"type":"done"}\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamAgentChat(request, { onDone, onError });

    expect(onDone).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('streamAgentChat usage events', () => {
  it('delivers a well-formed usage event before done', async () => {
    mockResponse(
      new Response(
        [
          'data: {"type":"delta","content":"回答"}',
          'data: {"type":"usage","promptTokens":128,"completionTokens":64,"totalTokens":192,"estimated":false}',
          'data: {"type":"done"}',
          '',
        ].join('\n\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    const onUsage = vi.fn();
    const onDone = vi.fn();

    await streamAgentChat(request, { onUsage, onDone });

    expect(onUsage).toHaveBeenCalledExactlyOnceWith({
      promptTokens: 128,
      completionTokens: 64,
      totalTokens: 192,
      estimated: false,
    });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('drops the whole usage packet when a token field is missing', async () => {
    // totalTokens 缺失 —— 整包丢弃，绝不把半截数据写进会话统计
    mockResponse(
      new Response(
        [
          'data: {"type":"usage","promptTokens":128,"completionTokens":64,"estimated":true}',
          'data: {"type":"done"}',
          '',
        ].join('\n\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    const onUsage = vi.fn();
    const onDone = vi.fn();

    await streamAgentChat(request, { onUsage, onDone });

    expect(onUsage).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('drops the whole usage packet when a token field is not a number', async () => {
    mockResponse(
      new Response(
        [
          'data: {"type":"usage","promptTokens":"128","completionTokens":64,"totalTokens":192,"estimated":false}',
          'data: {"type":"done"}',
          '',
        ].join('\n\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    const onUsage = vi.fn();

    await streamAgentChat(request, { onUsage });

    expect(onUsage).not.toHaveBeenCalled();
  });

  it('drops the whole usage packet when estimated is not a boolean', async () => {
    mockResponse(
      new Response(
        [
          'data: {"type":"usage","promptTokens":128,"completionTokens":64,"totalTokens":192,"estimated":"yes"}',
          'data: {"type":"done"}',
          '',
        ].join('\n\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    const onUsage = vi.fn();

    await streamAgentChat(request, { onUsage });

    expect(onUsage).not.toHaveBeenCalled();
  });
});

describe('streamAgentChat structured error meta', () => {
  it('passes through code and retryable from the SSE error event', async () => {
    mockResponse(
      new Response(
        'data: {"type":"error","code":"selected_context_not_grounded","message":"未能找到依据","retryable":true}\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    const onError = vi.fn();

    await streamAgentChat(request, { onError });

    expect(onError).toHaveBeenCalledExactlyOnceWith('未能找到依据', {
      code: 'selected_context_not_grounded',
      retryable: true,
    });
  });

  it('leaves meta fields undefined when the error event carries wrong types', async () => {
    // code 非字符串 / retryable 非布尔 —— 置 undefined（未知），不猜测
    mockResponse(
      new Response(
        'data: {"type":"error","code":500,"message":"上游异常","retryable":"maybe"}\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    const onError = vi.fn();

    await streamAgentChat(request, { onError });

    expect(onError).toHaveBeenCalledExactlyOnceWith('上游异常', {
      code: undefined,
      retryable: undefined,
    });
  });
});

describe('streamAgentChat multimodal content parts', () => {
  it('serializes content part arrays without losing fields', async () => {
    mockResponse(
      new Response('data: {"type":"done"}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const parts = [
      { type: 'text' as const, text: '这张图里是什么？' },
      { type: 'image_url' as const, image_url: { url: 'https://cdn.example.com/a.png' } },
    ];
    await streamAgentChat(
      { ...request, messages: [{ role: 'user', content: parts }] },
      {},
    );

    const fetchMock = vi.mocked(fetch);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body)).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '这张图里是什么？' },
          { type: 'image_url', image_url: { url: 'https://cdn.example.com/a.png' } },
        ],
      },
    ]);
  });
});
