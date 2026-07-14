import type {
  AgentRetrievalHitKind,
  AgentRetrievalReceipt,
} from '@/services/agent/chat';

export type RetrievalReceiptTone = 'success' | 'warning' | 'danger';

export interface RetrievalReceiptPresentation {
  tone: RetrievalReceiptTone;
  title: string;
  detail: string;
}

export function getRetrievalReceiptPresentation(
  receipt: AgentRetrievalReceipt,
): RetrievalReceiptPresentation {
  const hitCount = receipt.hits.length;
  switch (receipt.status) {
    case 'matched':
      return {
        tone: 'success',
        title: `已核对 ${hitCount} 条知识依据`,
        detail: '回答前已从本次来源中找到相关内容。',
      };
    case 'empty':
      return {
        tone: 'warning',
        title: '没有命中相关知识',
        detail: '这次回答没有从所选资料中找到可用依据，请先检查问题或资料状态。',
      };
    case 'partial':
      return {
        tone: 'warning',
        title: `找到 ${hitCount} 条依据，部分来源未完成`,
        detail: '回答只使用了成功读取的来源；展开可查看未完成项。',
      };
    case 'unavailable':
      return {
        tone: 'danger',
        title: '知识来源暂时不可用',
        detail: '系统没有把来源读取失败伪装成有依据的回答。',
      };
  }
}

const HIT_KIND_LABELS: Record<AgentRetrievalHitKind, string> = {
  knowledge_base_chunk: '知识库',
  atlas_note: '笔记',
  atlas_knowledge_point: '知识点',
  atlas_evidence: '原文证据',
};

export function retrievalHitKindLabel(kind: AgentRetrievalHitKind): string {
  return HIT_KIND_LABELS[kind];
}

export function safeRetrievalHref(href: string | undefined): string | null {
  if (!href || href.startsWith('//')) return null;
  if (href.startsWith('/admin/') || href.startsWith('/posts/')) return href;
  return null;
}
