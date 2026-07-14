import { describe, expect, it } from 'vitest';
import type { KnowledgeWorkspaceHandoff } from '@/services/knowledgeWorkspaceHandoff';
import {
  clearSessionKnowledgeHandoff,
  getSessionKnowledgeHandoff,
  preserveContextSelectionAfterSuccess,
  preserveSessionKnowledgeHandoffAfterSuccess,
  resolveAetherHubKnowledgeContext,
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

});
