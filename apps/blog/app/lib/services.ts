import { cache } from 'react';
import { API_ENDPOINTS } from './api';
import { logger } from './logger';

export interface SiteSettings {
  siteTitle: string;
  siteSubtitle: string;
  siteDescription: string;
  siteKeywords: string;
  siteUrl: string;
  authorName: string;
  author_name?: string;
  authorAvatar?: string;
  author_avatar?: string;
  authorBio?: string;
  author_bio?: string;
  icp?: string;
  startYear?: string;
  comment_enabled?: boolean;
  comment_audit?: boolean;
  // 站点Logo
  site_logo?: string;
  site_favicon?: string;
  // 欢迎屏幕
  welcome_title?: string;
  welcome_subtitle?: string;
  welcome_description?: string;
  welcome_primary_btn_text?: string;
  welcome_primary_btn_link?: string;
  welcome_secondary_btn_text?: string;
  welcome_secondary_btn_link?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface Post {
  id: number;
  title: string;
  slug: string;
  summary?: string | null;
  contentPreview?: string | null;
  coverImage?: string;
  publishedAt: string;
  viewCount?: number;
  categoryName?: string;
  tagNames?: string[];
  passwordRequired?: boolean;
}

export interface FriendLink {
  id: number;
  name: string;
  url: string;
  logo?: string;
  description?: string;
  themeColor?: string;
}

export interface Comment {
  id: number;
  parentId?: number;
  nickname: string;
  avatar?: string;
  content: string;
  website?: string;
  createdAt: string;
  children?: Comment[];
}

export interface CreateCommentRequest {
  nickname: string;
  email?: string;
  website?: string;
  content: string;
  parentId?: number;
}

export type MusicPlaybackMode = 'SEQUENTIAL' | 'SHUFFLE' | 'LOOP' | 'CAROUSEL';

export interface MusicMedia {
  id: number;
  originalName: string;
  fileUrl: string;
  publicUrl?: string;
  thumbnailUrl?: string;
  fileSize: number;
  mimeType?: string;
  fileType: string;
  deleted: boolean;
}

export interface MusicTrack {
  id: number;
  mediaFileId: number;
  title: string;
  artist: string;
  album: string;
  durationSeconds?: number;
  coverMediaFileId?: number;
  coverUrl?: string;
  lyric?: string;
  status: 'ACTIVE' | 'HIDDEN';
  sortOrder: number;
  isFeatured: boolean;
  playCount: number;
  media: MusicMedia;
}

export interface MusicPlaylist {
  id: number;
  name: string;
  slug: string;
  description?: string;
  coverMediaFileId?: number;
  coverUrl?: string;
  displayOnHome: boolean;
  displayOnProfile: boolean;
  carouselEnabled: boolean;
  randomEnabled: boolean;
  trackCount: number;
}

export interface MusicPlayer {
  enabled: boolean;
  showOnHomePage: boolean;
  showOnProfileCard: boolean;
  playbackMode: MusicPlaybackMode;
  carouselEnabled: boolean;
  carouselIntervalSeconds: number;
  randomEnabled: boolean;
  /** 站点默认音乐皮肤(后台配置,前台访客可本地覆盖) */
  skinMode?: 'preset' | 'custom';
  skinPreset?: string;
  skinColorLight?: string;
  skinColorDark?: string;
  playlist?: MusicPlaylist;
  tracks: MusicTrack[];
}

/**
 * 获取站点全量配置
 * 重新验证：60 秒
 */
const DEFAULT_SITE_SETTINGS: SiteSettings = {
  siteTitle: 'AetherBlog',
  siteSubtitle: 'Sharing Technology & Life',
  siteDescription: 'A next-generation blog system powered by AI.',
  siteKeywords: 'tech, blog, ai',
  siteUrl: 'http://localhost:3000',
  authorName: 'Admin'
};

const DEFAULT_MUSIC_PLAYER: MusicPlayer = {
  enabled: false,
  showOnHomePage: false,
  showOnProfileCard: false,
  playbackMode: 'SEQUENTIAL',
  carouselEnabled: false,
  carouselIntervalSeconds: 8,
  randomEnabled: false,
  skinMode: 'preset',
  skinPreset: 'crimson',
  tracks: [],
};

// 后端 /site/info 以 snake_case 键(site_name / site_description / site_keywords /
// site_url ...)返回站点配置，但 layout / manifest / 各页 generateMetadata 历史上读取的是
// camelCase(siteTitle / siteDescription / siteKeywords / siteUrl)。两套命名不一致导致
// 站点名称、描述、关键词、站点地址对「浏览器标题 / OG / meta / PWA manifest / canonical
// base」全部失效，永远回落到硬编码默认值——且 siteUrl 回落到 localhost，污染线上
// canonical 与社交分享卡。这里补一层别名归一：camelCase 缺失时用对应 snake_case 回填，
// 两套读法同时生效，且不覆盖后端已注入的 authorName 等 camelCase 字段。
function isAbsoluteHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeSiteSettings(raw: Record<string, unknown>): SiteSettings {
  const merged: Record<string, unknown> = { ...raw };
  const alias = (camel: string, snake: string) => {
    const cur = merged[camel];
    const src = merged[snake];
    if ((cur === undefined || cur === null || cur === '') && src != null && src !== '') {
      merged[camel] = src;
    }
  };
  alias('siteTitle', 'site_name');
  alias('siteDescription', 'site_description');
  alias('siteKeywords', 'site_keywords');
  alias('siteSubtitle', 'footer_signature');
  // siteUrl 仅在 site_url 是合法绝对 http(s) URL 时才别名 —— layout.tsx 会 new URL(siteUrl)，
  // 后台保存走按钮而非原生表单校验，漏写协议的 "example.com" 等非法值会让 metadata 生成抛错、
  // 整页崩。非法值不别名，交由下游回落到默认 URL（见 layout / sitemap / robots 的 fallback）。
  if (
    (merged.siteUrl === undefined || merged.siteUrl === null || merged.siteUrl === '') &&
    isAbsoluteHttpUrl(merged.site_url)
  ) {
    merged.siteUrl = (merged.site_url as string).trim();
  }
  return merged as SiteSettings;
}

type LooseApiRecord = Record<string, any>;

function asApiRecord(value: unknown): LooseApiRecord {
  return value && typeof value === 'object' ? value as LooseApiRecord : {};
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function toOptionalPositiveNumber(value: unknown): number | undefined {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : undefined;
}

function toText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  return String(value);
}

function toOptionalText(value: unknown): string | undefined {
  const next = toText(value).trim();
  return next ? next : undefined;
}

function normalizeMusicMedia(input: unknown): MusicMedia {
  const raw = asApiRecord(input);
  return {
    id: toFiniteNumber(raw.id),
    originalName: toText(raw.originalName ?? raw.original_name),
    fileUrl: toText(raw.fileUrl ?? raw.file_url),
    publicUrl: toOptionalText(raw.publicUrl ?? raw.public_url),
    thumbnailUrl: toOptionalText(raw.thumbnailUrl ?? raw.thumbnail_url),
    fileSize: toFiniteNumber(raw.fileSize ?? raw.file_size),
    mimeType: toOptionalText(raw.mimeType ?? raw.mime_type),
    fileType: toText(raw.fileType ?? raw.file_type),
    deleted: Boolean(raw.deleted),
  };
}

function normalizeMusicTrack(input: unknown): MusicTrack {
  const raw = asApiRecord(input);
  return {
    id: toFiniteNumber(raw.id),
    mediaFileId: toFiniteNumber(raw.mediaFileId ?? raw.media_file_id),
    title: toText(raw.title),
    artist: toText(raw.artist),
    album: toText(raw.album),
    durationSeconds: toOptionalPositiveNumber(raw.durationSeconds ?? raw.duration_seconds),
    coverMediaFileId: toOptionalPositiveNumber(raw.coverMediaFileId ?? raw.cover_media_file_id),
    coverUrl: toOptionalText(raw.coverUrl ?? raw.cover_url),
    lyric: toOptionalText(raw.lyric),
    status: raw.status === 'HIDDEN' ? 'HIDDEN' : 'ACTIVE',
    sortOrder: toFiniteNumber(raw.sortOrder ?? raw.sort_order),
    isFeatured: Boolean(raw.isFeatured ?? raw.is_featured),
    playCount: toFiniteNumber(raw.playCount ?? raw.play_count),
    media: normalizeMusicMedia(raw.media),
  };
}

function normalizeMusicPlaylist(input: unknown): MusicPlaylist {
  const raw = asApiRecord(input);
  return {
    id: toFiniteNumber(raw.id),
    name: toText(raw.name),
    slug: toText(raw.slug),
    description: toOptionalText(raw.description),
    coverMediaFileId: toOptionalPositiveNumber(raw.coverMediaFileId ?? raw.cover_media_file_id),
    coverUrl: toOptionalText(raw.coverUrl ?? raw.cover_url),
    displayOnHome: Boolean(raw.displayOnHome ?? raw.display_on_home),
    displayOnProfile: Boolean(raw.displayOnProfile ?? raw.display_on_profile),
    carouselEnabled: Boolean(raw.carouselEnabled ?? raw.carousel_enabled),
    randomEnabled: Boolean(raw.randomEnabled ?? raw.random_enabled),
    trackCount: toFiniteNumber(raw.trackCount ?? raw.track_count),
  };
}

// React.cache 确保同一次渲染中 generateMetadata() 和 RootLayout 共享结果
export const getSiteSettings = cache(async function getSiteSettings(): Promise<SiteSettings> {
  try {
    const res = await fetch(API_ENDPOINTS.settings, {
      next: { revalidate: 10 },
      // 3 秒超时：构建时后端不可用快速 fallback，避免阻塞构建 5-15s
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) throw new Error('Failed to fetch settings');

    const json = await res.json();
    return normalizeSiteSettings(json.data || {});
  } catch (error) {
    logger.warn('Failed to fetch site settings, using defaults:', error);
    return DEFAULT_SITE_SETTINGS;
  }
});

/**
 * 获取最新发布文章
 * @param limit 数量限制
 * 重新验证：5 分钟 (300秒)
 */
export async function getRecentPosts(limit: number = 6): Promise<Post[]> {
  try {
    const res = await fetch(`${API_ENDPOINTS.posts}?pageNum=1&pageSize=${limit}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error('Failed to fetch posts');

    const json = await res.json();
    return json.data?.list || [];
  } catch (error) {
    logger.warn('Failed to fetch recent posts:', error);
    return [];
  }
}

/**
 * 获取友链列表
 * 重新验证：60 秒
 */
export async function getFriendLinks(): Promise<FriendLink[]> {
  try {
    const res = await fetch(API_ENDPOINTS.friendLinks, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error('Failed to fetch friend links');

    const json = await res.json();
    return json.data || [];
  } catch (error) {
    logger.warn('Failed to fetch friend links:', error);
    return [];
  }
}

/**
 * 获取公开音乐播放器配置与曲目队列
 * 重新验证：60 秒
 */
export async function getMusicPlayer(): Promise<MusicPlayer> {
  try {
    const res = await fetch(API_ENDPOINTS.musicPlayer, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error('Failed to fetch music player');

    const json = await res.json();
    const data = json.data || {};
    return {
      ...DEFAULT_MUSIC_PLAYER,
      ...data,
      playlist: data.playlist ? normalizeMusicPlaylist(data.playlist) : undefined,
      tracks: Array.isArray(data.tracks) ? data.tracks.map(normalizeMusicTrack) : [],
    };
  } catch (error) {
    logger.warn('Failed to fetch music player:', error);
    throw error;
  }
}

/**
 * 获取文章评论列表
 */
export async function getComments(postId: number): Promise<Comment[]> {
  try {
    const res = await fetch(API_ENDPOINTS.comments(postId), {
      cache: 'no-store'
    });

    if (!res.ok) throw new Error('Failed to fetch comments');

    const json = await res.json();
    return json.data?.list || [];
  } catch (error) {
    logger.warn('Failed to fetch comments:', error);
    return [];
  }
}

/**
 * 提交评论
 */
export async function createComment(postId: number, data: CreateCommentRequest): Promise<Comment> {
  const res = await fetch(API_ENDPOINTS.comments(postId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to submit comment');
  }

  const json = await res.json();
  return json.data;
}
/**
 * 获取站点统计
 * 重新验证：10 分钟 (600秒)
 */
export async function getSiteStats(): Promise<any> {
  try {
    const res = await fetch(API_ENDPOINTS.stats, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error('Failed to fetch stats');

    const json = await res.json();
    return json.data || {};
  } catch (error) {
    logger.warn('Failed to fetch site stats:', error);
    return {
      posts: 0,
      categories: 0,
      tags: 0
    };
  }
}
