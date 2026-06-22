export type ResolvedSiteTheme = 'light' | 'dark';
export type ReaderSkin = 'auto' | 'paper' | 'sepia' | 'night' | 'sage' | 'rose' | 'custom';
export type ResolvedReaderSkin = Exclude<ReaderSkin, 'auto'>;
export type ReaderFontFamily = 'serif' | 'sans' | 'system';
export type ReaderPageTurn = 'slide' | 'curl' | 'instant';
export type ReaderParagraphMode = 'book' | 'article';

export interface ReaderPreferences {
  skin: ReaderSkin;
  fontSize: number;
  lineHeight: number;
  fontFamily: ReaderFontFamily;
  paragraphMode: ReaderParagraphMode;
  pageTurn: ReaderPageTurn;
  brightness: number;
  customBg: string;
  customPage: string;
  customInk: string;
}

export interface ReaderViewport {
  width: number;
  height: number;
}

export interface ReaderDims {
  pageW: number;
  pageH: number;
  padX: number;
  padTop: number;
  padBottom: number;
  contentW: number;
  contentH: number;
  cols: 1 | 2;
}

export const MOBILE_BREAKPOINT = 768;

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  skin: 'auto',
  fontSize: 17,
  lineHeight: 1.78,
  fontFamily: 'serif',
  paragraphMode: 'book',
  pageTurn: 'slide',
  brightness: 100,
  customBg: '#ecebe7',
  customPage: '#fbfaf6',
  customInk: '#2b2b2b',
};

const SKINS = new Set<ReaderSkin>(['auto', 'paper', 'sepia', 'night', 'sage', 'rose', 'custom']);
const FONT_FAMILIES = new Set<ReaderFontFamily>(['serif', 'sans', 'system']);
const PAGE_TURNS = new Set<ReaderPageTurn>(['slide', 'curl', 'instant']);
const PARAGRAPH_MODES = new Set<ReaderParagraphMode>(['book', 'article']);

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed.toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

export function clampReaderPreferences(input: Partial<ReaderPreferences> | null | undefined): ReaderPreferences {
  const src = input ?? {};
  const skin = SKINS.has(src.skin as ReaderSkin) ? (src.skin as ReaderSkin) : DEFAULT_READER_PREFERENCES.skin;
  const fontFamily = FONT_FAMILIES.has(src.fontFamily as ReaderFontFamily)
    ? (src.fontFamily as ReaderFontFamily)
    : DEFAULT_READER_PREFERENCES.fontFamily;
  const pageTurn = PAGE_TURNS.has(src.pageTurn as ReaderPageTurn)
    ? (src.pageTurn as ReaderPageTurn)
    : DEFAULT_READER_PREFERENCES.pageTurn;
  const paragraphMode = PARAGRAPH_MODES.has(src.paragraphMode as ReaderParagraphMode)
    ? (src.paragraphMode as ReaderParagraphMode)
    : DEFAULT_READER_PREFERENCES.paragraphMode;

  return {
    skin,
    fontSize: Math.round(clampNumber(src.fontSize, 14, 24, DEFAULT_READER_PREFERENCES.fontSize)),
    lineHeight: Math.round(clampNumber(src.lineHeight, 1.5, 2.2, DEFAULT_READER_PREFERENCES.lineHeight) * 100) / 100,
    fontFamily,
    paragraphMode,
    pageTurn,
    brightness: Math.round(clampNumber(src.brightness, 70, 100, DEFAULT_READER_PREFERENCES.brightness)),
    customBg: normalizeHexColor(src.customBg, DEFAULT_READER_PREFERENCES.customBg),
    customPage: normalizeHexColor(src.customPage, DEFAULT_READER_PREFERENCES.customPage),
    customInk: normalizeHexColor(src.customInk, DEFAULT_READER_PREFERENCES.customInk),
  };
}

export function resolveReaderSkin(
  bookTheme: string | null | undefined,
  preferredSkin: ReaderSkin,
  siteTheme: ResolvedSiteTheme,
): ResolvedReaderSkin {
  if (preferredSkin !== 'auto') return preferredSkin;
  if (bookTheme === 'night' || bookTheme === 'sepia') return bookTheme;
  return siteTheme === 'dark' ? 'night' : 'paper';
}

export function resolveReaderPageTurn(preferredPageTurn: ReaderPageTurn, cols: 1 | 2): ReaderPageTurn {
  if (preferredPageTurn === 'instant') return 'instant';
  if (cols === 2) return 'curl';
  return preferredPageTurn;
}

export function computeReaderDims(viewport: ReaderViewport): ReaderDims {
  const vw = Math.max(320, Math.round(viewport.width));
  const vh = Math.max(480, Math.round(viewport.height));
  const isMobile = vw <= MOBILE_BREAKPOINT;

  if (isMobile) {
    const safeHorizontal = vw <= 360 ? 22 : 28;
    const pageW = vw;
    const pageH = vh;
    const padX = safeHorizontal;
    const padTop = Math.round(Math.min(64, Math.max(50, vh * 0.075)));
    const padBottom = Math.round(Math.min(58, Math.max(44, vh * 0.066)));
    return {
      pageW,
      pageH,
      padX,
      padTop,
      padBottom,
      contentW: pageW - padX * 2,
      contentH: pageH - padTop - padBottom,
      cols: 1,
    };
  }

  const cols: 1 | 2 = 2;
  const reservedV = 156;
  const maxPageH = Math.max(vh - reservedV, 240);
  let pageH = Math.max(Math.min(maxPageH, 860), 240);
  let pageW = Math.round(pageH * 0.66);

  const maxBookW = Math.max(vw - 28, 240);
  const bookW = cols * pageW;
  if (bookW > maxBookW) {
    pageW = Math.floor(maxBookW / cols);
    pageH = Math.round(pageW / 0.66);
  }

  if (pageH > maxPageH) {
    pageH = maxPageH;
    pageW = Math.floor(pageH * 0.66);
  }

  const padX = Math.round(pageW * 0.11);
  const padTop = Math.round(pageH * 0.095);
  const padBottom = Math.round(pageH * 0.075);

  return {
    pageW,
    pageH,
    padX,
    padTop,
    padBottom,
    contentW: pageW - padX * 2,
    contentH: pageH - padTop - padBottom,
    cols,
  };
}

export function cursorToAbsolutePage(cursor: number, cols: 1 | 2): number {
  return Math.max(0, cols === 2 ? cursor * 2 : cursor);
}

export function absolutePageToCursor(page: number, cols: 1 | 2, totalPages: number): number {
  const maxPage = Math.max(0, totalPages - 1);
  const safePage = Math.min(Math.max(0, Math.floor(page)), maxPage);
  const maxCursor = Math.max(0, cols === 2 ? Math.ceil(totalPages / 2) - 1 : totalPages - 1);
  const cursor = cols === 2 ? Math.floor(safePage / 2) : safePage;
  return Math.min(cursor, maxCursor);
}

export function horizontalOffsetToPage(targetLeft: number, containerLeft: number, contentW: number): number {
  if (!Number.isFinite(targetLeft) || !Number.isFinite(containerLeft) || !Number.isFinite(contentW) || contentW <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor((targetLeft - containerLeft) / contentW));
}
