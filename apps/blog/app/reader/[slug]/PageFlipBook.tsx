'use client';

import { useRouter } from 'next/navigation';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check, ChevronLeft, ChevronRight, List, Palette, RotateCcw, Settings, Type, X } from 'lucide-react';
import { useTheme } from '@aetherblog/hooks';
import styles from './PageFlipBook.module.css';
import {
  absolutePageToCursor,
  clampReaderPreferences,
  computeReaderDims,
  cursorToAbsolutePage,
  DEFAULT_READER_PREFERENCES,
  horizontalOffsetToPage,
  resolveReaderPageTurn,
  resolveReaderSkin,
  type ReaderDims as Dims,
  type ReaderFontFamily,
  type ReaderParagraphMode,
  type ReaderPageTurn,
  type ReaderPreferences,
  type ReaderSkin,
  type ResolvedSiteTheme,
} from './readerLogic';

export interface ReadingBookTocItem {
  id: string;
  text: string;
  level: number;
}

export interface ReadingBook {
  id: number;
  slug: string;
  title: string;
  author?: string | null;
  sourceRef?: string | null;
  contentHtml: string;
  toc?: ReadingBookTocItem[] | null;
  wordCount: number;
  readingTime: number;
  theme?: string;
}

const FLIP_MS = 660;
const SLIDE_MS = 260;
const TURN_ANGLE = -158;

interface FlipState {
  dir: 'next' | 'prev';
  angle: number;
  progress: 0 | 1;
  from: number;
  to: number;
  mode: ReaderPageTurn;
}

interface PointerState {
  id: number;
  startX: number;
  startY: number;
  handled: boolean;
}

const READER_PREFERENCES_KEY = 'aetherblog.reader.preferences';
const READER_POSITION_PREFIX = 'aetherblog.reader.position.';

function readStoredPreferences(): ReaderPreferences {
  if (typeof window === 'undefined') return DEFAULT_READER_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(READER_PREFERENCES_KEY);
    return clampReaderPreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
}

function getPositionKey(slug: string): string {
  return `${READER_POSITION_PREFIX}${slug}`;
}

function readStoredPage(slug: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getPositionKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { page?: unknown };
    const page = Number(parsed.page);
    return Number.isFinite(page) && page >= 0 ? Math.floor(page) : null;
  } catch {
    return null;
  }
}

function readImmediateSiteTheme(fallback: ResolvedSiteTheme): ResolvedSiteTheme {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem('aetherblog-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage 不可用时回退到 DOM class。
  }
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

const SKIN_OPTIONS: Array<{ value: ReaderSkin; label: string; swatch: string }> = [
  { value: 'auto', label: '跟随', swatch: 'linear-gradient(135deg, #f8f4eb 0 50%, #20242c 50% 100%)' },
  { value: 'paper', label: '白纸', swatch: '#fbfaf6' },
  { value: 'sepia', label: '暖黄', swatch: '#f6ecd6' },
  { value: 'sage', label: '青绿', swatch: '#e8f0df' },
  { value: 'rose', label: '柔粉', swatch: '#f7e8e3' },
  { value: 'night', label: '夜读', swatch: '#20242c' },
  { value: 'custom', label: '自定', swatch: 'linear-gradient(135deg, #a7f3d0, #818cf8)' },
];

const FONT_OPTIONS: Array<{ value: ReaderFontFamily; label: string }> = [
  { value: 'serif', label: '宋体' },
  { value: 'sans', label: '黑体' },
  { value: 'system', label: '系统' },
];

const TURN_OPTIONS: Array<{ value: ReaderPageTurn; label: string }> = [
  { value: 'slide', label: '滑动' },
  { value: 'curl', label: '翻页' },
  { value: 'instant', label: '瞬切' },
];

function isInteractiveKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button, input, textarea, select, [role="button"], [role="slider"], [contenteditable="true"]'));
}

const PARAGRAPH_OPTIONS: Array<{ value: ReaderParagraphMode; label: string }> = [
  { value: 'book', label: '缩进' },
  { value: 'article', label: '间距' },
];

interface PageSurfaceProps {
  pageIndex: number;
  side: 'left' | 'right' | 'single';
  dims: Dims;
  totalPages: number;
  title: string;
  contentHtml: string;
}

const PageSurface = memo(function PageSurface({
  pageIndex,
  side,
  dims,
  totalPages,
  title,
  contentHtml,
}: PageSurfaceProps) {
  const valid = pageIndex >= 0 && pageIndex < totalPages;
  const pageClass =
    side === 'left' ? styles.pageLeft : side === 'right' ? styles.pageRight : styles.pageSingle;
  const pageStyle: CSSProperties = { width: dims.pageW, height: dims.pageH };
  const wrapStyle: CSSProperties = {
    left: dims.padX,
    top: dims.padTop,
    width: dims.contentW,
    height: dims.contentH,
  };
  const flowStyle: CSSProperties = {
    width: dims.contentW,
    height: dims.contentH,
    columnWidth: dims.contentW,
    transform: `translate3d(${-pageIndex * dims.contentW}px, 0, 0)`,
  };

  return (
    <div className={`${styles.page} ${pageClass}`} style={pageStyle} aria-hidden={!valid}>
      {valid && (
        <>
          <div className={styles.pageHeader} style={{ top: dims.padTop * 0.42, paddingInline: dims.padX }}>
            {title}
          </div>
          <div className={styles.flowWrap} style={wrapStyle}>
            <div
              className={`${styles.content} ${styles.flow}`}
              style={flowStyle}
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
          </div>
          <div className={styles.pageNumber} style={{ bottom: dims.padBottom * 0.4 }}>
            {pageIndex + 1}
          </div>
        </>
      )}
    </div>
  );
});

export default function PageFlipBook({ book }: { book: ReadingBook }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [readerSiteTheme, setReaderSiteTheme] = useState<ResolvedSiteTheme>(resolvedTheme);
  const [preferences, setPreferences] = useState<ReaderPreferences>(DEFAULT_READER_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const effectiveSiteTheme = readerSiteTheme;
  const readerSkin = resolveReaderSkin(book.theme, preferences.skin, effectiveSiteTheme);

  const [dims, setDims] = useState<Dims | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  // cursor：double 模式下为 spread 索引，single 模式下为 page 索引。
  const [cursor, setCursor] = useState(0);
  const [flip, setFlip] = useState<FlipState | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [positionReady, setPositionReady] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);

  const measureRef = useRef<HTMLDivElement>(null);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flipFrames = useRef<number[]>([]);
  const prevColsRef = useRef<1 | 2 | null>(null);
  const pointerRef = useRef<PointerState | null>(null);
  const suppressClickRef = useRef(false);
  const animating = flip !== null;

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setReaderSiteTheme(readImmediateSiteTheme(resolvedTheme));

    syncTheme();
    const frame = window.requestAnimationFrame(syncTheme);
    const timer = window.setTimeout(syncTheme, 80);
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [resolvedTheme]);

  const clearFlipWork = useCallback(() => {
    if (flipTimer.current) {
      clearTimeout(flipTimer.current);
      flipTimer.current = null;
    }
    flipFrames.current.forEach((frame) => cancelAnimationFrame(frame));
    flipFrames.current = [];
  }, []);

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
  }, []);

  useEffect(() => {
    if (tocOpen || settingsOpen || !chromeVisible) return;
    const timer = window.setTimeout(() => setChromeVisible(false), 2400);
    return () => window.clearTimeout(timer);
  }, [chromeVisible, settingsOpen, tocOpen, cursor]);

  useEffect(() => {
    setPreferences(readStoredPreferences());
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      window.localStorage.setItem(READER_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      // localStorage 不可用时保持当前会话内偏好。
    }
  }, [preferences, preferencesLoaded]);

  const updatePreferences = useCallback((patch: Partial<ReaderPreferences>) => {
    setPreferences((prev) => clampReaderPreferences({ ...prev, ...patch }));
  }, []);

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_READER_PREFERENCES);
  }, []);

  // 响应式尺寸。
  useLayoutEffect(() => {
    const update = () => {
      clearFlipWork();
      setFlip(null);
      setDims(computeReaderDims({ width: window.innerWidth, height: window.innerHeight }));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [clearFlipWork]);

  const measurePages = useCallback(() => {
    if (!dims || !measureRef.current) return;
    const el = measureRef.current;
    const sw = el.scrollWidth;
    const pages = Math.max(1, Math.ceil(sw / dims.contentW));
    const prevCols = prevColsRef.current ?? dims.cols;
    setTotalPages((prev) => (prev === pages ? prev : pages));
    setCursor((c) => {
      const absolutePage = cursorToAbsolutePage(c, prevCols);
      const clamped = absolutePageToCursor(absolutePage, dims.cols, pages);
      return c === clamped ? c : clamped;
    });
    prevColsRef.current = dims.cols;
  }, [dims]);

  // 测量总页数（隐藏容器分列布局后读取 scrollWidth）。
  useLayoutEffect(() => {
    measurePages();
  }, [
    measurePages,
    book.contentHtml,
    preferences.fontSize,
    preferences.lineHeight,
    preferences.fontFamily,
    preferences.paragraphMode,
    readerSkin,
  ]);

  // 图片解码后会改变多列 scrollWidth；监听隐藏测量流中的图片并重新分页。
  useEffect(() => {
    if (!dims || !measureRef.current) {
      setMediaReady(false);
      return;
    }
    const el = measureRef.current;
    const images = Array.from(el.querySelectorAll('img'));
    if (images.length === 0) {
      const frame = requestAnimationFrame(() => setMediaReady(true));
      return () => cancelAnimationFrame(frame);
    }

    let raf = 0;
    let settledFrame = 0;
    let remaining = images.length;
    const settledImages = new WeakSet<HTMLImageElement>();
    const cleanupImageListeners: Array<() => void> = [];
    const scheduleMeasure = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(measurePages);
      });
    };
    const markImageSettled = (img: HTMLImageElement) => {
      if (settledImages.has(img)) return;
      settledImages.add(img);
      remaining -= 1;
      scheduleMeasure();
      if (remaining <= 0) {
        settledFrame = requestAnimationFrame(() => {
          settledFrame = requestAnimationFrame(() => setMediaReady(true));
        });
      }
    };

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMeasure);

    setMediaReady(false);
    images.forEach((img) => {
      const onSettled = () => markImageSettled(img);
      img.addEventListener('load', onSettled);
      img.addEventListener('error', onSettled);
      cleanupImageListeners.push(() => {
        img.removeEventListener('load', onSettled);
        img.removeEventListener('error', onSettled);
      });
      observer?.observe(img);
      if (typeof img.decode === 'function') {
        void img.decode().then(onSettled, onSettled);
      }
      if (img.complete) onSettled();
    });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (settledFrame) cancelAnimationFrame(settledFrame);
      observer?.disconnect();
      cleanupImageListeners.forEach((cleanup) => cleanup());
    };
  }, [dims, book.contentHtml, measurePages]);

  useEffect(() => {
    setPositionReady(false);
    setMediaReady(false);
  }, [book.slug]);

  useEffect(() => {
    if (!dims || positionReady || !mediaReady) return;
    const storedPage = readStoredPage(book.slug);
    if (storedPage !== null) {
      setCursor(absolutePageToCursor(storedPage, dims.cols, totalPages));
    }
    const frame = window.requestAnimationFrame(() => setPositionReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [book.slug, dims, mediaReady, positionReady, totalPages]);

  useEffect(() => {
    if (!dims || !positionReady) return;
    const page = cursorToAbsolutePage(cursor, dims.cols);
    try {
      window.localStorage.setItem(
        getPositionKey(book.slug),
        JSON.stringify({ page, totalPages, updatedAt: Date.now() }),
      );
    } catch {
      // localStorage 不可用时跳过持久化。
    }
  }, [book.slug, cursor, dims, positionReady, totalPages]);

  const cols = dims?.cols ?? 2;
  const unitCount = cols === 2 ? Math.ceil(totalPages / 2) : totalPages; // 翻页单元总数
  const maxCursor = Math.max(0, unitCount - 1);
  const visibleCursor = flip ? flip.to : cursor;
  const turnMode = resolveReaderPageTurn(preferences.pageTurn, cols);

  const startFlip = useCallback((dir: 'next' | 'prev', from: number, to: number) => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    clearFlipWork();

    if (prefersReduced || turnMode === 'instant') {
      setFlip(null);
      setCursor(to);
      return;
    }

    const startAngle = turnMode === 'curl' && dir === 'prev' ? TURN_ANGLE : 0;
    const endAngle = turnMode === 'curl' && dir === 'next' ? TURN_ANGLE : 0;
    const duration = turnMode === 'slide' ? SLIDE_MS : FLIP_MS;

    setFlip({ dir, angle: startAngle, progress: 0, from, to, mode: turnMode });
    const firstFrame = requestAnimationFrame(() => {
      const secondFrame = requestAnimationFrame(() => {
        if (flipTimer.current) {
          setFlip({ dir, angle: endAngle, progress: 1, from, to, mode: turnMode });
        }
      });
      flipFrames.current = [secondFrame];
    });
    flipFrames.current = [firstFrame];
    flipTimer.current = setTimeout(() => {
      setCursor(to);
      setFlip(null);
      flipTimer.current = null;
      flipFrames.current = [];
    }, duration);
  }, [clearFlipWork, turnMode]);

  const goNext = useCallback(() => {
    if (animating || cursor >= maxCursor) return;
    startFlip('next', cursor, Math.min(cursor + 1, maxCursor));
  }, [animating, cursor, maxCursor, startFlip]);

  const goPrev = useCallback(() => {
    if (animating || cursor <= 0) return;
    startFlip('prev', cursor, Math.max(cursor - 1, 0));
  }, [animating, cursor, startFlip]);

  const handleBookPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (tocOpen || settingsOpen) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      handled: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [settingsOpen, tocOpen]);

  const handleBookPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== e.pointerId || pointer.handled || animating) return;
    const dx = e.clientX - pointer.startX;
    const dy = e.clientY - pointer.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < 42 || absX < absY * 1.25) return;

    pointer.handled = true;
    suppressClickRef.current = true;
    setChromeVisible(false);
    if (dx < 0) goNext();
    else goPrev();
  }, [animating, goNext, goPrev]);

  const handleBookPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== e.pointerId) return;

    const dx = e.clientX - pointer.startX;
    const dy = e.clientY - pointer.startY;
    const wasHandled = pointer.handled;
    pointerRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (!wasHandled && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < rect.width * 0.34) {
        suppressClickRef.current = true;
        setChromeVisible(false);
        goPrev();
      } else if (x > rect.width * 0.66) {
        suppressClickRef.current = true;
        setChromeVisible(false);
        goNext();
      } else {
        setChromeVisible((v) => !v);
      }
    }

    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, [goNext, goPrev]);

  const handleBookPointerCancel = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerRef.current?.id === e.pointerId) {
      pointerRef.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  const handleHitZoneClick = useCallback(
    (action: () => void) => (e: ReactMouseEvent<HTMLButtonElement>) => {
      if (suppressClickRef.current) {
        e.preventDefault();
        e.stopPropagation();
        suppressClickRef.current = false;
        return;
      }
      action();
    },
    [],
  );

  const jumpTo = useCallback(
    (unit: number) => {
      if (animating) return;
      revealChrome();
      setCursor(Math.max(0, Math.min(unit, maxCursor)));
    },
    [animating, maxCursor, revealChrome],
  );

  const close = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push('/');
  }, [router]);

  // 键盘导航。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false);
        else if (tocOpen) setTocOpen(false);
        else close();
      } else if (settingsOpen || tocOpen || isInteractiveKeyTarget(e.target)) {
        return;
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, close, tocOpen, settingsOpen]);

  useEffect(() => () => clearFlipWork(), [clearFlipWork]);

  // 跳转到目录锚点所在页（通过测量容器中锚点元素的水平偏移定位）。
  const jumpToHeading = useCallback(
    (id: string) => {
      if (!dims || !measureRef.current) return;
      const target = measureRef.current.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      if (!target) return;
      const measureRect = measureRef.current.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const page = horizontalOffsetToPage(targetRect.left, measureRect.left, dims.contentW);
      const unit = cols === 2 ? Math.floor(page / 2) : page;
      jumpTo(unit);
      setTocOpen(false);
    },
    [dims, cols, jumpTo],
  );

  useEffect(() => {
    if (!dims || !measureRef.current || !book.toc?.length) {
      setActiveHeadingId(null);
      return;
    }
    const currentPage = cursorToAbsolutePage(visibleCursor, cols);
    const measureRect = measureRef.current.getBoundingClientRect();
    let active: string | null = null;
    for (const h of book.toc) {
      const target = measureRef.current.querySelector<HTMLElement>(`[id="${CSS.escape(h.id)}"]`);
      if (!target) continue;
      const targetRect = target.getBoundingClientRect();
      const page = horizontalOffsetToPage(targetRect.left, measureRect.left, dims.contentW);
      if (page <= currentPage) active = h.id;
      else break;
    }
    setActiveHeadingId(active);
  }, [book.toc, cols, dims, visibleCursor]);

  // 给定页索引渲染一个完整页面（含页眉/页码/正文窗口）。
  const renderPage = (pageIndex: number, side: 'left' | 'right' | 'single') => {
    if (!dims) return null;
    return (
      <PageSurface
        pageIndex={pageIndex}
        side={side}
        dims={dims}
        totalPages={totalPages}
        title={book.title}
        contentHtml={book.contentHtml}
      />
    );
  };

  // 计算当前展示的底层页与翻动叶片的页索引。
  const layout = useMemo(() => {
    if (cols === 2) {
      const s = cursor;
      if (!flip) {
        return { baseLeft: 2 * s, baseRight: 2 * s + 1, leaf: null as null | { front: number; back: number } };
      }
      if (flip.dir === 'next') {
        return {
          baseLeft: 2 * flip.from,
          baseRight: 2 * flip.to + 1,
          leaf: { front: 2 * flip.from + 1, back: 2 * flip.to },
        };
      }
      // prev：底层显示目标 spread，叶片背面保留原 spread 的左页。
      return {
        baseLeft: 2 * flip.to,
        baseRight: 2 * flip.to + 1,
        leaf: { front: 2 * flip.to + 1, back: 2 * flip.from },
      };
    }
    // 单页模式
    const p = cursor;
    if (!flip) return { single: p, leaf: null as null | { front: number; back: number } };
    if (flip.dir === 'next') return { single: flip.to, leaf: { front: flip.from, back: flip.to } };
    return { single: flip.to, leaf: { front: flip.to, back: flip.from } };
  }, [cols, cursor, flip]);

  const fontFamilyValue = useMemo(() => {
    if (preferences.fontFamily === 'sans') {
      return "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif";
    }
    if (preferences.fontFamily === 'system') {
      return "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif";
    }
    return "'Noto Serif SC', 'Songti SC', STSong, Georgia, 'Times New Roman', serif";
  }, [preferences.fontFamily]);

  const overlayStyle = useMemo(() => {
    const dimOpacity = ((100 - preferences.brightness) / 100 * 0.62).toFixed(3);
    return {
      '--reader-font-size': `${preferences.fontSize}px`,
      '--reader-line-height': String(preferences.lineHeight),
      '--reader-font-family': fontFamilyValue,
      '--reader-dim-opacity': dimOpacity,
      ...(readerSkin === 'custom'
        ? {
          '--reader-bg': preferences.customBg,
          '--reader-page': preferences.customPage,
          '--reader-page-edge': preferences.customPage,
          '--reader-ink': preferences.customInk,
          '--reader-muted': preferences.customInk,
          '--reader-shadow': 'rgba(15, 23, 42, 0.24)',
          '--reader-cover': preferences.customInk,
          '--reader-gutter': 'rgba(15, 23, 42, 0.2)',
        }
        : {}),
    } as CSSProperties;
  }, [fontFamilyValue, preferences, readerSkin]);

  const renderSingleStage = () => {
    if (!dims) return null;
    if (flip?.mode === 'slide') {
      const pages = flip.dir === 'next' ? [flip.from, flip.to] : [flip.to, flip.from];
      const offset = flip.dir === 'next'
        ? (flip.progress === 1 ? -dims.pageW : 0)
        : (flip.progress === 1 ? 0 : -dims.pageW);
      return (
        <div className={styles.singleSlider} style={{ width: dims.pageW, height: dims.pageH }}>
          <div
            className={styles.singleTrack}
            style={{
              width: dims.pageW * 2,
              height: dims.pageH,
              transform: `translate3d(${offset}px, 0, 0)`,
              transition: `transform ${SLIDE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`,
            }}
          >
            {pages.map((pageIndex, index) => (
              <div key={`${pageIndex}-${index}`} className={styles.singlePane} style={{ width: dims.pageW, height: dims.pageH }}>
                {renderPage(pageIndex, 'single')}
              </div>
            ))}
          </div>
        </div>
      );
    }
    return renderPage(layout.single!, 'single');
  };
  if (!dims) {
    return (
      <div
        className={styles.overlay}
        data-theme={readerSkin}
        data-reader-site-theme={effectiveSiteTheme}
        data-reader-skin-preference={preferences.skin}
        data-reader-paragraph-mode={preferences.paragraphMode}
        style={overlayStyle}
      />
    );
  }

  const counter =
    cols === 2
      ? `${Math.min(visibleCursor * 2 + 1, totalPages)}–${Math.min(visibleCursor * 2 + 2, totalPages)} / ${totalPages}`
      : `${visibleCursor + 1} / ${totalPages}`;

  // 叶片几何：双页时叶片位于右页位置、绕书脊（左缘）旋转；单页时占满整页、绕左缘旋转。
  const leafLeft = cols === 2 ? dims.pageW : 0;
  const turnProgress = flip ? Math.min(1, Math.abs(flip.angle / TURN_ANGLE)) : 0;
  const leafTransition = flip ? `transform ${FLIP_MS}ms cubic-bezier(0.28, 0.02, 0.2, 1)` : 'none';
  const leafTilt = flip?.dir === 'next' ? -0.9 : 0.9;
  const leafSkew = flip ? (flip.dir === 'next' ? 1 : -1) * Math.sin(turnProgress * Math.PI) * 4.5 : 0;
  const leafShadeOpacity = flip ? 0.1 + Math.sin(turnProgress * Math.PI) * 0.42 : 0;
  const chromeIsVisible = chromeVisible || tocOpen || settingsOpen;

  return (
    <div
      className={styles.overlay}
      data-theme={readerSkin}
      data-reader-site-theme={effectiveSiteTheme}
      data-reader-skin-preference={preferences.skin}
      data-reader-paragraph-mode={preferences.paragraphMode}
      data-chrome-visible={chromeIsVisible ? 'true' : 'false'}
      style={overlayStyle}
    >
      {/* 顶栏 */}
      <div className={styles.topbar} onPointerDown={revealChrome}>
        <button className={styles.iconBtn} onClick={close} aria-label="退出阅读">
          <X size={18} />
          <span>退出</span>
        </button>
        <div className={styles.title}>
          {book.title}
          {book.sourceRef ? ` · ${book.sourceRef}` : ''}
        </div>
        <div className={styles.topbarActions}>
          <button
            className={styles.iconBtn}
            onClick={() => {
              setChromeVisible(true);
              setSettingsOpen(false);
              setTocOpen((v) => !v);
            }}
            aria-label="目录"
          >
            <List size={18} />
            <span>目录</span>
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => {
              setChromeVisible(true);
              setTocOpen(false);
              setSettingsOpen((v) => !v);
            }}
            aria-label="阅读设置"
          >
            <Settings size={18} />
            <span>设置</span>
          </button>
        </div>
      </div>

      {/* 书台 */}
      <div className={styles.stage}>
        <div
          className={`${styles.book} ${cols === 1 ? styles.bookSingle : styles.bookSpread}`}
          style={{ width: dims.pageW * cols, height: dims.pageH }}
          data-turn-mode={turnMode}
          onPointerDown={handleBookPointerDown}
          onPointerMove={handleBookPointerMove}
          onPointerUp={handleBookPointerUp}
          onPointerCancel={handleBookPointerCancel}
        >
          {/* 点击左右半区翻页 */}
          {cols === 2 ? (
            <>
              {renderPage(layout.baseLeft!, 'left')}
              {renderPage(layout.baseRight!, 'right')}
            </>
          ) : (
            renderSingleStage()
          )}

          {/* 翻动叶片 */}
          {flip?.mode === 'curl' && layout.leaf && (
            <div
              className={styles.leaf}
              style={{
                left: leafLeft,
                width: dims.pageW,
                height: dims.pageH,
                transform: `translateZ(2px) rotateY(${flip.angle}deg) rotateZ(${leafTilt}deg) skewY(${leafSkew}deg)`,
                transition: leafTransition,
              }}
            >
              <div className={styles.leafFace}>
                {renderPage(layout.leaf.front, cols === 2 ? 'right' : 'single')}
                <div className={styles.leafShade} style={{ opacity: leafShadeOpacity }} />
              </div>
              <div className={`${styles.leafFace} ${styles.leafBack}`}>
                {renderPage(layout.leaf.back, cols === 2 ? 'left' : 'single')}
              </div>
            </div>
          )}

          {/* 透明点击层 */}
          <button
            aria-label="上一页"
            onClick={handleHitZoneClick(goPrev)}
            disabled={cursor <= 0 || animating}
            tabIndex={-1}
            className={styles.hitZoneLeft}
          />
          <button
            aria-label="下一页"
            onClick={handleHitZoneClick(goNext)}
            disabled={cursor >= maxCursor || animating}
            tabIndex={-1}
            className={styles.hitZoneRight}
          />
        </div>
      </div>

      {/* 底部控制条 */}
      <div className={styles.controls} onPointerDown={revealChrome}>
        <button className={styles.navBtn} onClick={goPrev} disabled={cursor <= 0 || animating} aria-label="上一页">
          <ChevronLeft size={18} />
        </button>
        <input
          className={styles.slider}
          type="range"
          min={0}
          max={maxCursor}
          value={visibleCursor}
          disabled={animating}
          onChange={(e) => jumpTo(Number(e.target.value))}
          aria-label="阅读进度"
        />
        <span className={styles.counter}>{counter}</span>
        <button className={styles.navBtn} onClick={goNext} disabled={cursor >= maxCursor || animating} aria-label="下一页">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* 目录抽屉 */}
      {tocOpen && (
        <>
          <div
            className={styles.scrim}
            onClick={() => setTocOpen(false)}
          />
          <nav className={styles.toc}>
            <div className={styles.tocHeader}>
              <strong>目录</strong>
              <button className={styles.iconBtn} onClick={() => setTocOpen(false)} aria-label="关闭目录">
                <X size={16} />
              </button>
            </div>
            {(book.toc ?? []).length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--reader-muted)' }}>本书暂无章节目录。</p>
            ) : (
              (book.toc ?? []).map((h, i) => (
                <button
                  key={`${h.id}-${i}`}
                  className={`${styles.tocItem} ${activeHeadingId === h.id ? styles.tocItemActive : ''}`}
                  style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                  onClick={() => jumpToHeading(h.id)}
                >
                  {h.text}
                </button>
              ))
            )}
          </nav>
        </>
      )}

      {/* 阅读设置 */}
      {settingsOpen && (
        <>
          <div
            className={styles.scrim}
            onClick={() => setSettingsOpen(false)}
          />
          <aside className={`${styles.toc} ${styles.settingsPanel}`} role="dialog" aria-modal="true" aria-label="阅读设置">
            <div className={styles.tocHeader}>
              <strong>阅读设置</strong>
              <button className={styles.iconBtn} onClick={() => setSettingsOpen(false)} aria-label="关闭阅读设置">
                <X size={16} />
              </button>
            </div>

            <section className={styles.settingSection}>
              <div className={styles.settingTitle}>
                <Palette size={15} />
                <span>皮肤</span>
              </div>
              <div className={styles.skinGrid}>
                {SKIN_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`${styles.skinButton} ${preferences.skin === option.value ? styles.optionActive : ''}`}
                    onClick={() => updatePreferences({ skin: option.value })}
                    aria-pressed={preferences.skin === option.value}
                  >
                    <span className={styles.skinSwatch} style={{ background: option.swatch }} />
                    <span>{option.label}</span>
                    {preferences.skin === option.value && <Check size={13} />}
                  </button>
                ))}
              </div>
              {preferences.skin === 'auto' && (
                <p className={styles.settingHint}>
                  当前跟随全站{effectiveSiteTheme === 'dark' ? '暗色' : '亮色'}主题。
                </p>
              )}
              {preferences.skin === 'custom' && (
                <div className={styles.customColors}>
                  <label>
                    <span>背景</span>
                    <input
                      type="color"
                      value={preferences.customBg}
                      onChange={(e) => updatePreferences({ customBg: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>纸面</span>
                    <input
                      type="color"
                      value={preferences.customPage}
                      onChange={(e) => updatePreferences({ customPage: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>文字</span>
                    <input
                      type="color"
                      value={preferences.customInk}
                      onChange={(e) => updatePreferences({ customInk: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </section>

            <section className={styles.settingSection}>
              <div className={styles.settingTitle}>
                <Type size={15} />
                <span>字号</span>
                <strong>{preferences.fontSize}px</strong>
              </div>
              <div className={styles.stepper}>
                <button
                  type="button"
                  disabled={preferences.fontSize <= 14}
                  onClick={() => updatePreferences({ fontSize: preferences.fontSize - 1 })}
                >
                  A-
                </button>
                <input
                  type="range"
                  min={14}
                  max={24}
                  value={preferences.fontSize}
                  onChange={(e) => updatePreferences({ fontSize: Number(e.target.value) })}
                  aria-label="调整字号"
                />
                <button
                  type="button"
                  disabled={preferences.fontSize >= 24}
                  onClick={() => updatePreferences({ fontSize: preferences.fontSize + 1 })}
                >
                  A+
                </button>
              </div>
            </section>

            <section className={styles.settingSection}>
              <div className={styles.settingTitle}>
                <span>行距</span>
                <strong>{preferences.lineHeight.toFixed(2)}</strong>
              </div>
              <input
                className={styles.settingRange}
                type="range"
                min={1.5}
                max={2.2}
                step={0.05}
                value={preferences.lineHeight}
                onChange={(e) => updatePreferences({ lineHeight: Number(e.target.value) })}
                aria-label="调整行距"
              />
            </section>

            <section className={styles.settingSection}>
              <div className={styles.settingTitle}>
                <span>段落</span>
              </div>
              <div className={styles.segmented}>
                {PARAGRAPH_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={preferences.paragraphMode === option.value ? styles.optionActive : ''}
                    onClick={() => updatePreferences({ paragraphMode: option.value })}
                    aria-pressed={preferences.paragraphMode === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.settingSection}>
              <div className={styles.settingTitle}>
                <span>亮度</span>
                <strong>{preferences.brightness}%</strong>
              </div>
              <input
                className={styles.settingRange}
                type="range"
                min={70}
                max={100}
                value={preferences.brightness}
                onChange={(e) => updatePreferences({ brightness: Number(e.target.value) })}
                aria-label="调整亮度"
              />
            </section>

            <section className={styles.settingSection}>
              <div className={styles.settingTitle}>
                <span>字体</span>
              </div>
              <div className={styles.segmented}>
                {FONT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={preferences.fontFamily === option.value ? styles.optionActive : ''}
                    onClick={() => updatePreferences({ fontFamily: option.value })}
                    aria-pressed={preferences.fontFamily === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.settingSection}>
              <div className={styles.settingTitle}>
                <span>翻页</span>
              </div>
              <div className={styles.segmented}>
                {TURN_OPTIONS.map((option) => {
                  const unsupported = cols === 2 && option.value === 'slide';
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={unsupported}
                      className={turnMode === option.value ? styles.optionActive : ''}
                      onClick={() => updatePreferences({ pageTurn: option.value })}
                      aria-pressed={turnMode === option.value}
                      title={unsupported ? '双页模式使用翻页效果' : undefined}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <button className={styles.resetButton} onClick={resetPreferences}>
              <RotateCcw size={15} />
              恢复默认
            </button>
          </aside>
        </>
      )}

      {/* 隐藏测量容器：与可见页相同的分列约束，用于计算总页数与锚点定位 */}
      <div
        aria-hidden
        style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', left: -99999, top: 0, width: dims.contentW, height: dims.contentH }}
      >
        <div
          ref={measureRef}
          className={styles.content + ' ' + styles.flow}
          style={{ width: dims.contentW, height: dims.contentH, columnWidth: dims.contentW }}
          dangerouslySetInnerHTML={{ __html: book.contentHtml }}
        />
      </div>
    </div>
  );
}
