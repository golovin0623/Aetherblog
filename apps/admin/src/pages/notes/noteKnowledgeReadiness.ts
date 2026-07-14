import type { NoteKnowledgeReadiness } from '@/types/note';

export type NoteKnowledgeTone = 'success' | 'warning' | 'danger' | 'neutral';
export type NoteKnowledgeAction = 'ask' | 'prepare' | 'refresh' | null;

export interface NoteKnowledgePresentation {
  tone: NoteKnowledgeTone;
  title: string;
  description: string;
  detail: string | null;
  action: NoteKnowledgeAction;
  actionLabel: string;
  actionDisabled: boolean;
  secondaryAction: 'prepare' | null;
  secondaryActionLabel: string;
}

export function isNoteKnowledgeQueryable(readiness: NoteKnowledgeReadiness): boolean {
  return readiness.status === 'ready'
    && readiness.queryable
    && Number.isSafeInteger(readiness.profileId)
    && (readiness.profileId || 0) > 0
    && Number.isSafeInteger(readiness.chunkCount)
    && readiness.chunkCount > 0
    && Number.isSafeInteger(readiness.carrierId)
    && (readiness.carrierId || 0) > 0
    && Boolean(readiness.sourceFingerprint)
    && readiness.sourceFingerprint === readiness.indexedFingerprint;
}

export function getNoteKnowledgePresentation(
  readiness: NoteKnowledgeReadiness | null,
  busy: boolean,
  hasUnsavedChanges = false,
): NoteKnowledgePresentation {
  if (busy) {
    return {
      tone: 'neutral',
      title: '正在准备知识来源',
      description: '正在校验当前内容、活跃检索配置与可检索分块。',
      detail: null,
      action: null,
      actionLabel: '正在准备',
      actionDisabled: true,
      secondaryAction: null,
      secondaryActionLabel: '',
    };
  }

  if (hasUnsavedChanges) {
    return {
      tone: 'warning',
      title: '有未保存的内容',
      description: '先保存最新内容，再更新知识来源，避免提问命中旧版本。',
      detail: readiness?.profileName || null,
      action: 'prepare',
      actionLabel: '保存并更新',
      actionDisabled: false,
      secondaryAction: null,
      secondaryActionLabel: '',
    };
  }

  if (!readiness) {
    return {
      tone: 'neutral',
      title: '正在检查可用性',
      description: '检查活跃检索配置、内容版本和实际分块。',
      detail: null,
      action: 'refresh',
      actionLabel: '刷新状态',
      actionDisabled: false,
      secondaryAction: null,
      secondaryActionLabel: '',
    };
  }

  if (readiness.status === 'ready') {
    if (!isNoteKnowledgeQueryable(readiness)) {
      return {
        tone: 'danger',
        title: '状态不可用',
        description: '服务返回的可用性信息不完整，已阻止把它标记为可提问。',
        detail: null,
        action: null,
        actionLabel: '暂不可用',
        actionDisabled: true,
        secondaryAction: null,
        secondaryActionLabel: '',
      };
    }
    return {
      tone: 'success',
      title: '可用于提问',
      description: readiness.message,
      detail: `${readiness.profileName || '活跃检索配置'} · ${readiness.chunkCount} 个可检索分块`,
      action: 'ask',
      actionLabel: '用这条笔记提问',
      actionDisabled: false,
      secondaryAction: 'prepare',
      secondaryActionLabel: '更新知识来源',
    };
  }

  if (readiness.status === 'needs_update') {
    return {
      tone: 'warning',
      title: '内容有更新',
      description: readiness.message,
      detail: readiness.profileName || null,
      action: 'prepare',
      actionLabel: '更新知识来源',
      actionDisabled: false,
      secondaryAction: null,
      secondaryActionLabel: '',
    };
  }

  if (readiness.status === 'failed') {
    return {
      tone: 'danger',
      title: '准备失败',
      description: readiness.message,
      detail: readiness.profileName || null,
      action: 'prepare',
      actionLabel: '重试准备',
      actionDisabled: false,
      secondaryAction: null,
      secondaryActionLabel: '',
    };
  }

  if (readiness.status === 'processing') {
    return {
      tone: 'neutral',
      title: '正在准备',
      description: readiness.message,
      detail: readiness.profileName || null,
      action: 'refresh',
      actionLabel: '刷新状态',
      actionDisabled: false,
      secondaryAction: null,
      secondaryActionLabel: '',
    };
  }

  if (readiness.status === 'unavailable') {
    return {
      tone: 'danger',
      title: '服务暂不可用',
      description: readiness.message,
      detail: null,
      action: 'refresh',
      actionLabel: '重新检查',
      actionDisabled: false,
      secondaryAction: null,
      secondaryActionLabel: '',
    };
  }

  return {
    tone: 'neutral',
    title: '尚未用于提问',
    description: readiness.message,
    detail: readiness.profileName || null,
    action: 'prepare',
    actionLabel: '用于提问',
    actionDisabled: false,
    secondaryAction: null,
    secondaryActionLabel: '',
  };
}
