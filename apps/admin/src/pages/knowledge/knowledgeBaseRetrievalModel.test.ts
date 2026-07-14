import { describe, expect, it } from 'vitest';

import {
  MAX_KNOWLEDGE_BASE_RETRIEVAL_QUERY_LENGTH,
  canContinueKnowledgeBaseRetrievalInAetherHub,
  formatKnowledgeBaseRetrievalScore,
  getKnowledgeBaseRetrievalGuidance,
  validateKnowledgeBaseRetrievalQuery,
} from './knowledgeBaseRetrievalModel';

describe('knowledge base retrieval model', () => {
  it('trims a real question and rejects blank, tiny, or overlong input', () => {
    expect(validateKnowledgeBaseRetrievalQuery('  如何申请退款？  ')).toEqual({
      ok: true,
      query: '如何申请退款？',
    });
    expect(validateKnowledgeBaseRetrievalQuery('   ')).toMatchObject({ ok: false });
    expect(validateKnowledgeBaseRetrievalQuery('？')).toMatchObject({ ok: false });
    expect(
      validateKnowledgeBaseRetrievalQuery(
        '问'.repeat(MAX_KNOWLEDGE_BASE_RETRIEVAL_QUERY_LENGTH + 1)
      )
    ).toMatchObject({ ok: false });
  });

  it('formats bounded relevance without leaking invalid numeric values', () => {
    expect(formatKnowledgeBaseRetrievalScore(0.876)).toBe('88%');
    expect(formatKnowledgeBaseRetrievalScore(3)).toBe('100%');
    expect(formatKnowledgeBaseRetrievalScore(-1)).toBe('0%');
    expect(formatKnowledgeBaseRetrievalScore(Number.NaN)).toBe('—');
  });

  it('gives distinct next steps for empty and unavailable outcomes', () => {
    const empty = getKnowledgeBaseRetrievalGuidance('empty');
    const unavailable = getKnowledgeBaseRetrievalGuidance('unavailable');

    expect(empty.title).toContain('没有找到');
    expect(empty.nextSteps.join(' ')).toContain('换一种问法');
    expect(empty.action).toEqual({ kind: 'revise-query', label: '修改问题' });
    expect(unavailable.title).toContain('暂时不可用');
    expect(unavailable.nextSteps.join(' ')).toContain('稍后重试');
    expect(unavailable.action).toEqual({ kind: 'retry', label: '重新验证' });
    expect(empty).not.toEqual(unavailable);
  });

  it('only offers an AetherHub handoff after retrieval produced grounded hits', () => {
    expect(canContinueKnowledgeBaseRetrievalInAetherHub(null)).toBe(false);
    expect(canContinueKnowledgeBaseRetrievalInAetherHub({
      status: 'empty',
      query: '退款条件是什么？',
      hits: [],
    })).toBe(false);
    expect(canContinueKnowledgeBaseRetrievalInAetherHub({
      status: 'unavailable',
      query: '退款条件是什么？',
      hits: [],
    })).toBe(false);
    expect(canContinueKnowledgeBaseRetrievalInAetherHub({
      status: 'matched',
      query: '退款条件是什么？',
      hits: [],
    })).toBe(false);
    expect(canContinueKnowledgeBaseRetrievalInAetherHub({
      status: 'matched',
      query: '退款条件是什么？',
      hits: [{
        title: '退款规则',
        snippet: '到账前可申请全额退款。',
        score: 0.91,
        fileId: 7,
        chunkIndex: 2,
      }],
    })).toBe(true);
  });
});
