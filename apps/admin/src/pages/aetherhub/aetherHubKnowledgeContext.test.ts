import { describe, expect, it } from 'vitest';
import type { KnowledgeWorkspaceHandoff } from '@/services/knowledgeWorkspaceHandoff';
import {
  clearSessionKnowledgeHandoff,
  createAetherHubRequestSnapshot,
  getSessionKnowledgeHandoff,
  preserveContextSelectionAfterSuccess,
  preserveContextSelectionKeysAfterSuccess,
  preserveSessionKnowledgeHandoffAfterSuccess,
  readAetherHubRequestSnapshot,
  resolveAetherHubKnowledgeContext,
  selectAetherHubKnowledgeContext,
} from './aetherHubKnowledgeContext';

describe('AetherHub knowledge context resolution', () => {
  it('uses an explicit workbench handoff before manually selected picker values', () => {
    const result = resolveAetherHubKnowledgeContext(
      { mode: 'none' },
      [{ id: 7, name: '产品资料' }],
      [{ id: 9, title: 'RAG 原理' }],
    );

    expect(result).toEqual({
      ok: true,
      value: { knowledgeContextMode: 'none', kbIds: null, atlasScope: null },
    });
  });

  it('turns manual picker values into an explicit selected context', () => {
    const result = resolveAetherHubKnowledgeContext(
      null,
      [{ id: 7, name: ' 产品资料 ' }],
      [{ id: 9, title: ' RAG 原理 ' }],
    );

    expect(result).toEqual({
      ok: true,
      value: {
        knowledgeContextMode: 'selected',
        kbIds: [7],
        atlasScope: {
          kpIds: [9],
          carrierIds: [],
          neighborhoodDepth: 0,
          includeEvidence: true,
          semanticRecall: false,
          semanticLimit: 8,
        },
      },
    });
  });

  it('keeps empty picker state in automatic mode and omits kbIds', () => {
    const result = resolveAetherHubKnowledgeContext(null, [], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.knowledgeContextMode).toBe('auto');
    expect(Object.hasOwn(result.value, 'kbIds')).toBe(false);
    expect(result.value.atlasScope).toMatchObject({
      kpIds: [],
      carrierIds: [],
      semanticRecall: true,
    });
    expect(JSON.stringify(result.value)).not.toContain('kbIds');
  });
});

describe('AetherHub session-scoped handoffs', () => {
  const handoff: KnowledgeWorkspaceHandoff = {
    schemaVersion: 1,
    userId: 'user-1',
    origin: 'knowledge-workspace',
    intent: 'ask',
    context: { mode: 'selected', refs: [{ kind: 'knowledge-base', id: 7, label: '产品资料' }] },
    draftPrompt: '总结产品资料',
    createdAt: 100,
    expiresAt: 200,
  };

  it('exposes a pending handoff only to the session created for it', () => {
    const pending = { sessionId: 'handoff-session', handoff };

    expect(getSessionKnowledgeHandoff(pending, 'handoff-session')).toBe(pending);
    expect(getSessionKnowledgeHandoff(pending, 'unrelated-session')).toBeNull();
    expect(getSessionKnowledgeHandoff(pending, null)).toBeNull();
  });

  it('clears the handoff when its owning session is deleted but preserves unrelated handoffs', () => {
    const pending = { sessionId: 'handoff-session', handoff };

    expect(clearSessionKnowledgeHandoff(pending, 'handoff-session')).toBeNull();
    expect(clearSessionKnowledgeHandoff(pending, 'unrelated-session')).toBe(pending);
  });

  it('clears only the exact session handoff snapshot sent by a successful request', () => {
    const sent = { sessionId: 'handoff-session', handoff };
    const replacement = {
      sessionId: 'handoff-session',
      handoff: { ...handoff, draftPrompt: '比较客服资料', createdAt: 101, expiresAt: 201 },
    };

    expect(preserveSessionKnowledgeHandoffAfterSuccess(sent, sent)).toBeNull();
    expect(preserveSessionKnowledgeHandoffAfterSuccess(replacement, sent)).toBe(replacement);
  });
});

describe('AetherHub request context snapshots', () => {
  it('clears a source selection only when it still matches the sent snapshot', () => {
    const sent = [{ id: 7, name: '产品资料' }];

    expect(preserveContextSelectionAfterSuccess(sent, sent, (item) => item.id)).toEqual([]);
  });

  it('preserves sources added for the next turn while the previous answer was streaming', () => {
    const sent = [{ id: 7, name: '产品资料' }];
    const current = [...sent, { id: 8, name: '客服记录' }];

    expect(preserveContextSelectionAfterSuccess(current, sent, (item) => item.id)).toBe(current);
  });

  it('preserves a replacement selection made during streaming', () => {
    const sent = [{ slug: 'release', name: '发版' }];
    const current = [{ slug: 'support', name: '客服' }];

    expect(
      preserveContextSelectionAfterSuccess(current, sent, (item) => item.slug),
    ).toBe(current);
  });

  it('consumes an unchanged failed-request selection on retry but preserves newer picker edits', () => {
    const unchanged = [{ id: 7, name: '产品资料' }];
    const replacement = [{ id: 8, name: '客服资料' }];

    expect(
      preserveContextSelectionKeysAfterSuccess(unchanged, [7], (item) => item.id),
    ).toEqual([]);
    expect(
      preserveContextSelectionKeysAfterSuccess(replacement, [7], (item) => item.id),
    ).toBe(replacement);
  });

  it('captures an immutable selected request scope for retries after pickers are cleared', () => {
    const knowledgeContext = selectAetherHubKnowledgeContext(
      null,
      [{ id: 7, name: '产品资料' }],
      [{ id: 9, title: 'RAG 原理' }],
    );
    const articleIds = [11];
    const tagSlugs = ['release'];

    const snapshot = createAetherHubRequestSnapshot(
      knowledgeContext,
      articleIds,
      tagSlugs,
    );
    articleIds.push(12);
    tagSlugs.push('support');
    if (knowledgeContext.mode === 'selected') {
      knowledgeContext.refs.push({ kind: 'knowledge-base', id: 8, label: '客服资料' });
    }

    expect(snapshot).toEqual({
      schemaVersion: 1,
      knowledgeContext: {
        mode: 'selected',
        refs: [
          { kind: 'knowledge-base', id: 7, label: '产品资料' },
          { kind: 'atlas-kp', id: 9, label: 'RAG 原理' },
        ],
      },
      articleIds: [11],
      tagSlugs: ['release'],
    });
    expect(resolveAetherHubKnowledgeContext(snapshot.knowledgeContext, [], [])).toEqual({
      ok: true,
      value: {
        knowledgeContextMode: 'selected',
        kbIds: [7],
        atlasScope: {
          kpIds: [9],
          carrierIds: [],
          neighborhoodDepth: 0,
          includeEvidence: true,
          semanticRecall: false,
          semanticLimit: 8,
        },
      },
    });
  });

  it.each(['auto', 'none'] as const)(
    'round-trips an explicit %s request instead of falling back to current picker state',
    (mode) => {
      const snapshot = createAetherHubRequestSnapshot({ mode }, [], []);
      const message = {
        id: 'message-1',
        role: 'user' as const,
        content: '解释本轮结果',
        createdAt: 100,
        requestSnapshot: snapshot,
      };

      expect(readAetherHubRequestSnapshot(message)).toEqual({ status: 'valid', snapshot });
      expect(
        resolveAetherHubKnowledgeContext(snapshot.knowledgeContext, [{ id: 7, name: '新选择' }], []),
      ).toMatchObject({
        ok: true,
        value: { knowledgeContextMode: mode },
      });
    },
  );

  it('distinguishes legacy messages from malformed versioned snapshots', () => {
    const legacyMessage = {
      id: 'legacy',
      role: 'user' as const,
      content: '旧消息',
      createdAt: 100,
    };
    const malformedMessage = {
      ...legacyMessage,
      id: 'malformed',
      requestSnapshot: { schemaVersion: 2 },
    };

    expect(readAetherHubRequestSnapshot(legacyMessage)).toEqual({ status: 'missing' });
    expect(readAetherHubRequestSnapshot(malformedMessage)).toEqual({
      status: 'invalid',
      message: '历史请求的知识范围已损坏或版本不受支持，无法安全重试。',
    });
  });

});
