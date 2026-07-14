import { describe, expect, it } from 'vitest';

import type { AgentRetrievalReceipt } from '@/services/agent/chat';
import {
  getRetrievalReceiptPresentation,
  retrievalHitKindLabel,
  safeRetrievalHref,
} from './retrievalReceiptModel';

function receipt(overrides: Partial<AgentRetrievalReceipt> = {}): AgentRetrievalReceipt {
  return {
    version: 1,
    status: 'matched',
    requested: {
      knowledgeBaseIds: [1],
      atlasKnowledgePointIds: [],
      atlasCarrierIds: [],
    },
    hits: [],
    warnings: [],
    ...overrides,
  };
}

describe('retrieval receipt presentation', () => {
  it('distinguishes a matched answer from an answer with no private evidence', () => {
    expect(
      getRetrievalReceiptPresentation(
        receipt({
          hits: [
            {
              key: 'kb:1',
              kind: 'knowledge_base_chunk',
              title: '产品说明',
              rank: 1,
            },
          ],
        }),
      ),
    ).toEqual({
      tone: 'success',
      title: '已核对 1 条知识依据',
      detail: '回答前已从本次来源中找到相关内容。',
    });

    expect(getRetrievalReceiptPresentation(receipt({ status: 'empty' }))).toEqual({
      tone: 'warning',
      title: '没有命中相关知识',
      detail: '这次回答没有从所选资料中找到可用依据，请先检查问题或资料状态。',
    });
  });

  it('makes partial and unavailable retrieval explicit', () => {
    expect(
      getRetrievalReceiptPresentation(
        receipt({
          status: 'partial',
          hits: [{ key: 'note:3', kind: 'atlas_note', title: '会议纪要', rank: 1 }],
          warnings: [
            { scope: 'knowledge-base', code: 'recall_failed', message: '部分知识库暂时无法检索' },
          ],
        }),
      ),
    ).toEqual({
      tone: 'warning',
      title: '找到 1 条依据，部分来源未完成',
      detail: '回答只使用了成功读取的来源；展开可查看未完成项。',
    });

    expect(getRetrievalReceiptPresentation(receipt({ status: 'unavailable' }))).toEqual({
      tone: 'danger',
      title: '知识来源暂时不可用',
      detail: '系统没有把来源读取失败伪装成有依据的回答。',
    });
  });
});

describe('retrieval receipt source safety', () => {
  it('uses user-facing labels for source kinds', () => {
    expect(retrievalHitKindLabel('knowledge_base_chunk')).toBe('知识库');
    expect(retrievalHitKindLabel('atlas_note')).toBe('笔记');
    expect(retrievalHitKindLabel('atlas_knowledge_point')).toBe('知识点');
    expect(retrievalHitKindLabel('atlas_evidence')).toBe('原文证据');
  });

  it('only allows internal product links from the receipt', () => {
    expect(safeRetrievalHref('/admin/notes/3/edit')).toBe('/admin/notes/3/edit');
    expect(safeRetrievalHref('/posts/guide')).toBe('/posts/guide');
    expect(safeRetrievalHref('https://evil.example/steal')).toBeNull();
    expect(safeRetrievalHref('//evil.example/steal')).toBeNull();
    expect(safeRetrievalHref('javascript:alert(1)')).toBeNull();
  });
});
