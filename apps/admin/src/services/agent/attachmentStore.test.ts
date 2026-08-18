import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from './sessions';

/**
 * attachmentStore 是模块级单例（wrapper 缓存），每个用例通过 resetModules
 * 拿全新副本，避免上一个用例的「环境判定」结果泄漏到下一个。
 */
async function freshStore() {
  vi.resetModules();
  return import('./attachmentStore');
}

/** IndexedDBWrapper 调用探针 —— 用来断言「降级 = 一次都没碰持久层」。 */
interface WrapperProbe {
  constructed: number;
  put: number;
  get: number;
  delete: number;
}

/**
 * 用探针类替换 `@aetherblog/utils` 的 IndexedDBWrapper。
 *
 * 只断言「resolves 不抛错」是恒真的（任何 `Promise<void>` 函数都满足），证明不了
 * no-op 语义；探针把「没有构造 wrapper、没有发起任何 put/get/delete」变成可断言的事实。
 * 必须在 freshStore() 之前调用 —— doMock 只对之后发生的 import 生效。
 */
function installWrapperProbe(): WrapperProbe {
  const probe: WrapperProbe = { constructed: 0, put: 0, get: 0, delete: 0 };
  vi.doMock('@aetherblog/utils', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('@aetherblog/utils');
    return {
      ...actual,
      IndexedDBWrapper: class {
        constructor() {
          probe.constructed += 1;
        }
        async put() {
          probe.put += 1;
        }
        async get() {
          probe.get += 1;
          return undefined;
        }
        async delete() {
          probe.delete += 1;
        }
      },
    };
  });
  return probe;
}

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  vi.doUnmock('@aetherblog/utils');
});

describe('attachmentStore：环境无 IndexedDB（node / 隐私模式兜底）', () => {
  it('三个入口全部降级：不构造 wrapper，也不发起任何读写', async () => {
    const probe = installWrapperProbe();
    const store = await freshStore();

    await store.putAttachmentData('att_1', 'data:image/png;base64,AAAA');
    await store.getAttachmentData('att_1');
    await store.deleteAttachmentData(['att_1', 'att_2']);

    // 环境判定为不可用 → 连 wrapper 都不该被 new 出来，更不该有任何 IO。
    expect(probe).toEqual({ constructed: 0, put: 0, get: 0, delete: 0 });
  });

  it('getAttachmentData 返回 null（而非 undefined），调用方可直接判空走占位卡片', async () => {
    const store = await freshStore();
    const result = await store.getAttachmentData('att_1');
    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });

  it('putAttachmentData 无副作用：写完再读仍是 null（没有隐式内存兜底）', async () => {
    const store = await freshStore();
    await store.putAttachmentData('att_1', 'data:image/png;base64,AAAA');
    await expect(store.getAttachmentData('att_1')).resolves.toBeNull();
  });

  it('deleteAttachmentData 静默 no-op：resolve 且不抛错', async () => {
    const store = await freshStore();
    await expect(store.deleteAttachmentData(['att_1', 'att_2'])).resolves.toBeUndefined();
  });
});

describe('attachmentStore：IndexedDB 存在但 open 失败（Firefox 隐私模式形态）', () => {
  /** open 请求异步触发 onerror —— 模拟隐私模式拒绝打开数据库。 */
  function installFailingIndexedDB() {
    const open = vi.fn(() => {
      const request: {
        error?: Error;
        onerror?: () => void;
        onsuccess?: () => void;
        onupgradeneeded?: (event: unknown) => void;
      } = {};
      setTimeout(() => {
        request.error = new Error('open blocked');
        request.onerror?.();
      }, 0);
      return request;
    });
    (globalThis as { indexedDB?: unknown }).indexedDB = { open };
    return open;
  }

  it('put / get / delete 全部静默降级，不向上抛错', async () => {
    const open = installFailingIndexedDB();
    const store = await freshStore();
    await expect(store.putAttachmentData('att_1', 'data:image/png;base64,AAAA')).resolves.toBeUndefined();
    await expect(store.getAttachmentData('att_1')).resolves.toBeNull();
    await expect(store.deleteAttachmentData(['att_1'])).resolves.toBeUndefined();
    // 与「环境无 IndexedDB」用例区分：这里必须真的尝试过 open，
    // 否则测的是「wrapper 根本没被构造」的另一条分支。
    expect(open).toHaveBeenCalled();
  });
});

describe('attachmentStore：IndexedDB 可用时确实走持久层', () => {
  it('put / get / delete 各命中 wrapper 一次 —— 反证上面的「探针全 0」不是恒真断言', async () => {
    const probe = installWrapperProbe();
    // 只要 `typeof indexedDB !== 'undefined'` 就会构造 wrapper；本用例的 IO 由探针接管。
    (globalThis as { indexedDB?: unknown }).indexedDB = {};
    const store = await freshStore();

    await store.putAttachmentData('att_1', 'data:image/png;base64,AAAA');
    await store.getAttachmentData('att_1');
    await store.deleteAttachmentData(['att_1']);

    expect(probe).toEqual({ constructed: 1, put: 1, get: 1, delete: 1 });
  });

  it('空 id / 空 dataUrl / 空数组是参数级短路，不产生任何 IO', async () => {
    const probe = installWrapperProbe();
    (globalThis as { indexedDB?: unknown }).indexedDB = {};
    const store = await freshStore();

    await store.putAttachmentData('', 'data:image/png;base64,AAAA');
    await store.putAttachmentData('att_1', '');
    await store.getAttachmentData('');
    await store.deleteAttachmentData([]);

    expect(probe.put).toBe(0);
    expect(probe.get).toBe(0);
    expect(probe.delete).toBe(0);
  });
});

describe('collectAttachmentIds', () => {
  function msg(attachmentIds: string[] | undefined): Pick<AgentMessage, 'attachments'> {
    return {
      attachments: attachmentIds?.map((id) => ({
        id,
        kind: 'image' as const,
        mime: 'image/png',
        name: 'x.png',
        size: 1,
        dataUrl: '',
      })),
    };
  }

  it('跨消息收集全部附件 id，保持出现顺序', async () => {
    const store = await freshStore();
    const messages = [msg(['a', 'b']), msg(undefined), msg([]), msg(['c'])];
    expect(store.collectAttachmentIds(messages)).toEqual(['a', 'b', 'c']);
  });

  it('无附件时返回空数组', async () => {
    const store = await freshStore();
    expect(store.collectAttachmentIds([msg(undefined), msg([])])).toEqual([]);
  });

  it('跳过空 id（脏数据防御）', async () => {
    const store = await freshStore();
    expect(store.collectAttachmentIds([msg(['', 'x'])])).toEqual(['x']);
  });
});

describe('collectReclaimableAttachmentIds（回收前引用计数）', () => {
  function msg(attachmentIds: string[] | undefined): Pick<AgentMessage, 'attachments'> {
    return {
      attachments: attachmentIds?.map((id) => ({
        id,
        kind: 'image' as const,
        mime: 'image/png',
        name: 'x.png',
        size: 1,
        dataUrl: '',
      })),
    };
  }
  const sessionOf = (...messages: Pick<AgentMessage, 'attachments'>[]) => ({ messages });

  it('跨会话共享的附件 id（分支会话）不回收 —— 另一方仍在引用', async () => {
    const store = await freshStore();
    // 删除原会话：候选 [a, b]；分支会话仍引用 a → 只回收 b。
    const survivors = [sessionOf(msg(['a']), msg(undefined)), sessionOf(msg([]))];
    expect(store.collectReclaimableAttachmentIds(['a', 'b'], survivors)).toEqual(['b']);
  });

  it('无任何存活引用时全部回收，且候选去重', async () => {
    const store = await freshStore();
    const survivors = [sessionOf(msg(['other']))];
    expect(store.collectReclaimableAttachmentIds(['a', 'b', 'a'], survivors)).toEqual(['a', 'b']);
  });

  it('同一会话内部分截断：留存消息仍引用的 id 不回收', async () => {
    const store = await freshStore();
    // 截断尾部消息（候选 [a, b]），但留存的头部消息仍引用 a（同图多次发送）。
    const survivors = [sessionOf(msg(['a']))];
    expect(store.collectReclaimableAttachmentIds(['a', 'b'], survivors)).toEqual(['b']);
  });

  it('候选为空返回空数组；空 id 剔除', async () => {
    const store = await freshStore();
    expect(store.collectReclaimableAttachmentIds([], [sessionOf(msg(['a']))])).toEqual([]);
    expect(store.collectReclaimableAttachmentIds(['', 'b'], [sessionOf(msg([]))])).toEqual(['b']);
  });
});
