'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

const FLIP_MS = 720;

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
  const cols: 1 | 2 = vw < 760 ? 1 : 2;

  // 预留顶栏 / 底栏的垂直空间。
  const reservedV = 150;
  let pageH = Math.max(Math.min(vh - reservedV, 860), 320);
  // 书页纵横比（宽:高）约 0.66。
  let pageW = Math.round(pageH * 0.66);

  const maxBookW = vw - (cols === 2 ? 56 : 36);
  const bookW = cols * pageW;
  if (bookW > maxBookW) {
    pageW = Math.floor(maxBookW / cols);
    pageH = Math.round(pageW / 0.66);
  }

  const padX = Math.round(pageW * 0.11);
  const padTop = Math.round(pageH * 0.085);
  const padBottom = Math.round(pageH * 0.075);
  const contentW = pageW - padX * 2;
  const contentH = pageH - padTop - padBottom;

  return { pageW, pageH, padX, padTop, padBottom, contentW, contentH, cols };
}

export default function PageFlipBook({ book }: { book: ReadingBook }) {
  const router = useRouter();
  const theme = book.theme === 'sepia' || book.theme === 'night' ? book.theme : 'paper';

  const [dims, setDims] = useState<Dims | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  // cursor：double 模式下为 spread 索引，single 模式下为 page 索引。
  const [cursor, setCursor] = useState(0);
  const [flip, setFlip] = useState<{ dir: 'next' | 'prev'; angle: number } | null>(null);
  const [tocOpen, setTocOpen] = useState(false);

  const measureRef = useRef<HTMLDivElement>(null);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevColsRef = useRef<1 | 2 | null>(null);
  const animating = flip !== null;

  // 响应式尺寸。
  useLayoutEffect(() => {
    const update = () => setDims(computeDims());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const measurePages = useCallback(() => {
    if (!dims || !measureRef.current) return;
    const el = measureRef.current;
    const sw = el.scrollWidth;
    const pages = Math.max(1, Math.ceil(sw / dims.contentW));
    const prevCols = prevColsRef.current ?? dims.cols;
    setTotalPages(pages);
    setCursor((c) => {
      const absolutePage = prevCols === 2 ? c * 2 : c;
      const nextCursor = dims.cols === 2 ? Math.floor(absolutePage / 2) : absolutePage;
      const maxNext = Math.max(0, dims.cols === 2 ? Math.ceil(pages / 2) - 1 : pages - 1);
      return Math.min(nextCursor, maxNext);
    });
    prevColsRef.current = dims.cols;
  }, [dims, book.contentHtml]);

  // 测量总页数（隐藏容器分列布局后读取 scrollWidth）。
  useLayoutEffect(() => {
    measurePages();
  }, [measurePages]);

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

  const goNext = useCallback(() => {
    if (animating || cursor >= maxCursor) return;
    if (flipTimer.current) clearTimeout(flipTimer.current);
    setFlip({ dir: 'next', angle: 0 });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setFlip({ dir: 'next', angle: -180 })),
    );
    flipTimer.current = setTimeout(() => {
      setCursor((c) => Math.min(c + 1, maxCursor));
      setFlip(null);
    }, FLIP_MS);
  }, [animating, cursor, maxCursor]);

  const goPrev = useCallback(() => {
    if (animating || cursor <= 0) return;
    if (flipTimer.current) clearTimeout(flipTimer.current);
    setFlip({ dir: 'prev', angle: -180 });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setFlip({ dir: 'prev', angle: 0 })),
    );
    flipTimer.current = setTimeout(() => {
      setCursor((c) => Math.max(c - 1, 0));
      setFlip(null);
    }, FLIP_MS);
  }, [animating, cursor]);

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

  useEffect(() => () => { if (flipTimer.current) clearTimeout(flipTimer.current); }, []);

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

  const flowStyle = (pageIndex: number): React.CSSProperties => ({
    width: dims!.contentW,
    height: dims!.contentH,
    columnWidth: dims!.contentW,
    transform: `translateX(${-pageIndex * dims!.contentW}px)`,
  });

  const wrapStyle: React.CSSProperties = dims
    ? { left: dims.padX, top: dims.padTop, width: dims.contentW, height: dims.contentH }
    : {};

  // 给定页索引渲染一个完整页面（含页眉/页码/正文窗口）。
  const renderPage = (pageIndex: number, side: 'left' | 'right' | 'single') => {
    if (!dims) return null;
    const valid = pageIndex >= 0 && pageIndex < totalPages;
    const pageClass =
      side === 'left' ? styles.pageLeft : side === 'right' ? styles.pageRight : styles.pageSingle;
    return (
      <div className={`${styles.page} ${pageClass}`} style={{ width: dims.pageW, height: dims.pageH }}>
        {valid && (
          <>
            <div className={styles.pageHeader} style={{ top: dims.padTop * 0.42, paddingInline: dims.padX }}>
              {book.title}
            </div>
            <div className={styles.flowWrap} style={wrapStyle}>
              <div
                className={styles.content + ' ' + styles.flow}
                style={flowStyle(pageIndex)}
                dangerouslySetInnerHTML={{ __html: book.contentHtml }}
              />
            </div>
            <div className={styles.pageNumber} style={{ bottom: dims.padBottom * 0.4 }}>
              {pageIndex + 1}
            </div>
          </>
        )}
      </div>
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
        return { baseLeft: 2 * s, baseRight: 2 * s + 3, leaf: { front: 2 * s + 1, back: 2 * s + 2 } };
      }
      // prev：底层显示目标 spread s-1。
      return { baseLeft: 2 * (s - 1), baseRight: 2 * s - 1, leaf: { front: 2 * s - 1, back: 2 * s } };
    }
    // 单页模式
    const p = cursor;
    if (!flip) return { single: p, leaf: null as null | { front: number; back: number } };
    if (flip.dir === 'next') return { single: p + 1, leaf: { front: p, back: p + 1 } };
    return { single: p - 1, leaf: { front: p - 1, back: p } };
  }, [cols, cursor, flip]);

  if (!dims) {
    return <div className={styles.overlay} data-theme={theme} />;
  }

  const counter =
    cols === 2
      ? `${Math.min(cursor * 2 + 1, totalPages)}–${Math.min(cursor * 2 + 2, totalPages)} / ${totalPages}`
      : `${cursor + 1} / ${totalPages}`;

  // 叶片几何：双页时叶片位于右页位置、绕书脊（左缘）旋转；单页时占满整页、绕左缘旋转。
  const leafLeft = cols === 2 ? dims.pageW : 0;
  const leafTransition = flip ? `transform ${FLIP_MS}ms cubic-bezier(0.36, 0, 0.2, 1)` : 'none';

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
                transform: `rotateY(${flip.angle}deg)`,
                transition: leafTransition,
              }}
            >
              <div className={styles.leafFace}>
                {renderPage(layout.leaf.front, cols === 2 ? 'right' : 'single')}
                <div className={styles.leafShade} style={{ opacity: 1 + flip.angle / 180 }} />
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
            style={{ position: 'absolute', left: 0, top: 0, width: '38%', height: '100%', background: 'transparent', border: 'none', cursor: cursor > 0 ? 'w-resize' : 'default' }}
          />
          <button
            aria-label="下一页"
            onClick={goNext}
            disabled={cursor >= maxCursor || animating}
            tabIndex={-1}
            style={{ position: 'absolute', right: 0, top: 0, width: '38%', height: '100%', background: 'transparent', border: 'none', cursor: cursor < maxCursor ? 'e-resize' : 'default' }}
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
          value={cursor}
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
            style={{ position: 'absolute', inset: 0, zIndex: 49, background: 'rgba(0,0,0,0.25)' }}
            onClick={() => setTocOpen(false)}
          />
          <nav className={styles.toc}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: 14 }}>目录</strong>
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
