import { describe, expect, it } from 'vitest';

import { getNoteKnowledgePresentation } from './noteKnowledgeReadiness';

describe('note knowledge readiness presentation', () => {
  it('only presents a source as queryable when active-profile chunks are ready', () => {
    expect(getNoteKnowledgePresentation({
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
      message: 'ready',
    }, false)).toMatchObject({
      tone: 'success',
      title: '可用于提问',
      action: 'ask',
      actionLabel: '用这条笔记提问',
      actionDisabled: false,
      secondaryAction: 'prepare',
      secondaryActionLabel: '更新知识来源',
      detail: '默认语义检索 · 3 个可检索分块',
    });
  });

  it('asks the user to update when note content changed', () => {
    expect(getNoteKnowledgePresentation({
      noteId: 11,
      status: 'needs_update',
      queryable: false,
      profileId: 42,
      profileName: '默认语义检索',
      modelId: 'text-embedding-3-small',
      chunkCount: 2,
      carrierId: 77,
      sourceFingerprint: 'new',
      indexedFingerprint: 'old',
      indexedAt: null,
      message: '笔记内容已变化，需要更新知识来源后才能用于提问。',
    }, false)).toMatchObject({
      tone: 'warning',
      title: '内容有更新',
      action: 'prepare',
      actionLabel: '更新知识来源',
      actionDisabled: false,
      secondaryAction: null,
    });
  });

  it('exposes failure and retry without a fake progress percentage', () => {
    expect(getNoteKnowledgePresentation({
      noteId: 11,
      status: 'failed',
      queryable: false,
      profileId: 42,
      profileName: '默认语义检索',
      modelId: 'text-embedding-3-small',
      chunkCount: 0,
      carrierId: 77,
      sourceFingerprint: 'current',
      indexedFingerprint: null,
      indexedAt: null,
      message: '知识来源准备失败，请重试。',
    }, false)).toMatchObject({
      tone: 'danger',
      title: '准备失败',
      action: 'prepare',
      actionLabel: '重试准备',
      actionDisabled: false,
      secondaryAction: null,
    });
  });

  it('uses an honest pending state while the request is running', () => {
    expect(getNoteKnowledgePresentation(null, true)).toMatchObject({
      tone: 'neutral',
      title: '正在准备知识来源',
      actionLabel: '正在准备',
      actionDisabled: true,
      secondaryAction: null,
    });
  });

  it('does not claim ready when the payload contradicts the readiness contract', () => {
    expect(getNoteKnowledgePresentation({
      noteId: 11,
      status: 'ready',
      queryable: true,
      profileId: null,
      profileName: null,
      modelId: null,
      chunkCount: 0,
      carrierId: null,
      sourceFingerprint: 'current',
      indexedFingerprint: 'current',
      indexedAt: null,
      message: 'bad upstream payload',
    }, false)).toMatchObject({
      tone: 'danger',
      title: '状态不可用',
      actionDisabled: true,
      secondaryAction: null,
    });
  });
});
