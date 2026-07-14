export type NoteSourceType = 'manual' | 'web' | 'article' | 'chat' | 'import' | 'api';
export type NoteEmbeddingStatus = 'PENDING' | 'INDEXED' | 'FAILED' | 'SKIPPED';
export type NoteKnowledgeStatus = 'ready' | 'not_ready' | 'needs_update' | 'processing' | 'failed' | 'unavailable';

export interface NoteListItem {
  id: number;
  title: string;
  summary?: string | null;
  folderId?: number | null;
  folderName?: string | null;
  tagNames: string[];
  sourceType: NoteSourceType;
  isPinned: boolean;
  isFavorite: boolean;
  archived: boolean;
  wordCount: number;
  embeddingStatus: NoteEmbeddingStatus;
  lastOpenedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteLinkItem {
  id: number;
  sourceNoteId: number;
  sourceTitle: string;
  targetNoteId?: number | null;
  targetTitle: string;
  linkText: string;
  positionStart?: number | null;
  positionEnd?: number | null;
}

export interface NoteDetail extends NoteListItem {
  contentMarkdown: string;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sourceMeta: Record<string, unknown>;
  outLinks: NoteLinkItem[];
  backLinks: NoteLinkItem[];
  draft?: CreateNoteRequest;
}

export interface NoteKnowledgeReadiness {
  noteId: number;
  status: NoteKnowledgeStatus;
  queryable: boolean;
  profileId?: number | null;
  profileName?: string | null;
  modelId?: string | null;
  chunkCount: number;
  carrierId?: number | null;
  sourceFingerprint: string;
  indexedFingerprint?: string | null;
  indexedAt?: string | null;
  message: string;
}

export interface CreateNoteRequest {
  title?: string;
  contentMarkdown?: string;
  summary?: string | null;
  folderId?: number | null;
  tagNames?: string[];
  sourceType?: NoteSourceType;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sourceMeta?: Record<string, unknown>;
  isPinned?: boolean;
  isFavorite?: boolean;
}

export interface UpdateNotePropertiesRequest {
  title?: string;
  summary?: string | null;
  folderId?: number | null;
  tagNames?: string[];
  sourceType?: NoteSourceType;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sourceMeta?: Record<string, unknown>;
  isPinned?: boolean;
  isFavorite?: boolean;
  archived?: boolean;
}

export interface NoteFolderItem {
  id: number;
  name: string;
  parentId?: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteFolderRequest {
  name: string;
  parentId?: number | null;
  sortOrder?: number;
}

export interface NoteTagItem {
  id: number;
  name: string;
  color: string;
}
