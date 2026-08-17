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
import {
  Check, ChevronLeft, ChevronRight, List, Minus, Palette, Plus,
  RotateCcw, Settings, Type, X, ZoomIn,
} from 'lucide-react';
import { useTheme } from '@aetherblog/hooks';
import styles from './PageFlipBook.module.css';
import {
  absolutePageToCursor,
  clampReaderPreferences,
  computeReaderDims,
  cursorToAbsolutePage,
  DEFAULT_READER_PREFERENCES,
  dragToProgress,
  flipTravel,
  horizontalOffsetToPage,
  isFlipSettled,
  READER_ZOOM_MAX,
  READER_ZOOM_MIN,
  READER_ZOOM_STEP,
  resolveFlipRelease,
  resolveReaderPageTurn,
  resolveReaderSkin,
  stepFlipSpring,
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

/** 悬停掀角的静置进度。 */
const PEEK_PROGRESS = 0.055;
/** 未裁决拖拽的 target 哨兵。 */
const TARGET_UNDECIDED = -1;
/** 滚轮翻页的累计阈值。 */
const WHEEL_FLIP_THRESHOLD = 110;

interface FlipState {
  dir: 'next' | 'prev';
  from: number;
  to: number;
  mode: 'curl' | 'slide';
}

/** rAF 引擎持有的翻页任务（不进 React state，逐帧写 DOM）。 */
interface FlipJob extends FlipState {
  p: number;
  v: number;
  /** 0=取消 1=提交 PEEK_PROGRESS=掀角悬停 TARGET_UNDECIDED=拖拽中。 */
  target: number;
  dragging: boolean;
  peeking: boolean;
  dragBaseP: number;
  samples: Array<{ t: number; p: number }>;
  lastT: number;
}

interface PointerState {
  id: number;
  startX: number;
  startY: number;
  startedOnInteractive: boolean;
  handled: boolean;
}

const READER_PREFERENCES_KEY = 'aetherblog.reader.preferences';
const READER_POSITION_PREFIX = 'aetherblog.reader.position.';
const READER_SERIF_FONT_ID = 'aetherblog-reader-serif-font';
const READER_SERIF_FONT_URL =
  'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;700&display=swap';

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

/** 成书正文默认衬线需要真实字形支撑；按需注入 webfont（与 FontProvider 相同的 link 注入策略）。 */
function ensureReaderSerifFont() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(READER_SERIF_FONT_ID)) return;
  const link = document.createElement('link');
  link.id = READER_SERIF_FONT_ID;
  link.rel = 'stylesheet';
  link.href = READER_SERIF_FONT_URL;
  document.head.appendChild(link);
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
  { value: 'kai', label: '楷体' },
  { value: 'sans', label: '黑体' },
  { value: 'system', label: '系统' },
];

const TURN_OPTIONS: Array<{ value: ReaderPageTurn; label: string }> = [
  { value: 'slide', label: '滑动' },
  { value: 'curl', label: '翻页' },
  { value: 'instant', label: '瞬切' },
];

const PARAGRAPH_OPTIONS: Array<{ value: ReaderParagraphMode; label: string }> = [
  { value: 'book', label: '缩进' },
  { value: 'article', label: '间距' },
];

function sameReaderDims(a: Dims, b: Dims): boolean {
  return a.pageW === b.pageW
    && a.pageH === b.pageH
    && a.padX === b.padX
    && a.padTop === b.padTop
    && a.padBottom === b.padBottom
    && a.contentW === b.contentW
    && a.contentH === b.contentH
    && a.cols === b.cols;
}

function isInteractiveKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button, input, textarea, select, [role="button"], [role="slider"], [contenteditable="true"]'));
}

function isReaderContentInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('a[href], button, input, textarea, select, summary, [role="button"], [role="link"], [contenteditable="true"]'));
}

interface PageSurfaceProps {
  pageIndex: number;
  side: 'left' | 'right' | 'single';
  dims: Dims;
  totalPages: number;
  runningHead: string;
  contentHtml: string;
}

const PageSurface = memo(function PageSurface({
  pageIndex,
  side,
  dims,
  totalPages,
  runningHead,
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
    <div className={`${styles.page} ${pageClass}`} style={pageStyle} data-side={side} aria-hidden={!valid}>
      {valid && (
        <>
          <div className={styles.pageHeader} style={{ top: dims.padTop * 0.4, paddingInline: dims.padX }}>
            {runningHead}
          </div>
          <div className={styles.flowWrap} style={wrapStyle}>
            <div
              className={`${styles.content} ${styles.flow}`}
              style={flowStyle}
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
          </div>
          <div className={styles.pageNumber} style={{ bottom: dims.padBottom * 0.38, paddingInline: dims.padX }}>
            {pageIndex + 1}
          </div>
        </>
      )}
    </div>
  );
});

/** 单页 curl 的叶片背面：真实纸张的空白反面（不重复印刷内容）。 */
function BlankLeafFace({ dims }: { dims: Dims }) {
  return <div className={styles.blankFace} style={{ width: dims.pageW, height: dims.pageH }} />;
}

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
  const [headingPages, setHeadingPages] = useState<Array<{ id: string; text: string; page: number }>>([]);
  const [positionReady, setPositionReady] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaTimedOut, setMediaTimedOut] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [chromeHovered, setChromeHovered] = useState(false);
  const [skeletonGone, setSkeletonGone] = useState(false);

  const measureRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const leafRef = useRef<HTMLDivElement>(null);
  const leafShadeFrontRef = useRef<HTMLDivElement>(null);
  const leafShadeBackRef = useRef<HTMLDivElement>(null);
  const leafSheenRef = useRef<HTMLDivElement>(null);
  const castShadowRef = useRef<HTMLDivElement>(null);
  const slideTrackRef = useRef<HTMLDivElement>(null);
  const prevColsRef = useRef<1 | 2 | null>(null);
  const pointerRef = useRef<PointerState | null>(null);
  const suppressClickRef = useRef(false);
  const jobRef = useRef<FlipJob | null>(null);
  const rafRef = useRef<number>(0);
  const cursorRef = useRef(0);
  // 书签复位用：原始 storedPage、本次恢复是否发生在临时分页上、用户是否已主动翻页。
  const storedPageRef = useRef<number | null>(null);
  const provisionalRestoreRef = useRef(false);
  const userMovedRef = useRef(false);
  const wheelAccRef = useRef(0);
  const zoomAccRef = useRef(0);
  const wheelResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotionRef = useRef(false);

  // 供引擎回调读取的最新渲染快照。
  const latest = useRef({ dims, maxCursor: 0, turnMode: 'curl' as ReaderPageTurn });

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

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      reducedMotionRef.current = query.matches;
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
  }, []);

  useEffect(() => {
    // 指针停在浮层工具条上时不自动隐藏，否则按钮会在光标下消失。
    if (tocOpen || settingsOpen || chromeHovered || !chromeVisible) return;
    const timer = window.setTimeout(() => setChromeVisible(false), 2400);
    return () => window.clearTimeout(timer);
  }, [chromeHovered, chromeVisible, settingsOpen, tocOpen, cursor]);

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

  // 衬线（默认）字族按需加载 webfont；字形就绪后重新分页。
  useEffect(() => {
    if (preferences.fontFamily === 'serif') ensureReaderSerifFont();
  }, [preferences.fontFamily]);

  const updatePreferences = useCallback((patch: Partial<ReaderPreferences>) => {
    setPreferences((prev) => clampReaderPreferences({ ...prev, ...patch }));
  }, []);

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_READER_PREFERENCES);
  }, []);

  /** 用户主动翻页/跳页的唯一入口：打上「用户已移动」标记，之后的位置以用户为准。 */
  const commitCursor = useCallback((next: number) => {
    userMovedRef.current = true;
    cursorRef.current = next;
    setCursor(next);
  }, []);

  // ----- 翻页引擎（rAF + 临界阻尼弹簧，逐帧直写 DOM） -----

  const applyFlipFrame = useCallback((job: FlipJob) => {
    const d = latest.current.dims;
    if (!d) return;
    const travel = flipTravel(job.dir, job.p);
    const wave = Math.sin(travel * Math.PI);

    if (job.mode === 'slide') {
      const track = slideTrackRef.current;
      if (track) {
        track.style.transform = `translate3d(${-travel * d.pageW}px, 0, 0)`;
      }
      return;
    }

    const leaf = leafRef.current;
    if (leaf) {
      const angle = -180 * travel;
      const tilt = (job.dir === 'next' ? -0.8 : 0.8) * wave;
      const skew = (job.dir === 'next' ? 1 : -1) * wave * 3.2;
      leaf.style.transform = `translateZ(2.5px) rotateY(${angle}deg) rotateZ(${tilt}deg) skewY(${skew}deg)`;
    }
    if (leafShadeFrontRef.current) {
      leafShadeFrontRef.current.style.opacity = String(wave * 0.45);
    }
    if (leafShadeBackRef.current) {
      leafShadeBackRef.current.style.opacity = String(wave * 0.36);
    }
    if (leafSheenRef.current) {
      leafSheenRef.current.style.opacity = String(wave * 0.55);
      leafSheenRef.current.style.transform = `translate3d(${(1 - travel) * d.pageW * 0.86}px, 0, 0)`;
    }
    const cast = castShadowRef.current;
    if (cast) {
      const drift = Math.cos(travel * Math.PI) * d.pageW * 0.3;
      cast.style.opacity = String(wave * 0.5);
      cast.style.transform = `translate3d(${drift}px, 0, 0) scaleX(${0.22 + wave * 0.78})`;
    }
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  /** 结束当前任务：按 target/进度裁决提交或取消，同一批 React 提交里换底页避免闪帧。 */
  const settleJob = useCallback((job: FlipJob) => {
    stopRaf();
    jobRef.current = null;
    const commit = job.target === 1 || (job.target === TARGET_UNDECIDED && job.p >= 0.5);
    if (commit) commitCursor(job.to);
    setFlip(null);
  }, [commitCursor, stopRaf]);

  /** 立即完结正在进行的任务（快速连翻/外部跳页时调用）。 */
  const finishJobInstantly = useCallback(() => {
    const job = jobRef.current;
    if (!job) return;
    settleJob(job);
  }, [settleJob]);

  const runLoop = useCallback(() => {
    stopRaf();
    const tick = (t: number) => {
      const job = jobRef.current;
      if (!job) {
        rafRef.current = 0;
        return;
      }
      // 拖拽期间叶片完全跟手，弹簧停表。
      if (job.dragging) {
        rafRef.current = 0;
        job.lastT = 0;
        return;
      }
      const dt = job.lastT ? t - job.lastT : 16;
      job.lastT = t;
      const target = job.target === TARGET_UNDECIDED ? 1 : job.target;
      const next = stepFlipSpring({ p: job.p, v: job.v }, target, dt);
      job.p = next.p;
      job.v = next.v;
      applyFlipFrame(job);

      if (isFlipSettled(next, target)) {
        if (job.peeking && target === PEEK_PROGRESS) {
          // 掀角静置：叶片保持微翘，停表等待后续交互。
          rafRef.current = 0;
          job.lastT = 0;
          return;
        }
        settleJob(job);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [applyFlipFrame, settleJob, stopRaf]);

  /**
   * 启动一次翻页任务。dragging=true 时叶片跟随指针；peek=true 时仅掀起页角。
   * 已有任务先立即完结（支持快速连翻与方向反打）。
   */
  const beginFlip = useCallback(
    (dir: 'next' | 'prev', opts?: { dragging?: boolean; peek?: boolean }): FlipJob | null => {
      const { turnMode, maxCursor } = latest.current;
      const existing = jobRef.current;

      if (existing) {
        // 掀角中点击同向 → 顺势翻完；转拖拽时必须停掉在跑的弹簧，否则它会抢走叶片控制权。
        if (existing.peeking && existing.dir === dir && !opts?.peek) {
          existing.peeking = false;
          existing.dragging = Boolean(opts?.dragging);
          existing.target = opts?.dragging ? TARGET_UNDECIDED : 1;
          existing.dragBaseP = existing.p;
          if (existing.dragging) stopRaf();
          else runLoop();
          return existing;
        }
        finishJobInstantly();
      }

      const from = cursorRef.current;
      if (dir === 'next' && from >= maxCursor) return null;
      if (dir === 'prev' && from <= 0) return null;
      const to = dir === 'next' ? from + 1 : from - 1;

      if (reducedMotionRef.current || turnMode === 'instant') {
        if (!opts?.peek) commitCursor(to);
        return null;
      }

      const job: FlipJob = {
        dir,
        from,
        to,
        mode: turnMode === 'slide' ? 'slide' : 'curl',
        p: 0,
        v: 0,
        target: opts?.peek ? PEEK_PROGRESS : opts?.dragging ? TARGET_UNDECIDED : 1,
        dragging: Boolean(opts?.dragging),
        peeking: Boolean(opts?.peek),
        dragBaseP: 0,
        samples: [],
        lastT: 0,
      };
      jobRef.current = job;
      setFlip({ dir, from, to, mode: job.mode });
      if (!job.dragging) runLoop();
      return job;
    },
    [commitCursor, finishJobInstantly, runLoop],
  );

  // 叶片挂载后写入首帧（React 提交在前，DOM ref 就位在后）。
  useLayoutEffect(() => {
    const job = jobRef.current;
    if (flip && job) applyFlipFrame(job);
  }, [flip, applyFlipFrame]);

  const goNext = useCallback(() => {
    beginFlip('next');
  }, [beginFlip]);

  const goPrev = useCallback(() => {
    beginFlip('prev');
  }, [beginFlip]);

  const setPeek = useCallback(
    (dir: 'next' | 'prev', on: boolean) => {
      if (typeof window === 'undefined') return;
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      const job = jobRef.current;
      if (on) {
        if (job || latest.current.turnMode !== 'curl' || reducedMotionRef.current) return;
        beginFlip(dir, { peek: true });
      } else if (job?.peeking && !job.dragging && job.target === PEEK_PROGRESS) {
        job.target = 0;
        runLoop();
      }
    },
    [beginFlip, runLoop],
  );

  // ----- 响应式尺寸 -----
  useLayoutEffect(() => {
    const update = () => {
      finishJobInstantly();
      const next = computeReaderDims({ width: window.innerWidth, height: window.innerHeight }, preferences.zoom);
      // 尺寸未变时复用旧对象：dims 身份是图片测量 effect 的依赖，抖动会导致 mediaReady 无谓回落。
      setDims((prev) => (prev && sameReaderDims(prev, next) ? prev : next));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [finishJobInstantly, preferences.zoom]);

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
      const next = c === clamped ? c : clamped;
      cursorRef.current = next;
      return next;
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

  // webfont 字形就绪会改变行宽度量，需重新分页。
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts?.addEventListener) return;
    const onLoaded = () => measurePages();
    fonts.addEventListener('loadingdone', onLoaded);
    return () => fonts.removeEventListener('loadingdone', onLoaded);
  }, [measurePages]);

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
    setSkeletonGone(false);
    setHeadingPages([]);
    storedPageRef.current = null;
    provisionalRestoreRef.current = false;
    userMovedRef.current = false;
  }, [book.slug]);

  // 悬挂的图片不应把读者锁在骨架书上：2.5s 后强制放行（图片就位后仍会重排分页）。
  useEffect(() => {
    setMediaTimedOut(false);
    if (!dims) return;
    const timer = window.setTimeout(() => setMediaTimedOut(true), 2500);
    return () => window.clearTimeout(timer);
  }, [dims, book.slug]);

  useEffect(() => {
    if (!dims || positionReady || (!mediaReady && !mediaTimedOut)) return;
    const storedPage = readStoredPage(book.slug);
    storedPageRef.current = storedPage;
    // 超时放行时分页仍是「图片未占位」的临时值，此次恢复只是尽力而为，待图片就绪后再按最终分页复位。
    provisionalRestoreRef.current = !mediaReady;
    if (storedPage !== null) {
      const restored = absolutePageToCursor(storedPage, dims.cols, totalPages);
      cursorRef.current = restored;
      setCursor(restored);
    }
    const frame = window.requestAnimationFrame(() => setPositionReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [book.slug, dims, mediaReady, mediaTimedOut, positionReady, totalPages]);

  // 图片就绪后总页数才是最终值：把超时期间被 clamp 掉的书签按真实分页复位（用户已翻页则尊重用户）。
  useEffect(() => {
    if (!dims || !mediaReady || !positionReady) return;
    if (!provisionalRestoreRef.current) return;
    provisionalRestoreRef.current = false;
    const storedPage = storedPageRef.current;
    if (storedPage === null || userMovedRef.current) return;
    const restored = absolutePageToCursor(storedPage, dims.cols, totalPages);
    cursorRef.current = restored;
    setCursor(restored);
  }, [dims, mediaReady, positionReady, totalPages]);

  // 骨架书在实书升起后再退场，避免生硬切换。
  useEffect(() => {
    if (!positionReady || skeletonGone) return;
    const timer = window.setTimeout(() => setSkeletonGone(true), 480);
    return () => window.clearTimeout(timer);
  }, [positionReady, skeletonGone]);

  useEffect(() => {
    if (!dims || !positionReady) return;
    // 分页仍是超时放行的临时值且用户尚未翻页时不落盘，否则会用被 clamp 的页码覆盖真实书签。
    if (!mediaReady && !userMovedRef.current) return;
    const page = cursorToAbsolutePage(cursor, dims.cols);
    try {
      window.localStorage.setItem(
        getPositionKey(book.slug),
        JSON.stringify({ page, totalPages, updatedAt: Date.now() }),
      );
    } catch {
      // localStorage 不可用时跳过持久化。
    }
  }, [book.slug, cursor, dims, mediaReady, positionReady, totalPages]);

  const cols = dims?.cols ?? 2;
  const unitCount = cols === 2 ? Math.ceil(totalPages / 2) : totalPages; // 翻页单元总数
  const maxCursor = Math.max(0, unitCount - 1);
  const turnMode = resolveReaderPageTurn(preferences.pageTurn, cols);

  latest.current = { dims, maxCursor, turnMode };
  cursorRef.current = cursor;

  // ----- 指针交互：拖拽跟手翻页 / 点击半区 / 中央呼出 chrome -----

  const handleBookPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (tocOpen || settingsOpen) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 已有活跃指针（如拖拽中落下第二根手指）时忽略新指针，避免抢走 pointerRef 令拖拽悬死。
    if (pointerRef.current) return;
    // 注意：此处不 setPointerCapture —— 提前捕获会把后续 click 重定向到书容器，
    // 导致翻页热区按钮与正文链接永远收不到点击。捕获推迟到拖拽确立时。
    pointerRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startedOnInteractive: isReaderContentInteractive(e.target),
      handled: false,
    };
  }, [settingsOpen, tocOpen]);

  const handleBookPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== e.pointerId) return;
    // 鼠标/笔的按键已松开却仍有活跃记录 = 在书外松手留下的残留（窗口失焦丢事件同理）。
    // 不清掉的话，悬停扫过书面会用陈旧 startX 判定越阈，凭空掀起叶片跟着光标走。
    if (e.pointerType !== 'touch' && e.buttons === 0) {
      pointerRef.current = null;
      return;
    }
    const d = latest.current.dims;
    if (!d) return;
    const dx = e.clientX - pointer.startX;
    const dy = e.clientY - pointer.startY;
    const job = jobRef.current;

    // 已进入拖拽：叶片/滑轨逐帧跟随指针。
    if (pointer.handled && job?.dragging) {
      const dragged = dragToProgress(dx, d.pageW, job.dir);
      job.p = Math.min(1, Math.max(0, job.dragBaseP + dragged));
      job.samples.push({ t: e.timeStamp, p: job.p });
      if (job.samples.length > 6) job.samples.shift();
      applyFlipFrame(job);
      return;
    }
    if (pointer.handled) return;

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    // 从链接/按钮起手保留较大容差，手滑 12px 不应吞掉点击。
    const slop = pointer.startedOnInteractive ? 42 : 12;
    if (absX < slop || absX < absY * 1.2) return;

    const dir: 'next' | 'prev' = dx < 0 ? 'next' : 'prev';
    pointer.handled = true;
    suppressClickRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setChromeVisible(false);

    if (reducedMotionRef.current || latest.current.turnMode === 'instant') {
      // 无动画路径退化为一次性滑动手势。
      if (dir === 'next') goNext();
      else goPrev();
      return;
    }

    const started = beginFlip(dir, { dragging: true });
    if (started) {
      started.p = Math.min(1, Math.max(0, started.dragBaseP + dragToProgress(dx, d.pageW, dir)));
      started.samples.push({ t: e.timeStamp, p: started.p });
      applyFlipFrame(started);
    }
  }, [applyFlipFrame, beginFlip, goNext, goPrev]);

  const releaseDrag = useCallback((timeStamp: number) => {
    const job = jobRef.current;
    if (!job?.dragging) return;
    job.dragging = false;
    // 用最近 ~90ms 的采样估计松手速度，快速甩动小位移也能翻过去。
    // 最后一次采样距松手超过 120ms 说明手指已停驻，按静止（v=0）裁决，不吃几秒前的甩动速度。
    const samples = job.samples;
    let v = 0;
    if (samples.length >= 2) {
      const last = samples[samples.length - 1];
      if (timeStamp - last.t <= 120) {
        let first = samples[0];
        for (const s of samples) {
          if (timeStamp - s.t <= 90) {
            first = s;
            break;
          }
        }
        const dt = Math.max(last.t - first.t, 1) / 1000;
        v = (last.p - first.p) / dt;
      }
    }
    job.v = v;
    job.target = resolveFlipRelease(job.p, v);
    job.lastT = 0;
    runLoop();
  }, [runLoop]);

  const handleBookPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== e.pointerId) return;

    const dx = e.clientX - pointer.startX;
    const dy = e.clientY - pointer.startY;
    const wasHandled = pointer.handled;
    const startedOnInteractive = pointer.startedOnInteractive;
    pointerRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (wasHandled) {
      releaseDrag(e.timeStamp);
    } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      if (startedOnInteractive) return;
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
  }, [goNext, goPrev, releaseDrag]);

  const handleBookClickCapture = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClickRef.current = false;
  }, []);

  /**
   * 窗口级兜底：拖拽未确立时不持有指针捕获，若在书容器外松手，元素级 pointerup 永不触发，
   * pointerRef 会永久残留（笔每次接触换新 pointerId，pointerdown 的活跃指针守卫会因此丢弃后续全部输入）。
   * 元素级 handler 已接管时这里读到的 pointerRef 已为 null，不会重复结算。
   */
  useEffect(() => {
    const onWindowPointerEnd = (e: PointerEvent) => {
      const pointer = pointerRef.current;
      if (!pointer || pointer.id !== e.pointerId) return;
      pointerRef.current = null;
      if (pointer.handled) releaseDrag(e.timeStamp);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);
    return () => {
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
    };
  }, [releaseDrag]);

  const handleBookPointerCancel = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (pointer?.id === e.pointerId) {
      pointerRef.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      if (pointer.handled) releaseDrag(e.timeStamp);
    }
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, [releaseDrag]);

  const handleHitZoneClick = useCallback(
    (action: () => void, enabled: boolean) => (e: ReactMouseEvent<HTMLButtonElement>) => {
      if (suppressClickRef.current) {
        e.preventDefault();
        e.stopPropagation();
        suppressClickRef.current = false;
        return;
      }
      if (!enabled) return;
      action();
    },
    [],
  );

  const jumpTo = useCallback(
    (unit: number) => {
      finishJobInstantly();
      revealChrome();
      commitCursor(Math.max(0, Math.min(unit, latest.current.maxCursor)));
    },
    [commitCursor, finishJobInstantly, revealChrome],
  );

  const close = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push('/');
  }, [router]);

  const adjustZoom = useCallback((delta: number) => {
    setPreferences((prev) => clampReaderPreferences({ ...prev, zoom: prev.zoom + delta }));
  }, []);

  // 键盘导航：翻页 / 首末页 / 版面缩放。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false);
        else if (tocOpen) setTocOpen(false);
        else close();
      } else if (e.ctrlKey || e.metaKey || e.altKey) {
        // 带修饰键的组合（Alt+← 后退、Ctrl+0 浏览器缩放等）交还给浏览器。
        return;
      } else if (settingsOpen || tocOpen || isInteractiveKeyTarget(e.target)) {
        return;
      } else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'Home') {
        jumpTo(0);
      } else if (e.key === 'End') {
        jumpTo(latest.current.maxCursor);
      } else if (e.key === '+' || e.key === '=') {
        adjustZoom(READER_ZOOM_STEP);
      } else if (e.key === '-') {
        adjustZoom(-READER_ZOOM_STEP);
      } else if (e.key === '0') {
        adjustZoom(DEFAULT_READER_PREFERENCES.zoom - preferences.zoom);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adjustZoom, close, goNext, goPrev, jumpTo, preferences.zoom, settingsOpen, tocOpen]);

  // 滚轮：Ctrl/⌘ + 滚轮缩放版面；普通滚轮/触控板横扫累计后翻页。
  const hasStage = dims !== null;
  useEffect(() => {
    if (!hasStage) return;
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      // deltaMode 归一：Firefox 鼠标滚轮按「行」（≈3/格）上报，不换算永远到不了阈值。
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 320 : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // 触控板捏合是高频小增量事件流：按位移比例累积，攒满一档再步进，
        // 否则每个事件各走一整档 5%，一次捏合直接打满 70%/140%。
        zoomAccRef.current += -e.deltaY * unit * 0.0009;
        while (Math.abs(zoomAccRef.current) >= READER_ZOOM_STEP) {
          const dir = Math.sign(zoomAccRef.current);
          adjustZoom(dir * READER_ZOOM_STEP);
          zoomAccRef.current -= dir * READER_ZOOM_STEP;
        }
        return;
      }
      e.preventDefault();
      // 静置的掀角任务会长期占着 jobRef（光标停在左右命中区即触发，两区合计占书宽 76%），
      // 一刀切拦截会让滚轮在这些区域被 preventDefault 吞掉且毫无反应；beginFlip 能正确接管在场 peek。
      const job = jobRef.current;
      if (job && !(job.peeking && !job.dragging)) return;
      const dominant = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
      wheelAccRef.current += dominant;
      if (wheelResetTimer.current) clearTimeout(wheelResetTimer.current);
      wheelResetTimer.current = setTimeout(() => {
        wheelAccRef.current = 0;
      }, 180);
      if (wheelAccRef.current > WHEEL_FLIP_THRESHOLD) {
        wheelAccRef.current = 0;
        goNext();
      } else if (wheelAccRef.current < -WHEEL_FLIP_THRESHOLD) {
        wheelAccRef.current = 0;
        goPrev();
      }
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [adjustZoom, goNext, goPrev, hasStage]);

  // 桌面：鼠标靠近上下边缘时呼出 chrome。
  useEffect(() => {
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (e.clientY < 84 || e.clientY > window.innerHeight - 96) revealChrome();
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [revealChrome]);

  useEffect(() => () => {
    stopRaf();
    if (wheelResetTimer.current) clearTimeout(wheelResetTimer.current);
  }, [stopRaf]);

  // ----- 章节页面映射：目录页码 / 运行头 / 进度刻度共用 -----
  useEffect(() => {
    if (!dims || !measureRef.current || !book.toc?.length) {
      setHeadingPages([]);
      return;
    }
    // 图片未就绪时用超时兜底出一版映射（悬挂图片否则会让目录页码/章节刻度/运行头整场缺席）；
    // mediaReady 短暂回落（resize/缩放重跑图片 effect）时保留上一版，避免这些元素闪断。
    if (!mediaReady && !mediaTimedOut) return;
    const measureRect = measureRef.current.getBoundingClientRect();
    const mapped: Array<{ id: string; text: string; page: number }> = [];
    for (const h of book.toc) {
      const target = measureRef.current.querySelector<HTMLElement>(`[id="${CSS.escape(h.id)}"]`);
      if (!target) continue;
      const targetRect = target.getBoundingClientRect();
      mapped.push({
        id: h.id,
        text: h.text,
        page: horizontalOffsetToPage(targetRect.left, measureRect.left, dims.contentW),
      });
    }
    setHeadingPages(mapped);
  }, [
    book.toc,
    dims,
    mediaReady,
    mediaTimedOut,
    totalPages,
    preferences.fontSize,
    preferences.lineHeight,
    preferences.fontFamily,
    preferences.paragraphMode,
  ]);

  const chapterForPage = useCallback(
    (page: number): string | null => {
      let text: string | null = null;
      for (const h of headingPages) {
        if (h.page <= page) text = h.text;
        else break;
      }
      return text;
    },
    [headingPages],
  );

  const lastVisiblePage = Math.min(cursorToAbsolutePage(cursor, cols) + cols - 1, Math.max(totalPages - 1, 0));
  const activeHeadingId = useMemo(() => {
    let active: string | null = null;
    for (const h of headingPages) {
      if (h.page <= lastVisiblePage) active = h.id;
      else break;
    }
    return active;
  }, [headingPages, lastVisiblePage]);

  const jumpToHeading = useCallback(
    (id: string) => {
      let page = headingPages.find((h) => h.id === id)?.page ?? null;
      if (page === null && dims && measureRef.current) {
        // 图片未就绪时映射表尚空：退回点击时现场测量锚点，目录不因慢图而失效。
        const target = measureRef.current.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
        if (target) {
          const measureRect = measureRef.current.getBoundingClientRect();
          page = horizontalOffsetToPage(target.getBoundingClientRect().left, measureRect.left, dims.contentW);
        }
      }
      if (page === null) return;
      jumpTo(cols === 2 ? Math.floor(page / 2) : page);
      setTocOpen(false);
    },
    [cols, dims, headingPages, jumpTo],
  );

  // 给定页索引渲染一个完整页面（含运行头/页码/正文窗口）。
  const renderPage = (pageIndex: number, side: 'left' | 'right' | 'single') => {
    if (!dims) return null;
    const runningHead = side === 'left'
      ? book.title
      : chapterForPage(pageIndex) ?? book.title;
    return (
      <PageSurface
        pageIndex={pageIndex}
        side={side}
        dims={dims}
        totalPages={totalPages}
        runningHead={runningHead}
        contentHtml={book.contentHtml}
      />
    );
  };

  /**
   * 底层页与叶片的页索引。物理模型：
   * - next：右页 (2f+1) 掀起，背面是 (2t)，落下时盖住左页；右侧露出 (2t+1)。
   * - prev：左页折叠叶片（正面 2t+1 / 背面 2f）从书脊落回右侧；右页 (2f+1) 保持可见直到被盖住。
   * - 单页 curl：叶片背面是空白纸背，prev 时底页保持 from 直到叶片落定。
   */
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
      return {
        baseLeft: 2 * flip.to,
        baseRight: 2 * flip.from + 1,
        leaf: { front: 2 * flip.to + 1, back: 2 * flip.from },
      };
    }
    // 单页模式
    const p = cursor;
    if (!flip) return { single: p, leaf: null as null | { front: number; back: number } };
    if (flip.dir === 'next') return { single: flip.to, leaf: { front: flip.from, back: -1 } };
    return { single: flip.from, leaf: { front: flip.to, back: -1 } };
  }, [cols, cursor, flip]);

  const fontFamilyValue = useMemo(() => {
    if (preferences.fontFamily === 'sans') {
      return "'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Microsoft YaHei', 'Noto Sans SC', 'Segoe UI', Arial, sans-serif";
    }
    if (preferences.fontFamily === 'kai') {
      return "'Kaiti SC', 'STKaiti', KaiTi, 'AR PL UKai CN', 'TW-Kai', 'Noto Serif SC', serif";
    }
    if (preferences.fontFamily === 'system') {
      return "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif";
    }
    return "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', STSong, SimSun, Georgia, 'Times New Roman', serif";
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
          '--reader-muted': `color-mix(in srgb, ${preferences.customInk} 56%, ${preferences.customPage})`,
          '--reader-shadow': 'rgba(15, 23, 42, 0.24)',
          '--reader-cover': preferences.customInk,
          '--reader-gutter': 'rgba(15, 23, 42, 0.2)',
          '--reader-sheen': 'rgba(255, 255, 255, 0.4)',
        }
        : {}),
    } as CSSProperties;
  }, [fontFamilyValue, preferences, readerSkin]);

  const renderSingleStage = () => {
    if (!dims) return null;
    if (flip?.mode === 'slide') {
      const pages = flip.dir === 'next' ? [flip.from, flip.to] : [flip.to, flip.from];
      return (
        <div className={styles.singleSlider} style={{ width: dims.pageW, height: dims.pageH }}>
          <div
            ref={slideTrackRef}
            className={styles.singleTrack}
            style={{
              width: dims.pageW * 2,
              height: dims.pageH,
              transform: `translate3d(${flip.dir === 'next' ? 0 : -dims.pageW}px, 0, 0)`,
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

  const firstVisiblePage = Math.min(cursorToAbsolutePage(cursor, cols) + 1, totalPages);
  const lastVisibleLabel = Math.min(cursorToAbsolutePage(cursor, cols) + cols, totalPages);
  const counter = cols === 2 && lastVisibleLabel > firstVisiblePage
    ? `${firstVisiblePage}–${lastVisibleLabel} / ${totalPages}`
    : `${firstVisiblePage} / ${totalPages}`;
  const percent = totalPages > 0 ? Math.round((lastVisibleLabel / totalPages) * 100) : 0;

  // 书口厚度：读过的页在左侧堆积，剩余的页在右侧变薄。
  const progressFrac = maxCursor === 0 ? 1 : cursor / maxCursor;
  const edgeLeftW = Math.round((2 + progressFrac * 11) * 10) / 10;
  const edgeRightW = Math.round((2 + (1 - progressFrac) * 11) * 10) / 10;

  const leafLeft = cols === 2 ? dims.pageW : 0;
  const chromeIsVisible = chromeVisible || tocOpen || settingsOpen;
  const canPrev = cursor > 0;
  const canNext = cursor < maxCursor;
  const tickUnits = headingPages.length > 1 && maxCursor > 3
    ? [...new Set(headingPages.map((h) => (cols === 2 ? Math.floor(h.page / 2) : h.page)))]
      .filter((u) => u > 0 && u < maxCursor)
      .slice(0, 60)
    : [];

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
      <div
        className={styles.topbar}
        onPointerDown={revealChrome}
        onPointerEnter={() => setChromeHovered(true)}
        onPointerLeave={() => setChromeHovered(false)}
      >
        <button className={styles.iconBtn} onClick={close} aria-label="退出阅读">
          <X size={17} />
          <span>退出</span>
        </button>
        <div className={styles.title}>
          <span className={styles.titleMain}>{book.title}</span>
          {book.sourceRef ? <span className={styles.titleRef}>{book.sourceRef}</span> : null}
        </div>
        <div className={styles.topbarActions}>
          <button
            className={styles.iconBtn}
            data-active={tocOpen || undefined}
            onClick={() => {
              setChromeVisible(true);
              setSettingsOpen(false);
              setTocOpen((v) => !v);
            }}
            aria-label="目录"
          >
            <List size={17} />
            <span>目录</span>
          </button>
          <button
            className={styles.iconBtn}
            data-active={settingsOpen || undefined}
            onClick={() => {
              setChromeVisible(true);
              setTocOpen(false);
              setSettingsOpen((v) => !v);
            }}
            aria-label="阅读设置"
          >
            <Settings size={17} />
            <span>设置</span>
          </button>
        </div>
      </div>

      {/* 书台 */}
      <div className={styles.stage} ref={stageRef}>
        {/* 骨架书：分页与定位就绪前占位（禁 spinner，同构形状 + shimmer） */}
        {!skeletonGone && (
          <div
            className={styles.skeletonBook}
            data-ready={positionReady ? 'true' : 'false'}
            style={{ width: dims.pageW * cols, height: dims.pageH }}
            aria-hidden
          >
            {Array.from({ length: cols }, (_, i) => (
              <div key={i} className={styles.skeletonPage} style={{ padding: `${dims.padTop}px ${dims.padX}px` }}>
                {[0.92, 1, 0.97, 1, 0.88, 1, 0.95, 0.6].map((w, j) => (
                  <span key={j} className={styles.skeletonLine} style={{ width: `${w * 100}%` }} />
                ))}
              </div>
            ))}
          </div>
        )}

        <div
          className={`${styles.book} ${cols === 1 ? styles.bookSingle : styles.bookSpread} ${positionReady ? styles.bookIn : ''}`}
          style={{ width: dims.pageW * cols, height: dims.pageH }}
          data-turn-mode={turnMode}
          onPointerDown={handleBookPointerDown}
          onPointerMove={handleBookPointerMove}
          onPointerUp={handleBookPointerUp}
          onPointerCancel={handleBookPointerCancel}
          onClickCapture={handleBookClickCapture}
        >
          {/* 书口：两侧纸叠厚度随阅读进度流动 */}
          {cols === 2 && (
            <>
              <div className={styles.edgeStack} data-side="left" style={{ width: edgeLeftW }} aria-hidden />
              <div className={styles.edgeStack} data-side="right" style={{ width: edgeRightW }} aria-hidden />
            </>
          )}

          {cols === 2 ? (
            <>
              {renderPage(layout.baseLeft!, 'left')}
              {renderPage(layout.baseRight!, 'right')}
            </>
          ) : (
            renderSingleStage()
          )}

          {/* 叶片扫过底页时的投影 */}
          {flip?.mode === 'curl' && (
            <div
              ref={castShadowRef}
              className={styles.castShadow}
              data-cols={cols}
              aria-hidden
            />
          )}

          {/* 翻动叶片 */}
          {flip?.mode === 'curl' && layout.leaf && (
            <div
              ref={leafRef}
              className={styles.leaf}
              style={{ left: leafLeft, width: dims.pageW, height: dims.pageH }}
            >
              <div className={styles.leafFace}>
                {renderPage(layout.leaf.front, cols === 2 ? 'right' : 'single')}
                <div ref={leafSheenRef} className={styles.leafSheen} />
                <div ref={leafShadeFrontRef} className={styles.leafShade} />
              </div>
              <div className={`${styles.leafFace} ${styles.leafBack}`}>
                {cols === 2 ? renderPage(layout.leaf.back, 'left') : <BlankLeafFace dims={dims} />}
                <div ref={leafShadeBackRef} className={styles.leafShadeBack} />
              </div>
            </div>
          )}

          {/* 透明点击层：悬停掀角 + 点击翻页 */}
          <button
            aria-label="上一页"
            aria-disabled={!canPrev}
            onClick={handleHitZoneClick(goPrev, canPrev)}
            onPointerEnter={() => canPrev && setPeek('prev', true)}
            onPointerLeave={() => setPeek('prev', false)}
            tabIndex={-1}
            className={styles.hitZoneLeft}
            data-disabled={!canPrev || undefined}
          />
          <button
            aria-label="下一页"
            aria-disabled={!canNext}
            onClick={handleHitZoneClick(goNext, canNext)}
            onPointerEnter={() => canNext && setPeek('next', true)}
            onPointerLeave={() => setPeek('next', false)}
            tabIndex={-1}
            className={styles.hitZoneRight}
            data-disabled={!canNext || undefined}
          />
        </div>
      </div>

      {/* 底部控制条 */}
      <div
        className={styles.controls}
        onPointerDown={revealChrome}
        onPointerEnter={() => setChromeHovered(true)}
        onPointerLeave={() => setChromeHovered(false)}
      >
        <button className={styles.navBtn} onClick={goPrev} disabled={!canPrev} aria-label="上一页">
          <ChevronLeft size={18} />
        </button>
        <div className={styles.sliderWrap}>
          <input
            className={styles.slider}
            type="range"
            min={0}
            max={maxCursor}
            value={cursor}
            onChange={(e) => jumpTo(Number(e.target.value))}
            aria-label="阅读进度"
          />
          {tickUnits.length > 0 && (
            <div className={styles.sliderTicks} aria-hidden>
              {tickUnits.map((u) => (
                <span key={u} style={{ left: `${(u / maxCursor) * 100}%` }} />
              ))}
            </div>
          )}
        </div>
        <span className={styles.counter}>
          {counter}
          <em>{percent}%</em>
        </span>
        <button className={styles.navBtn} onClick={goNext} disabled={!canNext} aria-label="下一页">
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
              <p className={styles.tocEmpty}>本书暂无章节目录。</p>
            ) : (
              (book.toc ?? []).map((h, i) => {
                const entry = headingPages.find((m) => m.id === h.id);
                return (
                  <button
                    key={`${h.id}-${i}`}
                    className={`${styles.tocItem} ${activeHeadingId === h.id ? styles.tocItemActive : ''}`}
                    style={{ paddingLeft: 10 + (h.level - 1) * 14 }}
                    onClick={() => jumpToHeading(h.id)}
                  >
                    <span className={styles.tocText}>{h.text}</span>
                    {entry && <span className={styles.tocLeader} aria-hidden />}
                    {entry && <span className={styles.tocPage}>{entry.page + 1}</span>}
                  </button>
                );
              })
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

            {cols === 2 && (
              <section className={styles.settingSection}>
                <div className={styles.settingTitle}>
                  <ZoomIn size={15} />
                  <span>版面缩放</span>
                  <strong>{Math.round(preferences.zoom * 100)}%</strong>
                </div>
                <div className={styles.stepper}>
                  <button
                    type="button"
                    disabled={preferences.zoom <= READER_ZOOM_MIN}
                    onClick={() => adjustZoom(-READER_ZOOM_STEP)}
                    aria-label="缩小版面"
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    type="range"
                    min={READER_ZOOM_MIN * 100}
                    max={READER_ZOOM_MAX * 100}
                    step={READER_ZOOM_STEP * 100}
                    value={Math.round(preferences.zoom * 100)}
                    onChange={(e) => updatePreferences({ zoom: Number(e.target.value) / 100 })}
                    aria-label="调整版面缩放"
                  />
                  <button
                    type="button"
                    disabled={preferences.zoom >= READER_ZOOM_MAX}
                    onClick={() => adjustZoom(READER_ZOOM_STEP)}
                    aria-label="放大版面"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <p className={styles.settingHint}>Ctrl + 滚轮，或按 + / − / 0 快捷调整。</p>
              </section>
            )}

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
              <div className={`${styles.segmented} ${styles.segmentedQuad}`}>
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
