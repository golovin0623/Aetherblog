import { apiClient } from './api';
import { R, PageResult } from '@/types';
import type {
  CreateNoteFolderRequest,
  CreateNoteRequest,
  NoteDetail,
  NoteFolderItem,
  NoteListItem,
  NoteTagItem,
  UpdateNotePropertiesRequest,
} from '@/types/note';

export interface NoteListParams {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  view?: 'all' | 'recent' | 'pinned' | 'unorganized' | 'archived';
  folderId?: number;
  tag?: string;
  sourceType?: string;
  archived?: boolean;
}

export const noteService = {
  getList: (params: NoteListParams): Promise<R<PageResult<NoteListItem>>> =>
    apiClient.get<R<PageResult<NoteListItem>>>('/v1/admin/notes', { params }),

  getById: (id: number): Promise<R<NoteDetail>> =>
    apiClient.get<R<NoteDetail>>(`/v1/admin/notes/${id}`),

  create: (data: CreateNoteRequest): Promise<R<NoteDetail>> =>
    apiClient.post<R<NoteDetail>>('/v1/admin/notes', data),

  update: (id: number, data: CreateNoteRequest): Promise<R<NoteDetail>> =>
    apiClient.put<R<NoteDetail>>(`/v1/admin/notes/${id}`, data),

  updateProperties: (id: number, data: UpdateNotePropertiesRequest): Promise<R<NoteDetail>> =>
    apiClient.patch<R<NoteDetail>>(`/v1/admin/notes/${id}/properties`, data),

  autoSave: (id: number, data: Partial<CreateNoteRequest>): Promise<R<void>> =>
    apiClient.post<R<void>>(`/v1/admin/notes/${id}/auto-save`, data),

  delete: (id: number): Promise<R<void>> =>
    apiClient.delete<R<void>>(`/v1/admin/notes/${id}`),

  duplicate: (id: number): Promise<R<NoteDetail>> =>
    apiClient.post<R<NoteDetail>>(`/v1/admin/notes/${id}/duplicate`),

  getFolders: (): Promise<R<NoteFolderItem[]>> =>
    apiClient.get<R<NoteFolderItem[]>>('/v1/admin/note-folders'),

  createFolder: (data: CreateNoteFolderRequest): Promise<R<NoteFolderItem>> =>
    apiClient.post<R<NoteFolderItem>>('/v1/admin/note-folders', data),

  getTags: (): Promise<R<NoteTagItem[]>> =>
    apiClient.get<R<NoteTagItem[]>>('/v1/admin/note-tags'),

  getBackLinks: (id: number): Promise<R<NoteDetail['backLinks']>> =>
    apiClient.get<R<NoteDetail['backLinks']>>(`/v1/admin/notes/${id}/backlinks`),
};

