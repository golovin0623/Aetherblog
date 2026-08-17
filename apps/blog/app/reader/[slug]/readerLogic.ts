export type ResolvedSiteTheme = 'light' | 'dark';
export type ReaderSkin = 'auto' | 'paper' | 'sepia' | 'night' | 'sage' | 'rose' | 'custom';
export type ResolvedReaderSkin = Exclude<ReaderSkin, 'auto'>;
export type ReaderFontFamily = 'serif' | 'sans' | 'kai' | 'system';
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
  /** 版面缩放（桌面双页布局的整书尺寸系数），0.7–1.4，步进 0.05。 */
  zoom: number;
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

export const READER_ZOOM_MIN = 0.7;
export const READER_ZOOM_MAX = 1.4;
export const READER_ZOOM_STEP = 0.05;

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  skin: 'auto',
  fontSize: 17,
  lineHeight: 1.78,
  fontFamily: 'serif',
  paragraphMode: 'book',
  pageTurn: 'slide',
  brightness: 100,
  zoom: 1,
  customBg: '#ecebe7',
  customPage: '#fbfaf6',
  customInk: '#2b2b2b',
};

const SKINS = new Set<ReaderSkin>(['auto', 'paper', 'sepia', 'night', 'sage', 'rose', 'custom']);
const FONT_FAMILIES = new Set<ReaderFontFamily>(['serif', 'sans', 'kai', 'system']);
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

export function clampReaderZoom(value: unknown): number {
  const clamped = clampNumber(value, READER_ZOOM_MIN, READER_ZOOM_MAX, DEFAULT_READER_PREFERENCES.zoom);
  // 步进取整后归约到两位小数，避免 28 × 0.05 = 1.4000000000000001 类浮点漂移。
  return Math.round(Math.round(clamped / READER_ZOOM_STEP) * READER_ZOOM_STEP * 100) / 100;
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
    zoom: clampReaderZoom(src.zoom),
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

export function computeReaderDims(viewport: ReaderViewport, zoom = 1): ReaderDims {
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
  const zoomFactor = clampReaderZoom(zoom);
  // 桌面 chrome（顶栏/底栏）为悬浮层，只需为运行头与页脚留出呼吸空间。
  const reservedV = 128;
  const maxPageH = Math.max(vh - reservedV, 240);
  const preferredH = Math.round(860 * zoomFactor);
  let pageH = Math.max(Math.min(maxPageH, preferredH), 240);
  let pageW = Math.round(pageH * 0.66);

  const maxBookW = Math.max(vw - 48, 240);
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

// ---------------------------------------------------------------------------
// 翻页物理（纯函数，供 rAF 引擎逐帧积分；单测覆盖于 reader gate）
// ---------------------------------------------------------------------------

export interface FlipSpringState {
  /** 翻页进度 0（原页）→ 1（目标页）。 */
  p: number;
  /** 进度速度，单位 progress/s。 */
  v: number;
}

/** 临界阻尼弹簧的半隐式欧拉积分：纸张落下不回弹。dt 超过 34ms 按 34ms 截断，后台标签页恢复时不跳帧。 */
export function stepFlipSpring(
  state: FlipSpringState,
  target: number,
  dtMs: number,
  stiffness = 170,
  damping = 26,
): FlipSpringState {
  const dt = Math.min(Math.max(dtMs, 0), 34) / 1000;
  const accel = stiffness * (target - state.p) - damping * state.v;
  const v = state.v + accel * dt;
  const p = state.p + v * dt;
  return { p, v };
}

export function isFlipSettled(state: FlipSpringState, target: number): boolean {
  return Math.abs(target - state.p) < 0.003 && Math.abs(state.v) < 0.05;
}

/**
 * 归一化的叶片行程：next 方向 progress 即行程；prev 方向叶片从对侧（行程 1）落回 0。
 * 叶片角度 = -180° × 行程。
 */
export function flipTravel(dir: 'next' | 'prev', p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  return dir === 'next' ? clamped : 1 - clamped;
}

/** 拖拽位移 → 翻页进度。next 需向左拖（dx<0），prev 需向右拖（dx>0）。 */
export function dragToProgress(dx: number, pageW: number, dir: 'next' | 'prev'): number {
  const travel = Math.max(pageW * 1.05, 1);
  const raw = dir === 'next' ? -dx / travel : dx / travel;
  return Math.min(1, Math.max(0, raw));
}

/**
 * 松手裁决：按 160ms 的速度投影判断落向哪一侧。
 * 快速甩动即便位移很小也应完成翻页；缓慢拖过半即提交。
 */
export function resolveFlipRelease(p: number, v: number): 0 | 1 {
  const projected = p + v * 0.16;
  return projected >= 0.5 ? 1 : 0;
}
