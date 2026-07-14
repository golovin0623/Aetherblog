import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KNOWLEDGE_HANDOFF_TTL_MS,
  MAX_KNOWLEDGE_HANDOFF_TTL_MS,
  adaptKnowledgeContextToChat,
  consumeKnowledgeWorkspaceHandoff,
  knowledgeWorkspaceHandoffStorageKey,
  storeKnowledgeWorkspaceHandoff,
  type KnowledgeContextRef,
  type KnowledgeContextSelection,
  type KnowledgeHandoffStorage,
  type KnowledgeWorkspaceHandoffInput,
} from './knowledgeWorkspaceHandoff';

const NOW = 1_800_000_000_000;

class MemoryStorage implements KnowledgeHandoffStorage {
  readonly values = new Map<string, string>();
  readonly operations: string[] = [];
  throwOnGet = false;
  throwOnSet = false;
  throwOnRemove = false;

  getItem(key: string): string | null {
    this.operations.push(`get:${key}`);
    if (this.throwOnGet) throw new Error('get denied');
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.operations.push(`set:${key}`);
    if (this.throwOnSet) throw new Error('quota exceeded');
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.operations.push(`remove:${key}`);
    if (this.throwOnRemove) throw new Error('remove denied');
    this.values.delete(key);
  }
}

function input(overrides: Partial<KnowledgeWorkspaceHandoffInput> = {}): KnowledgeWorkspaceHandoffInput {
  return {
    userId: 'user-1',
    origin: 'knowledge-workspace',
    intent: 'ask',
    context: { mode: 'auto' },
    draftPrompt: 'Which sources disagree?',
    ...overrides,
  };
}

function rawHandoff(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    userId: 'user-1',
    origin: 'knowledge-workspace',
    intent: 'ask',
    context: { mode: 'auto' },
    draftPrompt: 'Which sources disagree?',
    createdAt: NOW,
    expiresAt: NOW + DEFAULT_KNOWLEDGE_HANDOFF_TTL_MS,
    ...overrides,
  };
}

function expectAdapterValue(selection: KnowledgeContextSelection) {
  const result = adaptKnowledgeContextToChat(selection);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('knowledge workspace handoff storage', () => {
  it('stores a normalized v1 payload with the default ten-minute TTL', () => {
    const storage = new MemoryStorage();

    const result = storeKnowledgeWorkspaceHandoff(
      input({
        userId: '  editor@example.com  ',
        draftPrompt: '  Compare these sources.  ',
        context: {
          mode: 'selected',
          refs: [
            { kind: 'knowledge-base', id: 7, label: '  Product docs  ' },
            { kind: 'atlas-kp', id: 9, label: '  Launch claim  ' },
          ],
        },
      }),
      { storage, now: () => NOW },
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'stored',
      key: 'aetherblog.admin.knowledge-workspace.handoff.v1:editor%40example.com',
      handoff: {
        schemaVersion: 1,
        userId: 'editor@example.com',
        draftPrompt: 'Compare these sources.',
        createdAt: NOW,
        expiresAt: NOW + 10 * 60 * 1000,
        context: {
          mode: 'selected',
          refs: [
            { kind: 'knowledge-base', id: 7, label: 'Product docs' },
            { kind: 'atlas-kp', id: 9, label: 'Launch claim' },
          ],
        },
      },
    });

    const stored = storage.values.get(
      'aetherblog.admin.knowledge-workspace.handoff.v1:editor%40example.com',
    );
    expect(stored && JSON.parse(stored)).toEqual(result.ok ? result.handoff : undefined);
  });

  it('isolates keys by the trimmed, encoded user id', () => {
    expect(knowledgeWorkspaceHandoffStorageKey(' user/一号 ')).toBe(
      'aetherblog.admin.knowledge-workspace.handoff.v1:user%2F%E4%B8%80%E5%8F%B7',
    );

    const storage = new MemoryStorage();
    storeKnowledgeWorkspaceHandoff(input({ userId: 'alice' }), { storage, now: () => NOW });
    storeKnowledgeWorkspaceHandoff(input({ userId: 'bob' }), { storage, now: () => NOW });

    expect([...storage.values.keys()]).toEqual([
      'aetherblog.admin.knowledge-workspace.handoff.v1:alice',
      'aetherblog.admin.knowledge-workspace.handoff.v1:bob',
    ]);
  });

  it('rejects a blank user id before touching or overwriting storage', () => {
    const storage = new MemoryStorage();
    storage.values.set('aetherblog.admin.knowledge-workspace.handoff.v1:user-1', 'keep-me');

    const result = storeKnowledgeWorkspaceHandoff(input({ userId: '   ' }), {
      storage,
      now: () => NOW,
    });

    expect(result).toMatchObject({ ok: false, status: 'invalid', error: { code: 'invalid-user' } });
    expect(storage.operations).toEqual([]);
    expect(storage.values.get('aetherblog.admin.knowledge-workspace.handoff.v1:user-1')).toBe('keep-me');
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects unsafe source id %s', (id) => {
    const storage = new MemoryStorage();
    const result = storeKnowledgeWorkspaceHandoff(
      input({
        context: {
          mode: 'selected',
          refs: [{ kind: 'knowledge-base', id, label: 'Docs' }],
        },
      }),
      { storage, now: () => NOW },
    );

    expect(result).toMatchObject({ ok: false, status: 'invalid', error: { code: 'invalid-ref' } });
    expect(storage.operations).toEqual([]);
  });

  it.each([
    [{ mode: 'selected', refs: [] }, 'invalid-selection'],
    [{ mode: 'selected', refs: [{ kind: 'unknown', id: 1, label: 'Docs' }] }, 'invalid-ref'],
    [{ mode: 'selected', refs: [{ kind: 'knowledge-base', id: 1, label: '   ' }] }, 'invalid-ref'],
    [{ mode: 'selected', refs: [{ kind: 'knowledge-base', id: 1, label: 'x'.repeat(161) }] }, 'invalid-ref'],
    [{ mode: 'auto', refs: [{ kind: 'knowledge-base', id: 1, label: 'Docs' }] }, 'invalid-selection'],
    [{ mode: 'none', refs: [] }, 'invalid-selection'],
  ] as const)('rejects invalid context %j', (context, code) => {
    const result = storeKnowledgeWorkspaceHandoff(input({ context: context as KnowledgeContextSelection }), {
      storage: new MemoryStorage(),
      now: () => NOW,
    });
    expect(result).toMatchObject({ ok: false, status: 'invalid', error: { code } });
  });

  it.each([
    ['invalid origin', { origin: 'somewhere' }],
    ['invalid intent', { intent: 'publish' }],
    ['non-string prompt', { draftPrompt: 42 }],
    ['overlong prompt', { draftPrompt: 'x'.repeat(4001) }],
  ] as const)('rejects %s', (_label, overrides) => {
    const storage = new MemoryStorage();
    const result = storeKnowledgeWorkspaceHandoff(
      input(overrides as Partial<KnowledgeWorkspaceHandoffInput>),
      { storage, now: () => NOW },
    );

    expect(result).toMatchObject({ ok: false, status: 'invalid' });
    expect(storage.operations).toEqual([]);
  });

  it.each([0, -1, MAX_KNOWLEDGE_HANDOFF_TTL_MS + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid TTL %s',
    (ttlMs) => {
      const storage = new MemoryStorage();
      const result = storeKnowledgeWorkspaceHandoff(input(), { storage, now: () => NOW, ttlMs });

      expect(result).toMatchObject({ ok: false, status: 'invalid', error: { code: 'invalid-ttl' } });
      expect(storage.operations).toEqual([]);
    },
  );

  it('accepts the thirty-minute maximum TTL', () => {
    const result = storeKnowledgeWorkspaceHandoff(input(), {
      storage: new MemoryStorage(),
      now: () => NOW,
      ttlMs: MAX_KNOWLEDGE_HANDOFF_TTL_MS,
    });

    expect(result).toMatchObject({
      ok: true,
      handoff: { expiresAt: NOW + 30 * 60 * 1000 },
    });
  });

  it('returns typed storage errors without throwing', () => {
    const unavailable = storeKnowledgeWorkspaceHandoff(input(), {
      storage: null,
      now: () => NOW,
    });
    expect(unavailable).toMatchObject({
      ok: false,
      status: 'storage-error',
      error: { code: 'storage-unavailable' },
    });

    const storage = new MemoryStorage();
    storage.throwOnSet = true;
    const failed = storeKnowledgeWorkspaceHandoff(input(), { storage, now: () => NOW });
    expect(failed).toMatchObject({
      ok: false,
      status: 'storage-error',
      error: { code: 'storage-write-failed' },
    });
  });

  it('consumes a valid handoff exactly once', () => {
    const storage = new MemoryStorage();
    storeKnowledgeWorkspaceHandoff(input(), { storage, now: () => NOW });

    const first = consumeKnowledgeWorkspaceHandoff(' user-1 ', {
      storage,
      now: () => NOW + 1,
    });
    const second = consumeKnowledgeWorkspaceHandoff('user-1', {
      storage,
      now: () => NOW + 2,
    });

    expect(first).toMatchObject({ ok: true, status: 'consumed', handoff: { userId: 'user-1' } });
    expect(second).toEqual({ ok: true, status: 'empty' });
  });

  it('always reads, removes, then validates a present payload', () => {
    const storage = new MemoryStorage();
    const key = knowledgeWorkspaceHandoffStorageKey('user-1');
    storage.values.set(key, '{malformed');

    const result = consumeKnowledgeWorkspaceHandoff('user-1', { storage, now: () => NOW });

    expect(result).toMatchObject({ ok: false, status: 'invalid', error: { code: 'malformed-payload' } });
    expect(storage.operations).toEqual([`get:${key}`, `remove:${key}`]);
    expect(storage.values.has(key)).toBe(false);
  });

  it('removes malformed, invalid, expired, and mismatched payloads', () => {
    const cases: Array<[string, unknown, string]> = [
      ['malformed', '{nope', 'invalid'],
      ['schema', rawHandoff({ schemaVersion: 2 }), 'invalid'],
      ['origin', rawHandoff({ origin: 'unknown' }), 'invalid'],
      ['intent', rawHandoff({ intent: 'publish' }), 'invalid'],
      ['context', rawHandoff({ context: { mode: 'selected', refs: [] } }), 'invalid'],
      ['user mismatch', rawHandoff({ userId: 'other-user' }), 'invalid'],
      ['expired', rawHandoff({ createdAt: NOW - 1, expiresAt: NOW }), 'expired'],
    ];

    for (const [label, raw, status] of cases) {
      const storage = new MemoryStorage();
      const key = knowledgeWorkspaceHandoffStorageKey('user-1');
      storage.values.set(key, typeof raw === 'string' ? raw : JSON.stringify(raw));

      const result = consumeKnowledgeWorkspaceHandoff('user-1', { storage, now: () => NOW });

      expect(result.status, label).toBe(status);
      expect(storage.values.has(key), label).toBe(false);
    }
  });

  it('treats expiresAt === now as expired and now + 1 as consumable', () => {
    const expiredStorage = new MemoryStorage();
    const key = knowledgeWorkspaceHandoffStorageKey('user-1');
    expiredStorage.values.set(key, JSON.stringify(rawHandoff({ createdAt: NOW - 1, expiresAt: NOW })));

    expect(
      consumeKnowledgeWorkspaceHandoff('user-1', { storage: expiredStorage, now: () => NOW }),
    ).toMatchObject({ ok: false, status: 'expired' });

    const liveStorage = new MemoryStorage();
    liveStorage.values.set(
      key,
      JSON.stringify(rawHandoff({ createdAt: NOW - 1, expiresAt: NOW + 1 })),
    );
    expect(
      consumeKnowledgeWorkspaceHandoff('user-1', { storage: liveStorage, now: () => NOW }),
    ).toMatchObject({ ok: true, status: 'consumed' });
  });

  it('fails closed when removal fails and never exposes the payload', () => {
    const storage = new MemoryStorage();
    const key = knowledgeWorkspaceHandoffStorageKey('user-1');
    storage.values.set(key, JSON.stringify(rawHandoff()));
    storage.throwOnRemove = true;

    const result = consumeKnowledgeWorkspaceHandoff('user-1', { storage, now: () => NOW });

    expect(result).toEqual({
      ok: false,
      status: 'storage-error',
      error: {
        code: 'storage-remove-failed',
        message: '无法安全消费知识交接，请重试。',
      },
    });
    expect('handoff' in result).toBe(false);
    expect(storage.operations).toEqual([`get:${key}`, `remove:${key}`]);
  });

  it('returns typed read errors without throwing', () => {
    const unavailable = consumeKnowledgeWorkspaceHandoff('user-1', {
      storage: null,
      now: () => NOW,
    });
    expect(unavailable).toMatchObject({
      ok: false,
      status: 'storage-error',
      error: { code: 'storage-unavailable' },
    });

    const storage = new MemoryStorage();
    storage.throwOnGet = true;
    expect(
      consumeKnowledgeWorkspaceHandoff('user-1', { storage, now: () => NOW }),
    ).toMatchObject({
      ok: false,
      status: 'storage-error',
      error: { code: 'storage-read-failed' },
    });
  });

  it('does not mutate the input object or refs array', () => {
    const refs: KnowledgeContextRef[] = [
      { kind: 'knowledge-base', id: 1, label: '  Docs  ' },
    ];
    const request = input({ context: { mode: 'selected', refs } });
    const snapshot = structuredClone(request);

    const result = storeKnowledgeWorkspaceHandoff(request, {
      storage: new MemoryStorage(),
      now: () => NOW,
    });

    expect(result.ok).toBe(true);
    expect(request).toEqual(snapshot);
    expect(refs[0].label).toBe('  Docs  ');
  });
});

describe('adaptKnowledgeContextToChat', () => {
  it('omits kbIds from the auto payload even after JSON serialization', () => {
    const value = expectAdapterValue({ mode: 'auto' });
    const serialized = JSON.stringify(value);

    expect(Object.prototype.hasOwnProperty.call(value, 'kbIds')).toBe(false);
    expect(serialized).not.toContain('"kbIds"');
    expect(JSON.parse(serialized)).toEqual({
      atlasScope: {
        kpIds: [],
        carrierIds: [],
        neighborhoodDepth: 1,
        includeEvidence: true,
        semanticRecall: true,
        semanticLimit: 8,
      },
    });
  });

  it('uses explicit null for both channels when knowledge is disabled', () => {
    expect(expectAdapterValue({ mode: 'none' })).toEqual({ kbIds: null, atlasScope: null });
  });

  it('adapts KB-only, Atlas-only, and mixed selections with explicit unselected channels', () => {
    expect(
      expectAdapterValue({
        mode: 'selected',
        refs: [
          { kind: 'knowledge-base', id: 3, label: 'Docs' },
          { kind: 'knowledge-base', id: 4, label: 'Specs' },
        ],
      }),
    ).toEqual({ kbIds: [3, 4], atlasScope: null });

    expect(
      expectAdapterValue({
        mode: 'selected',
        refs: [
          { kind: 'atlas-kp', id: 8, label: 'Claim' },
          { kind: 'atlas-carrier', id: 13, label: 'Note' },
        ],
      }),
    ).toEqual({
      kbIds: null,
      atlasScope: {
        kpIds: [8],
        carrierIds: [13],
        neighborhoodDepth: 1,
        includeEvidence: true,
        semanticRecall: true,
        semanticLimit: 8,
      },
    });

    expect(
      expectAdapterValue({
        mode: 'selected',
        refs: [
          { kind: 'knowledge-base', id: 3, label: 'Docs' },
          { kind: 'atlas-kp', id: 8, label: 'Claim' },
          { kind: 'atlas-carrier', id: 13, label: 'Note' },
        ],
      }),
    ).toEqual({
      kbIds: [3],
      atlasScope: {
        kpIds: [8],
        carrierIds: [13],
        neighborhoodDepth: 1,
        includeEvidence: true,
        semanticRecall: true,
        semanticLimit: 8,
      },
    });
  });

  it('deduplicates first-seen ids per kind without conflating equal ids across kinds', () => {
    expect(
      expectAdapterValue({
        mode: 'selected',
        refs: [
          { kind: 'knowledge-base', id: 5, label: 'KB first' },
          { kind: 'knowledge-base', id: 5, label: 'KB duplicate' },
          { kind: 'atlas-kp', id: 5, label: 'KP same numeric id' },
          { kind: 'atlas-kp', id: 6, label: 'KP six' },
          { kind: 'atlas-kp', id: 5, label: 'KP duplicate' },
          { kind: 'atlas-carrier', id: 5, label: 'Carrier same numeric id' },
        ],
      }),
    ).toEqual({
      kbIds: [5],
      atlasScope: {
        kpIds: [5, 6],
        carrierIds: [5],
        neighborhoodDepth: 1,
        includeEvidence: true,
        semanticRecall: true,
        semanticLimit: 8,
      },
    });
  });

  it.each([
    [
      'kb-limit-exceeded',
      Array.from({ length: 11 }, (_, index) => ({
        kind: 'knowledge-base' as const,
        id: index + 1,
        label: `KB ${index + 1}`,
      })),
    ],
    [
      'kp-limit-exceeded',
      Array.from({ length: 13 }, (_, index) => ({
        kind: 'atlas-kp' as const,
        id: index + 1,
        label: `KP ${index + 1}`,
      })),
    ],
    [
      'carrier-limit-exceeded',
      Array.from({ length: 7 }, (_, index) => ({
        kind: 'atlas-carrier' as const,
        id: index + 1,
        label: `Carrier ${index + 1}`,
      })),
    ],
  ])('rejects %s instead of silently truncating', (code, refs) => {
    const result = adaptKnowledgeContextToChat({ mode: 'selected', refs });

    expect(result).toMatchObject({ ok: false, error: { code } });
  });

  it('deduplicates before enforcing source limits', () => {
    const refs = Array.from({ length: 20 }, () => ({
      kind: 'knowledge-base' as const,
      id: 1,
      label: 'Same KB',
    }));

    expect(expectAdapterValue({ mode: 'selected', refs })).toEqual({
      kbIds: [1],
      atlasScope: null,
    });
  });

  it.each([
    [{ mode: 'selected', refs: [] }, 'invalid-selection'],
    [{ mode: 'auto', refs: [] }, 'invalid-selection'],
    [{ mode: 'none', refs: [{ kind: 'atlas-kp', id: 1, label: 'KP' }] }, 'invalid-selection'],
    [{ mode: 'selected', refs: [{ kind: 'unknown', id: 1, label: 'KP' }] }, 'invalid-ref'],
    // Notes must first be converted through ensureMarkdownCarrier; there is no
    // noteIds field in the current chat protocol.
    [{ mode: 'selected', refs: [{ kind: 'note', id: 1, label: 'Note' }] }, 'invalid-ref'],
    [{ mode: 'selected', refs: [{ kind: 'atlas-kp', id: 0, label: 'KP' }] }, 'invalid-ref'],
  ] as const)('rejects invalid selection %j', (selection, code) => {
    const result = adaptKnowledgeContextToChat(selection as KnowledgeContextSelection);
    expect(result).toMatchObject({ ok: false, error: { code } });
  });

  it('does not mutate selected refs and never emits labels or metadata', () => {
    const selection: KnowledgeContextSelection = {
      mode: 'selected',
      refs: [{ kind: 'atlas-kp', id: 2, label: '  Sensitive working label  ' }],
    };
    const snapshot = structuredClone(selection);

    const value = expectAdapterValue(selection);

    expect(selection).toEqual(snapshot);
    expect(JSON.stringify(value)).not.toContain('Sensitive');
    expect(JSON.stringify(value)).not.toContain('label');
  });
});
