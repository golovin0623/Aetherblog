import type { AtlasCarrier } from '@aetherblog/types';

const readableCarrierRoutes: Partial<Record<AtlasCarrier['type'], string>> = {
  pdf: 'pdf',
  blog_post: 'blog-post',
  web: 'web',
  video: 'transcript',
  audio: 'transcript',
  image: 'image',
};

export function carrierReaderHref(carrier: Pick<AtlasCarrier, 'id' | 'type' | 'sourceUri'>): string | null {
  if (carrier.type === 'markdown' && carrier.sourceUri.startsWith('notes://')) {
    const noteId = Number(carrier.sourceUri.slice('notes://'.length));
    return Number.isFinite(noteId) && noteId > 0 ? `/atlas/reader/note/${noteId}` : null;
  }
  const route = readableCarrierRoutes[carrier.type];
  return route ? `/atlas/reader/${route}/${carrier.id}` : null;
}
