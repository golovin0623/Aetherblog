import { describe, expect, it } from 'vitest';
import { buildOutboundMessages, type WritingChatMessage } from './useWritingChat';

function user(id: string, content: string, outbound?: string): WritingChatMessage {
  return { id, role: 'user', content, outbound, createdAt: 0 };
}

function assistant(id: string, content: string, extra?: Partial<WritingChatMessage>): WritingChatMessage {
  return { id, role: 'assistant', content, createdAt: 0, ...extra };
}

describe('buildOutboundMessages', () => {
  it('只对本轮 user 消息使用携带全文的 outbound,历史轮回落展示文本', () => {
    // 回归:历史每条都用 outbound 时,数轮后累计超后端 32000 字符封顶 → 413 死局
    const fat = 'A'.repeat(6000);
    const history = [
      user('u1', '问题一', `${fat}\n\n问题一`),
      assistant('a1', '回答一'),
      user('u2', '问题二', `${fat}\n\n问题二`),
    ];

    const out = buildOutboundMessages(history);

    expect(out.map((m) => m.content)).toEqual(['问题一', '回答一', `${fat}\n\n问题二`]);
    expect(out.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThan(30000);
  });

  it('按轮配对截断,首条永远是 user(不产出孤儿 assistant)', () => {
    // 回归:裸按消息数 slice 会切出打头的 assistant,严格交替的 provider 直接 400
    const history: WritingChatMessage[] = [];
    for (let i = 1; i <= 9; i += 1) {
      history.push(user(`u${i}`, `问题${i}`));
      history.push(assistant(`a${i}`, `回答${i}`));
    }

    const out = buildOutboundMessages(history);

    expect(out[0].role).toBe('user');
    expect(out).toHaveLength(12); // 6 轮 × 2
    expect(out[out.length - 1].content).toBe('回答9');
    out.forEach((message, index) => {
      expect(message.role).toBe(index % 2 === 0 ? 'user' : 'assistant');
    });
  });

  it('超预算时从最旧的整轮开始丢弃,至少保留本轮', () => {
    const bulky = 'B'.repeat(9000);
    const history = [
      user('u1', bulky),
      assistant('a1', bulky),
      user('u2', bulky),
      assistant('a2', bulky),
      user('u3', '最后一问'),
    ];

    const out = buildOutboundMessages(history);

    expect(out.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(30000);
    expect(out[0].role).toBe('user');
    expect(out[out.length - 1].content).toBe('最后一问');
  });

  it('丢弃在途与空回复,不把占位气泡发给模型', () => {
    const history = [
      user('u1', '问题一'),
      assistant('a1', ''), // 出错的空回复
      user('u2', '问题二'),
      assistant('a2', '', { pending: true }), // 在途占位
    ];

    const out = buildOutboundMessages(history);

    expect(out).toEqual([
      { role: 'user', content: '问题一' },
      { role: 'user', content: '问题二' },
    ]);
  });

  it('历史被裁到以 assistant 打头时丢弃该孤儿', () => {
    const history = [assistant('a0', '孤儿回答'), user('u1', '问题一')];

    const out = buildOutboundMessages(history);

    expect(out).toEqual([{ role: 'user', content: '问题一' }]);
  });
});
