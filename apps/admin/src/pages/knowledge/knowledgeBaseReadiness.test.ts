import { describe, expect, it } from 'vitest';

import {
  canUseKnowledgeBase,
  getKnowledgeBaseNextAction,
  getKnowledgeBaseReadiness,
  type KnowledgeBaseReadinessInput,
} from './knowledgeBaseReadiness';

describe('knowledge base use permission', () => {
  it('matches the server retrieval gate instead of treating VIEW as usable', () => {
    expect(canUseKnowledgeBase('')).toBe(false);
    expect(canUseKnowledgeBase('VIEW')).toBe(false);
    expect(canUseKnowledgeBase('USE')).toBe(true);
    expect(canUseKnowledgeBase('EDIT')).toBe(true);
    expect(canUseKnowledgeBase('MANAGE')).toBe(true);
  });
});

const readyCustomKnowledgeBase: KnowledgeBaseReadinessInput = {
  kind: 'CUSTOM',
  fileCount: 4,
  vectorizedCount: 4,
  failedCount: 0,
  chunkCount: 12,
  hasActiveProfile: true,
};

describe('knowledge base readiness', () => {
  it('keeps empty, processing, attention and ready states distinct', () => {
    expect(
      getKnowledgeBaseReadiness({
        ...readyCustomKnowledgeBase,
        fileCount: 0,
        vectorizedCount: 0,
        chunkCount: 0,
        hasActiveProfile: false,
      }),
    ).toBe('empty');
    expect(
      getKnowledgeBaseReadiness({
        ...readyCustomKnowledgeBase,
        vectorizedCount: 2,
      }),
    ).toBe('processing');
    expect(
      getKnowledgeBaseReadiness({
        ...readyCustomKnowledgeBase,
        vectorizedCount: 3,
        failedCount: 1,
      }),
    ).toBe('attention');
    expect(getKnowledgeBaseReadiness(readyCustomKnowledgeBase)).toBe('ready');
  });

  it('flags impossible or negative counters instead of reporting a healthy state', () => {
    expect(
      getKnowledgeBaseReadiness({
        ...readyCustomKnowledgeBase,
        fileCount: 2,
        vectorizedCount: 3,
      }),
    ).toBe('attention');
    expect(
      getKnowledgeBaseReadiness({ ...readyCustomKnowledgeBase, vectorizedCount: -1 }),
    ).toBe('attention');
    expect(
      getKnowledgeBaseReadiness({
        ...readyCustomKnowledgeBase,
        fileCount: 2,
        vectorizedCount: 2,
        failedCount: 1,
      }),
    ).toBe('attention');
    expect(
      getKnowledgeBaseReadiness({ ...readyCustomKnowledgeBase, chunkCount: -1 }),
    ).toBe('attention');
  });
});

describe('knowledge base next action', () => {
  it('always tells a user what to do next in product language', () => {
    expect(
      getKnowledgeBaseNextAction({
        ...readyCustomKnowledgeBase,
        fileCount: 0,
        vectorizedCount: 0,
        chunkCount: 0,
        hasActiveProfile: false,
      }),
    ).toMatchObject({
      label: '添加资料',
      description: '先放入一份可信资料，系统会自动准备内容。',
    });
    expect(
      getKnowledgeBaseNextAction({ ...readyCustomKnowledgeBase, vectorizedCount: 2 }),
    ).toMatchObject({
      label: '查看进度',
      description: '资料正在准备，完成后再用问题验证。',
    });
    expect(
      getKnowledgeBaseNextAction({
        ...readyCustomKnowledgeBase,
        vectorizedCount: 3,
        failedCount: 1,
      }),
    ).toMatchObject({
      label: '处理问题',
      description: '有资料未能完成准备，请查看原因并重试。',
    });
    expect(getKnowledgeBaseNextAction(readyCustomKnowledgeBase)).toMatchObject({
      label: '用问题验证',
      description: '问一个真实问题，检查回答和引用是否可靠。',
    });
  });
});

describe('custom knowledge base semantic usability', () => {
  const processedCustomKnowledgeBase: KnowledgeBaseReadinessInput = {
    ...readyCustomKnowledgeBase,
    fileCount: 2,
    vectorizedCount: 2,
    chunkCount: 8,
  };

  it('does not report ready when processed files produced no searchable chunks', () => {
    const input = { ...processedCustomKnowledgeBase, chunkCount: 0 };

    expect(getKnowledgeBaseReadiness(input)).toBe('attention');
    expect(getKnowledgeBaseNextAction(input)).toEqual({
      label: '检查资料',
      description:
        '资料已处理但没有可检索内容。请检查文件是否为空或格式不受支持，然后重新上传或重建索引。',
    });
  });

  it('keeps a custom knowledge base without an active profile out of ready', () => {
    expect(
      getKnowledgeBaseReadiness({ ...processedCustomKnowledgeBase, hasActiveProfile: false }),
    ).toBe('attention');
    expect(
      getKnowledgeBaseNextAction({ ...processedCustomKnowledgeBase, hasActiveProfile: false }),
    ).toMatchObject({
      label: '配置索引',
      description: '还没有可用的索引配置。请先启用一个索引档案，再重新准备资料。',
    });
  });

  it('keeps system article libraries exempt from custom profile and chunk gates', () => {
    const systemPosts = {
      ...processedCustomKnowledgeBase,
      kind: 'SYSTEM_POSTS' as const,
      chunkCount: 0,
      hasActiveProfile: false,
    };

    expect(getKnowledgeBaseReadiness(systemPosts)).toBe('ready');
    expect(getKnowledgeBaseNextAction(systemPosts).label).toBe('用问题验证');
  });
});
