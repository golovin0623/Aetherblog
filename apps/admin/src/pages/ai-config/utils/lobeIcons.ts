import { getLobeIconCDN } from '@lobehub/icons/es/features/getLobeIconCDN';
import toc from '@lobehub/icons/es/toc';

export type BrandIconGroup = 'provider' | 'model';
export type BrandIconCdn = 'github' | 'unpkg' | 'aliyun';

type TocItem = {
  id: string;
  title?: string;
  fullTitle?: string;
  group?: string;
  param?: {
    hasColor?: boolean;
  };
};

export type BrandIconItem = {
  id: string;
  title: string;
  fullTitle?: string;
  group: BrandIconGroup;
  hasColor: boolean;
};

const BRAND_ICON_ITEMS_UNSORTED = (toc as unknown as TocItem[])
  .filter((item): item is TocItem & { group: BrandIconGroup } => item.group === 'provider' || item.group === 'model')
  .map((item) => ({
    id: item.id,
    title: item.title || item.id,
    fullTitle: item.fullTitle,
    group: item.group as BrandIconGroup,
    hasColor: Boolean(item.param?.hasColor),
  }));

export const BRAND_ICON_ITEMS: BrandIconItem[] = [...BRAND_ICON_ITEMS_UNSORTED].sort((a, b) =>
  a.title.localeCompare(b.title)
);

const BRAND_ICON_ID_BY_LOWER = new Map<string, string>(
  BRAND_ICON_ITEMS_UNSORTED.map((item) => [item.id.toLowerCase(), item.id])
);

export function resolveBrandIconId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return BRAND_ICON_ID_BY_LOWER.get(trimmed.toLowerCase()) || null;
}

export function getBrandIconSvgMaskUrl(id: string, cdn: BrandIconCdn = 'aliyun'): string {
  return getLobeIconCDN(id, { format: 'svg', type: 'mono', cdn });
}

export function getBrandIconPreviewUrl(
  item: Pick<BrandIconItem, 'id' | 'hasColor'>,
  cdn: BrandIconCdn = 'aliyun'
): string {
  const type = item.hasColor ? 'color' : 'mono';
  return getLobeIconCDN(item.id, { format: 'svg', type, cdn });
}

