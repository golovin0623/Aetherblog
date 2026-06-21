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
} from 'react';
import { ChevronLeft, ChevronRight, List, X } from 'lucide-react';
import styles from './PageFlipBook.module.css';

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
const TURN_ANGLE = -158;
const TWO_PAGE_MIN_WIDTH = 340;

interface Dims {
  pageW: number;
  pageH: number;
  padX: number;
  padTop: number;
  padBottom: number;
  contentW: number;
  contentH: number;
  cols: 1 | 2;
}

function computeDims(): Dims {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cols: 1 | 2 = vw < TWO_PAGE_MIN_WIDTH ? 1 : 2;

  // 预留顶栏 / 底栏的垂直空间。
  const reservedV = vw < 760 ? 132 : 156;
  const maxPageH = Math.max(vh - reservedV, 240);
  let pageH = Math.max(Math.min(maxPageH, vw < 760 ? 520 : 860), 240);
  // 书页纵横比（宽:高）约 0.66。
  let pageW = Math.round(pageH * 0.66);

  const maxBookW = Math.max(vw - (cols === 2 ? 28 : 36), 240);
  const bookW = cols * pageW;
  if (bookW > maxBookW) {
    pageW = Math.floor(maxBookW / cols);
    pageH = Math.round(pageW / 0.66);
  }

  if (pageH > maxPageH) {
    pageH = maxPageH;
    pageW = Math.floor((pageH * 0.66));
  }

  const compactSpread = cols === 2 && vw < 760;
  const padX = Math.round(pageW * (compactSpread ? 0.085 : 0.11));
  const padTop = Math.round(pageH * (compactSpread ? 0.16 : 0.095));
  const padBottom = Math.round(pageH * 0.075);
  const contentW = pageW - padX * 2;
  const contentH = pageH - padTop - padBottom;

  return { pageW, pageH, padX, padTop, padBottom, contentW, contentH, cols };
}

interface FlipState {
  dir: 'next' | 'prev';
  angle: number;
  from: number;
  to: number;
}

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
  const theme = book.theme === 'sepia' || book.theme === 'night' ? book.theme : 'paper';

  const [dims, setDims] = useState<Dims | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  // cursor：double 模式下为 spread 索引，single 模式下为 page 索引。
  const [cursor, setCursor] = useState(0);
  const [flip, setFlip] = useState<FlipState | null>(null);
  const [tocOpen, setTocOpen] = useState(false);

  const measureRef = useRef<HTMLDivElement>(null);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flipFrames = useRef<number[]>([]);
  const prevColsRef = useRef<1 | 2 | null>(null);
  const animating = flip !== null;

  const clearFlipWork = useCallback(() => {
    if (flipTimer.current) {
      clearTimeout(flipTimer.current);
      flipTimer.current = null;
    }
    flipFrames.current.forEach((frame) => cancelAnimationFrame(frame));
    flipFrames.current = [];
  }, []);

  // 响应式尺寸。
  useLayoutEffect(() => {
    const update = () => {
      clearFlipWork();
      setFlip(null);
      setDims(computeDims());
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
      const absolutePage = prevCols === 2 ? c * 2 : c;
      const nextCursor = dims.cols === 2 ? Math.floor(absolutePage / 2) : absolutePage;
      const maxNext = Math.max(0, dims.cols === 2 ? Math.ceil(pages / 2) - 1 : pages - 1);
      const clamped = Math.min(nextCursor, maxNext);
      return c === clamped ? c : clamped;
    });
    prevColsRef.current = dims.cols;
  }, [dims]);

  // 测量总页数（隐藏容器分列布局后读取 scrollWidth）。
  useLayoutEffect(() => {
    measurePages();
  }, [measurePages, book.contentHtml]);

  // 图片解码后会改变多列 scrollWidth；监听隐藏测量流中的图片并重新分页。
  useEffect(() => {
    if (!dims || !measureRef.current) return;
    const el = measureRef.current;
    const images = Array.from(el.querySelectorAll('img'));
    if (images.length === 0) return;

    let raf = 0;
    const scheduleMeasure = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(measurePages);
      });
    };

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMeasure);

    images.forEach((img) => {
      img.addEventListener('load', scheduleMeasure);
      img.addEventListener('error', scheduleMeasure);
      observer?.observe(img);
      void img.decode?.().then(scheduleMeasure, scheduleMeasure);
      if (img.complete) scheduleMeasure();
    });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
      images.forEach((img) => {
        img.removeEventListener('load', scheduleMeasure);
        img.removeEventListener('error', scheduleMeasure);
      });
    };
  }, [dims, book.contentHtml, measurePages]);

  const cols = dims?.cols ?? 2;
  const unitCount = cols === 2 ? Math.ceil(totalPages / 2) : totalPages; // 翻页单元总数
  const maxCursor = Math.max(0, unitCount - 1);
  const visibleCursor = flip ? flip.to : cursor;

  const startFlip = useCallback((dir: 'next' | 'prev', from: number, to: number) => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    clearFlipWork();

    if (prefersReduced) {
      setFlip(null);
      setCursor(to);
      return;
    }

    const startAngle = dir === 'next' ? 0 : TURN_ANGLE;
    const endAngle = dir === 'next' ? TURN_ANGLE : 0;

    setFlip({ dir, angle: startAngle, from, to });
    const firstFrame = requestAnimationFrame(() => {
      const secondFrame = requestAnimationFrame(() => {
        if (flipTimer.current) {
          setFlip({ dir, angle: endAngle, from, to });
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
    }, FLIP_MS);
  }, [clearFlipWork]);

  const goNext = useCallback(() => {
    if (animating || cursor >= maxCursor) return;
    startFlip('next', cursor, Math.min(cursor + 1, maxCursor));
  }, [animating, cursor, maxCursor, startFlip]);

  const goPrev = useCallback(() => {
    if (animating || cursor <= 0) return;
    startFlip('prev', cursor, Math.max(cursor - 1, 0));
  }, [animating, cursor, startFlip]);

  const jumpTo = useCallback(
    (unit: number) => {
      if (animating) return;
      setCursor(Math.max(0, Math.min(unit, maxCursor)));
    },
    [animating, maxCursor],
  );

  const close = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push('/');
  }, [router]);

  // 键盘导航。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'Escape') { if (tocOpen) setTocOpen(false); else close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, close, tocOpen]);

  useEffect(() => () => clearFlipWork(), [clearFlipWork]);

  // 跳转到目录锚点所在页（通过测量容器中锚点元素的水平偏移定位）。
  const jumpToHeading = useCallback(
    (id: string) => {
      if (!dims || !measureRef.current) return;
      const target = measureRef.current.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      if (!target) return;
      const page = Math.floor(target.offsetLeft / dims.contentW);
      const unit = cols === 2 ? Math.floor(page / 2) : page;
      jumpTo(unit);
      setTocOpen(false);
    },
    [dims, cols, jumpTo],
  );

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

  if (!dims) {
    return <div className={styles.overlay} data-theme={theme} />;
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

  return (
    <div className={styles.overlay} data-theme={theme}>
      {/* 顶栏 */}
      <div className={styles.topbar}>
        <button className={styles.iconBtn} onClick={close} aria-label="退出阅读">
          <X size={18} />
          <span>退出</span>
        </button>
        <div className={styles.title}>
          {book.title}
          {book.sourceRef ? ` · ${book.sourceRef}` : ''}
        </div>
        <button className={styles.iconBtn} onClick={() => setTocOpen((v) => !v)} aria-label="目录">
          <List size={18} />
          <span>目录</span>
        </button>
      </div>

      {/* 书台 */}
      <div className={styles.stage}>
        <div className={styles.book} style={{ width: dims.pageW * cols, height: dims.pageH }}>
          {/* 点击左右半区翻页 */}
          {cols === 2 ? (
            <>
              {renderPage(layout.baseLeft!, 'left')}
              {renderPage(layout.baseRight!, 'right')}
            </>
          ) : (
            renderPage(layout.single!, 'single')
          )}

          {/* 翻动叶片 */}
          {flip && layout.leaf && (
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
            onClick={goPrev}
            disabled={cursor <= 0 || animating}
            tabIndex={-1}
            className={styles.hitZoneLeft}
          />
          <button
            aria-label="下一页"
            onClick={goNext}
            disabled={cursor >= maxCursor || animating}
            tabIndex={-1}
            className={styles.hitZoneRight}
          />
        </div>
      </div>

      {/* 底部控制条 */}
      <div className={styles.controls}>
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
                  className={styles.tocItem}
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
