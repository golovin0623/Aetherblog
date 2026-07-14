import { describe, expect, it } from 'vitest';
import {
  createEmptySession,
  readAgentSessionDraft,
  resolveAgentSessionDraftAfterRequestStart,
  withAgentSessionDraft,
  type AgentSession,
} from './sessions';

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
