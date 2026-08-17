import { describe, expect, it } from 'vitest';
import {
  CONTEXT_CHAR_BUDGET,
  MAX_HISTORY_MESSAGES,
  MESSAGE_CHAR_LIMIT,
  budgetHistory,
} from './contextBudget';

type Msg = { role: 'user' | 'assistant'; content: string };

const TRUNCATION_SUFFIX = '…（已截断）';

function msg(role: Msg['role'], length: number, fill = 'x'): Msg {
  return { role, content: fill.repeat(length) };
}

describe('budgetHistory', () => {
  it('returns an empty result for empty history', () => {
    expect(budgetHistory([])).toEqual({
      history: [],
      droppedMessages: 0,
      truncatedMessages: 0,
      totalChars: 0,
    });
  });

  it('passes a short conversation through untouched', () => {
    const messages: Msg[] = [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '第二问' },
    ];
    const result = budgetHistory(messages);
    expect(result.history).toEqual(messages);
    expect(result.droppedMessages).toBe(0);
    expect(result.truncatedMessages).toBe(0);
    expect(result.totalChars).toBe(9);
  });

  it('always keeps the final user question, truncating it when overlong', () => {
    const result = budgetHistory([msg('user', MESSAGE_CHAR_LIMIT + 5000)]);
    expect(result.history).toHaveLength(1);
    expect(result.history[0].content).toHaveLength(
      MESSAGE_CHAR_LIMIT + TRUNCATION_SUFFIX.length,
    );
    expect(result.history[0].content.endsWith(TRUNCATION_SUFFIX)).toBe(true);
    expect(result.truncatedMessages).toBe(1);
    expect(result.droppedMessages).toBe(0);
    expect(result.totalChars).toBe(MESSAGE_CHAR_LIMIT + TRUNCATION_SUFFIX.length);
  });

  it('truncates an overlong history message before counting it into the budget', () => {
    const result = budgetHistory([msg('user', 9000), msg('user', 10, 'q')]);
    expect(result.history).toHaveLength(2);
    expect(result.history[0].content.endsWith(TRUNCATION_SUFFIX)).toBe(true);
    expect(result.truncatedMessages).toBe(1);
    expect(result.totalChars).toBe(MESSAGE_CHAR_LIMIT + TRUNCATION_SUFFIX.length + 10);
  });

  it('keeps history that lands exactly on the budget', () => {
    // 1000 + 7000 + 6000 + 7000 + 7000 = 28000 = CONTEXT_CHAR_BUDGET
    const messages: Msg[] = [
      msg('user', 7000),
      msg('assistant', 6000),
      msg('user', 7000),
      msg('assistant', 7000),
      msg('user', 1000),
    ];
    const result = budgetHistory(messages);
    expect(result.history).toHaveLength(5);
    expect(result.droppedMessages).toBe(0);
    expect(result.totalChars).toBe(CONTEXT_CHAR_BUDGET);
  });

  it('drops oldest-first once over budget and never leaves an orphan assistant head', () => {
    // 回填到 a1 时累计 21000，再收 u1(7001) 将超预算 → 停止；
    // 打头的 a1 孤儿随其配对的 u1 一并丢弃。
    const messages: Msg[] = [
      msg('user', 7001), // u1 —— 超预算被丢
      msg('assistant', 6000), // a1 —— 孤儿，按轮对齐一并丢
      msg('user', 7000), // u2
      msg('assistant', 7000), // a2
      msg('user', 1000), // 本轮提问
    ];
    const result = budgetHistory(messages);
    expect(result.history.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(result.droppedMessages).toBe(2);
    expect(result.totalChars).toBe(15000);
  });

  it('drops a pre-existing orphan assistant at the head of history', () => {
    // 历史本身以 assistant 开头（此前已被裁过）—— 即便预算充裕也要剥掉，
    // 否则严格交替的 provider 会 400。
    const messages: Msg[] = [
      msg('assistant', 10),
      msg('user', 10),
      msg('assistant', 10),
      msg('user', 10),
    ];
    const result = budgetHistory(messages);
    expect(result.history.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(result.droppedMessages).toBe(1);
    expect(result.totalChars).toBe(30);
  });

  it('handles an even-length window by re-aligning to a user head', () => {
    // 偶数条窗口切在轮中间：打头是 assistant → 丢 1 条对齐
    const messages: Msg[] = [
      msg('user', 9000), // 截断后 7606，配合后续消息把预算逼近上限
      msg('assistant', 9000),
      msg('user', 7000),
      msg('assistant', 5000),
      msg('user', 1000),
    ];
    // 回填：a(5000)→u(7000)→a(截断 7606) 累计 20606，再收 u(截断 7606) 将到
    // 28212 > 28000 → 停止；打头 assistant 被剥掉。
    const result = budgetHistory(messages);
    expect(result.history.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(result.droppedMessages).toBe(2);
    // 被丢弃的截断消息不计入 truncatedMessages
    expect(result.truncatedMessages).toBe(0);
    expect(result.totalChars).toBe(13000);
  });

  it('caps the outgoing window at MAX_HISTORY_MESSAGES', () => {
    // 70 条超短消息（预算无压力），条数上限先生效
    const messages: Msg[] = Array.from({ length: 70 }, (_, i) => ({
      role: i % 2 === 0 ? ('assistant' as const) : ('user' as const),
      content: `m${i}`,
    }));
    // 末条 index 69 是 user（本轮提问）
    const result = budgetHistory(messages);
    expect(result.history.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    // 条数截断切出的打头 assistant 也被对齐剥掉
    expect(result.history[0].role).toBe('user');
    expect(result.history[result.history.length - 1].content).toBe('m69');
    expect(result.droppedMessages).toBe(70 - result.history.length);
    expect(result.history).toHaveLength(59);
  });
});
