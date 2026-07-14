import { describe, expect, it } from 'vitest';

import {
  consumeKnowledgeWorkspaceHandoff,
  storeKnowledgeWorkspaceHandoff,
  type KnowledgeHandoffStorage,
} from '@/services/knowledgeWorkspaceHandoff';
import type { NoteKnowledgeReadiness } from '@/types/note';
import {
  buildNoteQuestionHandoff,
  resolveKnowledgePreparationNote,
} from './noteKnowledgeHandoff';

const NOW = 1_800_000_000_000;

class MemoryStorage implements KnowledgeHandoffStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function ready(overrides: Partial<NoteKnowledgeReadiness> = {}): NoteKnowledgeReadiness {
  return {
    noteId: 11,
    status: 'ready',
    queryable: true,
    profileId: 42,
    profileName: '默认语义检索',
    modelId: 'text-embedding-3-small',
    chunkCount: 3,
    carrierId: 77,
    sourceFingerprint: 'current',
    indexedFingerprint: 'current',
    indexedAt: '2026-07-14T01:00:00Z',
    message: '这条笔记可用于提问。',
    ...overrides,
  };
}

describe('note knowledge preparation identity', () => {
  it('persists a newly created note route before returning its preparation id', async () => {
    const calls: string[] = [];

    const noteId = await resolveKnowledgePreparationNote({
      routeNoteId: null,
      hasUnsavedChanges: false,
      save: async () => {
        calls.push('save');
        return { id: 91 };
      },
      persistCreatedRoute: (id) => calls.push(`route:${id}`),
    });

    expect(noteId).toBe(91);
    expect(calls).toEqual(['save', 'route:91']);
  });

  it('does not change routes when saving a new note fails', async () => {
    const persisted: number[] = [];

    await expect(resolveKnowledgePreparationNote({
      routeNoteId: null,
      hasUnsavedChanges: true,
      save: async () => null,
      persistCreatedRoute: (id) => persisted.push(id),
    })).resolves.toBeNull();
    expect(persisted).toEqual([]);
  });

  it('reuses a clean existing note without saving or replacing its route', async () => {
    const noteId = await resolveKnowledgePreparationNote({
      routeNoteId: 17,
      hasUnsavedChanges: false,
      save: async () => {
        throw new Error('save should not run');
      },
      persistCreatedRoute: () => {
        throw new Error('route should not change');
      },
    });

    expect(noteId).toBe(17);
  });

  it('saves dirty existing notes without treating them as newly created', async () => {
    const persisted: number[] = [];

    const noteId = await resolveKnowledgePreparationNote({
      routeNoteId: 17,
      hasUnsavedChanges: true,
      save: async () => ({ id: 17 }),
      persistCreatedRoute: (id) => persisted.push(id),
    });

    expect(noteId).toBe(17);
    expect(persisted).toEqual([]);
  });
});

describe('note question handoff', () => {
  it('builds a selected Atlas-carrier handoff with an editable suggested question', () => {
    const result = buildNoteQuestionHandoff({
      userId: ' user-1 ',
      noteTitle: ' 产品决策记录 ',
      readiness: ready(),
    });

    expect(result).toEqual({
      ok: true,
      input: {
        userId: 'user-1',
        origin: 'note',
        intent: 'ask',
        context: {
          mode: 'selected',
          refs: [{ kind: 'atlas-carrier', id: 77, label: '产品决策记录' }],
        },
        draftPrompt: '请基于「产品决策记录」回答：这条笔记的核心观点是什么，还有哪些问题值得继续追问？',
      },
    });
  });

  it('stores a user-scoped handoff that the workspace consumes exactly once', () => {
    const built = buildNoteQuestionHandoff({
      userId: 'user-1',
      noteTitle: '产品决策记录',
      readiness: ready(),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.message);

    const storage = new MemoryStorage();
    const stored = storeKnowledgeWorkspaceHandoff(built.input, {
      storage,
      now: () => NOW,
    });
    expect(stored).toMatchObject({ ok: true, status: 'stored' });

    expect(consumeKnowledgeWorkspaceHandoff('other-user', {
      storage,
      now: () => NOW + 1,
    })).toEqual({ ok: true, status: 'empty' });

    expect(consumeKnowledgeWorkspaceHandoff('user-1', {
      storage,
      now: () => NOW + 2,
    })).toMatchObject({
      ok: true,
      status: 'consumed',
      handoff: {
        origin: 'note',
        intent: 'ask',
        context: {
          mode: 'selected',
          refs: [{ kind: 'atlas-carrier', id: 77 }],
        },
      },
    });
    expect(consumeKnowledgeWorkspaceHandoff('user-1', {
      storage,
      now: () => NOW + 3,
    })).toEqual({ ok: true, status: 'empty' });
  });

  it.each([
    ['not ready', ready({ status: 'needs_update', queryable: false })],
    ['missing carrier', ready({ carrierId: null })],
    ['stale fingerprint', ready({ indexedFingerprint: 'older' })],
    ['no active profile chunks', ready({ profileId: null, chunkCount: 0 })],
  ])('fails closed when the source is %s', (_label, readiness) => {
    expect(buildNoteQuestionHandoff({
      userId: 'user-1',
      noteTitle: '产品决策记录',
      readiness,
    })).toMatchObject({ ok: false });
  });

  it('fails before building a handoff when the current user is unknown', () => {
    expect(buildNoteQuestionHandoff({
      userId: null,
      noteTitle: '产品决策记录',
      readiness: ready(),
    })).toEqual({
      ok: false,
      message: '无法确认当前用户，请重新登录后再试。',
    });
  });

  it('does not hand off a stale indexed revision while the editor is dirty', () => {
    expect(buildNoteQuestionHandoff({
      userId: 'user-1',
      noteTitle: '产品决策记录',
      readiness: ready(),
      hasUnsavedChanges: true,
    })).toEqual({
      ok: false,
      message: '先保存最新内容并更新知识来源，再用这条笔记提问。',
    });
  });
});
