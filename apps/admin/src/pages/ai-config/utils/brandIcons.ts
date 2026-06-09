// 品牌图标适配器 —— 模型中心供应商 / 模型族图标的唯一接入点
// ref: §5.1 - AI Service 架构 · 模型中心
//
// 设计意图：品牌图标（各 AI 厂商 Logo / 配色）是纯静态资产，体量大且更新频繁，
// 不适合在仓库内逐个内联。本模块把「第三方品牌图标资产包」封装在唯一适配层后面，
// 对外只暴露中性的 resolveBrandIconId / getBrandIconSvgMaskUrl / getBrandIconPreviewUrl，
// 上层组件不感知具体资产来源 —— 后续如需替换资产源，只改本文件即可。

import { getLobeIconCDN as getBrandCdnUrl } from '@lobehub/icons/es/features/getLobeIconCDN';
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
  return getBrandCdnUrl(id, { format: 'svg', type: 'mono', cdn });
}

export function getBrandIconPreviewUrl(
  item: Pick<BrandIconItem, 'id' | 'hasColor'>,
  cdn: BrandIconCdn = 'aliyun'
): string {
  const type = item.hasColor ? 'color' : 'mono';
  return getBrandCdnUrl(item.id, { format: 'svg', type, cdn });
}
