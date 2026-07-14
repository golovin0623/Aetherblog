import {
  MAX_KNOWLEDGE_HANDOFF_LABEL_LENGTH,
  type KnowledgeWorkspaceHandoffInput,
} from '@/services/knowledgeWorkspaceHandoff';
import type { NoteKnowledgeReadiness } from '@/types/note';
import { isNoteKnowledgeQueryable } from './noteKnowledgeReadiness';

export type BuildNoteQuestionHandoffResult =
  | { ok: true; input: KnowledgeWorkspaceHandoffInput }
  | { ok: false; message: string };

interface BuildNoteQuestionHandoffInput {
  userId: string | null | undefined;
  noteTitle: string;
  readiness: NoteKnowledgeReadiness | null;
  hasUnsavedChanges?: boolean;
}

function normalizeNoteLabel(noteTitle: string, noteId: number): string {
  const fallback = `笔记 #${noteId}`;
  const value = noteTitle.trim() || fallback;
  return value.slice(0, MAX_KNOWLEDGE_HANDOFF_LABEL_LENGTH).trim() || fallback;
}

export function buildNoteQuestionHandoff({
  userId,
  noteTitle,
  readiness,
  hasUnsavedChanges = false,
}: BuildNoteQuestionHandoffInput): BuildNoteQuestionHandoffResult {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) {
    return { ok: false, message: '无法确认当前用户，请重新登录后再试。' };
  }
  if (hasUnsavedChanges) {
    return {
      ok: false,
      message: '先保存最新内容并更新知识来源，再用这条笔记提问。',
    };
  }
  if (!readiness || !isNoteKnowledgeQueryable(readiness) || !readiness.carrierId) {
    return {
      ok: false,
      message: '这条笔记尚未准备为可提问来源，请先更新知识来源。',
    };
  }

  const label = normalizeNoteLabel(noteTitle, readiness.noteId);
  return {
    ok: true,
    input: {
      userId: normalizedUserId,
      origin: 'note',
      intent: 'ask',
      context: {
        mode: 'selected',
        refs: [{ kind: 'atlas-carrier', id: readiness.carrierId, label }],
      },
      draftPrompt: `请基于「${label}」回答：这条笔记的核心观点是什么，还有哪些问题值得继续追问？`,
    },
  };
}
