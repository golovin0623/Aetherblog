export type KnowledgeBaseReadiness = 'empty' | 'processing' | 'attention' | 'ready';
export type KnowledgeBaseKind = 'CUSTOM' | 'SYSTEM_POSTS';

export interface KnowledgeBaseReadinessInput {
  kind: KnowledgeBaseKind;
  fileCount: number;
  vectorizedCount: number;
  failedCount: number;
  chunkCount: number;
  hasActiveProfile: boolean;
}

export interface KnowledgeBaseNextAction {
  label: string;
  description: string;
}

type KnowledgeBaseReadinessReason =
  | 'empty'
  | 'processing'
  | 'invalid-state'
  | 'failed-files'
  | 'missing-active-profile'
  | 'no-searchable-content'
  | 'ready';

interface KnowledgeBaseReadinessEvaluation {
  readiness: KnowledgeBaseReadiness;
  reason: KnowledgeBaseReadinessReason;
}

const NEXT_ACTIONS: Record<KnowledgeBaseReadinessReason, KnowledgeBaseNextAction> = {
  empty: {
    label: '添加资料',
    description: '先放入一份可信资料，系统会自动准备内容。',
  },
  processing: {
    label: '查看进度',
    description: '资料正在准备，完成后再用问题验证。',
  },
  'invalid-state': {
    label: '刷新状态',
    description: '资料状态暂时不一致，请刷新后再检查；如果仍未恢复，请重新准备资料。',
  },
  'failed-files': {
    label: '处理问题',
    description: '有资料未能完成准备，请查看原因并重试。',
  },
  'missing-active-profile': {
    label: '配置索引',
    description: '还没有可用的索引配置。请先启用一个索引档案，再重新准备资料。',
  },
  'no-searchable-content': {
    label: '检查资料',
    description:
      '资料已处理但没有可检索内容。请检查文件是否为空或格式不受支持，然后重新上传或重建索引。',
  },
  ready: {
    label: '用问题验证',
    description: '问一个真实问题，检查回答和引用是否可靠。',
  },
};

function evaluateKnowledgeBaseReadiness({
  kind,
  fileCount,
  vectorizedCount,
  failedCount,
  chunkCount,
  hasActiveProfile,
}: KnowledgeBaseReadinessInput): KnowledgeBaseReadinessEvaluation {
  const hasInvalidCounters =
    (kind !== 'CUSTOM' && kind !== 'SYSTEM_POSTS') ||
    !Number.isInteger(fileCount) ||
    !Number.isInteger(vectorizedCount) ||
    !Number.isInteger(failedCount) ||
    !Number.isInteger(chunkCount) ||
    typeof hasActiveProfile !== 'boolean' ||
    fileCount < 0 ||
    vectorizedCount < 0 ||
    failedCount < 0 ||
    chunkCount < 0 ||
    vectorizedCount > fileCount ||
    failedCount > fileCount ||
    vectorizedCount + failedCount > fileCount;

  if (hasInvalidCounters) return { readiness: 'attention', reason: 'invalid-state' };
  if (fileCount === 0) return { readiness: 'empty', reason: 'empty' };
  if (failedCount > 0) return { readiness: 'attention', reason: 'failed-files' };
  if (vectorizedCount < fileCount) return { readiness: 'processing', reason: 'processing' };

  // Agent 对 SYSTEM_POSTS 使用独立的文章召回路径，不要求自定义 KB 的
  // active profile / chunkCount 门槛。这里只让 CUSTOM 对齐 server-go
  // agentKBUsable 的这两项条件，避免新门槛误伤系统文章库。
  if (kind === 'CUSTOM' && !hasActiveProfile) {
    return { readiness: 'attention', reason: 'missing-active-profile' };
  }
  if (kind === 'CUSTOM' && chunkCount === 0) {
    return { readiness: 'attention', reason: 'no-searchable-content' };
  }
  return { readiness: 'ready', reason: 'ready' };
}

export function getKnowledgeBaseReadiness(
  input: KnowledgeBaseReadinessInput,
): KnowledgeBaseReadiness {
  return evaluateKnowledgeBaseReadiness(input).readiness;
}

export function getKnowledgeBaseNextAction(
  input: KnowledgeBaseReadinessInput,
): KnowledgeBaseNextAction {
  return NEXT_ACTIONS[evaluateKnowledgeBaseReadiness(input).reason];
}
