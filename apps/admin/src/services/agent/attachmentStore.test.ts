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

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('attachmentStore：环境无 IndexedDB（node / 隐私模式兜底）', () => {
  it('putAttachmentData 静默 no-op，不抛异常', async () => {
    const store = await freshStore();
    await expect(store.putAttachmentData('att_1', 'data:image/png;base64,AAAA')).resolves.toBeUndefined();
  });

  it('getAttachmentData 返回 null', async () => {
    const store = await freshStore();
    await expect(store.getAttachmentData('att_1')).resolves.toBeNull();
  });

  it('deleteAttachmentData 静默 no-op', async () => {
    const store = await freshStore();
    await expect(store.deleteAttachmentData(['att_1', 'att_2'])).resolves.toBeUndefined();
  });
});

describe('attachmentStore：IndexedDB 存在但 open 失败（Firefox 隐私模式形态）', () => {
  /** open 请求异步触发 onerror —— 模拟隐私模式拒绝打开数据库。 */
  function installFailingIndexedDB() {
    const open = () => {
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
    };
    (globalThis as { indexedDB?: unknown }).indexedDB = { open };
  }

  it('put / get / delete 全部静默降级，不向上抛错', async () => {
    installFailingIndexedDB();
    const store = await freshStore();
    await expect(store.putAttachmentData('att_1', 'data:image/png;base64,AAAA')).resolves.toBeUndefined();
    await expect(store.getAttachmentData('att_1')).resolves.toBeNull();
    await expect(store.deleteAttachmentData(['att_1'])).resolves.toBeUndefined();
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
