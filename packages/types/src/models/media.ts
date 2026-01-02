/**
 * 媒体类型
 */

export type MediaType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'OTHER';

export interface Media {
  id: number;
  name: string;
  originalName: string;
  url: string;
  type: MediaType;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  alt?: string;
  createdAt: string;
}

export interface UploadResult {
  id: number;
  url: string;
  name: string;
}
