import type {
  KbRetrieveStatus,
  KnowledgeBaseRetrievalResponse,
} from '@/services/knowledgeBaseService';

export const MAX_KNOWLEDGE_BASE_RETRIEVAL_QUERY_LENGTH = 500;
export const DEFAULT_KNOWLEDGE_BASE_RETRIEVAL_LIMIT = 5;

export type KnowledgeBaseRetrievalQueryValidation =
  | { ok: true; query: string }
  | { ok: false; message: string };

export function validateKnowledgeBaseRetrievalQuery(
  value: string
): KnowledgeBaseRetrievalQueryValidation {
  const query = value.trim();
  if (query.length < 2) {
    return { ok: false, message: '请输入至少 2 个字符的真实问题。' };
  }
  if (query.length > MAX_KNOWLEDGE_BASE_RETRIEVAL_QUERY_LENGTH) {
    return {
      ok: false,
      message: `问题不能超过 ${MAX_KNOWLEDGE_BASE_RETRIEVAL_QUERY_LENGTH} 个字符。`,
    };
  }
  return { ok: true, query };
}

export function formatKnowledgeBaseRetrievalScore(score: number): string {
  if (!Number.isFinite(score)) return '—';
  return `${Math.round(Math.min(1, Math.max(0, score)) * 100)}%`;
}

export function canContinueKnowledgeBaseRetrievalInAetherHub(
  outcome: KnowledgeBaseRetrievalResponse | null | undefined
): boolean {
  return outcome?.status === 'matched' && outcome.hits.length > 0;
}

interface KnowledgeBaseRetrievalGuidance {
  title: string;
  description: string;
  nextSteps: string[];
  action: {
    kind: 'revise-query' | 'retry';
    label: string;
  };
}

const GUIDANCE: Record<Extract<KbRetrieveStatus, 'empty' | 'unavailable'>, KnowledgeBaseRetrievalGuidance> = {
  empty: {
    title: '没有找到相关片段',
    description: '检索已完成，但当前资料没有达到相关度门槛。',
    nextSteps: ['换一种问法，补充对象、时间或关键术语', '到「资料」确认文件已经完成索引'],
    action: { kind: 'revise-query', label: '修改问题' },
  },
  unavailable: {
    title: '检索暂时不可用',
    description: '这不是“没有答案”，而是检索链路本次未能完成。',
    nextSteps: ['稍后重试当前问题', '到「资料」检查索引状态，必要时重新建立索引'],
    action: { kind: 'retry', label: '重新验证' },
  },
};

export function getKnowledgeBaseRetrievalGuidance(
  status: Extract<KbRetrieveStatus, 'empty' | 'unavailable'>
): KnowledgeBaseRetrievalGuidance {
  return GUIDANCE[status];
}
