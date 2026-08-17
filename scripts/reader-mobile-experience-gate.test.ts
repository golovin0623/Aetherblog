import { describe, expect, it } from 'vitest';
import {
  absolutePageToCursor,
  clampReaderPreferences,
  computeReaderDims,
  cursorToAbsolutePage,
  dragToProgress,
  flipTravel,
  horizontalOffsetToPage,
  isFlipSettled,
  resolveFlipRelease,
  resolveReaderPageTurn,
  resolveReaderSkin,
  stepFlipSpring,
} from '../apps/blog/app/reader/[slug]/readerLogic';

describe('reader mobile experience gate', () => {
  it('inherits the site dark theme when no explicit reader skin is chosen', () => {
    expect(resolveReaderSkin('paper', 'auto', 'dark')).toBe('night');
    expect(resolveReaderSkin(undefined, 'auto', 'light')).toBe('paper');
  });

  it('honors explicit book and user skin choices', () => {
    expect(resolveReaderSkin('sepia', 'auto', 'dark')).toBe('sepia');
    expect(resolveReaderSkin('paper', 'sage', 'dark')).toBe('sage');
    expect(resolveReaderSkin('night', 'paper', 'dark')).toBe('paper');
  });

  it('uses a full-height single page layout on mobile instead of a narrow book ratio', () => {
    const dims = computeReaderDims({ width: 390, height: 844 });

    expect(dims.cols).toBe(1);
    expect(dims.pageW).toBeGreaterThanOrEqual(390);
    expect(dims.pageH).toBeGreaterThanOrEqual(820);
    expect(dims.contentW).toBeGreaterThanOrEqual(300);
    expect(dims.contentH).toBeGreaterThanOrEqual(720);
    expect(dims.padTop).toBeLessThanOrEqual(64);
    expect(dims.padBottom).toBeLessThanOrEqual(58);
  });

  it('keeps a two-page book layout on desktop', () => {
    const dims = computeReaderDims({ width: 1440, height: 900 });

    expect(dims.cols).toBe(2);
    expect(dims.pageW * 2).toBeLessThanOrEqual(1392);
    // chrome 改为悬浮层后书页可用高度上限为 vh - 128。
    expect(dims.pageH).toBeLessThanOrEqual(772);
  });

  it('scales the desktop book with layout zoom while staying viewport-bound', () => {
    const base = computeReaderDims({ width: 1440, height: 900 }, 1);
    const shrunk = computeReaderDims({ width: 1440, height: 900 }, 0.7);
    const grown = computeReaderDims({ width: 2560, height: 1440 }, 1.4);
    const clamped = computeReaderDims({ width: 1440, height: 900 }, 1.4);

    expect(shrunk.pageH).toBeLessThan(base.pageH);
    expect(shrunk.pageH).toBe(602);
    expect(grown.pageH).toBe(1204);
    // 放大不允许溢出视口：仍受 vh - 128 约束。
    expect(clamped.pageH).toBeLessThanOrEqual(772);
    // 移动端保持满幅单页，缩放不参与。
    expect(computeReaderDims({ width: 390, height: 844 }, 0.7).pageW).toBe(390);
  });

  it('clamps layout zoom preference into 0.7–1.4 with 0.05 steps', () => {
    expect(clampReaderPreferences({ zoom: 3 }).zoom).toBe(1.4);
    expect(clampReaderPreferences({ zoom: 0.1 }).zoom).toBe(0.7);
    expect(clampReaderPreferences({ zoom: 1.03 }).zoom).toBe(1.05);
    expect(clampReaderPreferences({}).zoom).toBe(1);
  });

  it('clamps reader preferences into ergonomic ranges', () => {
    const prefs = clampReaderPreferences({
      fontSize: 40,
      lineHeight: 1,
      brightness: 15,
      fontFamily: 'unknown',
      paragraphMode: 'article',
      pageTurn: 'curl',
      skin: 'custom',
      customBg: '#fff',
      customPage: 'bad',
      customInk: '#123456',
    });

    expect(prefs.fontSize).toBe(24);
    expect(prefs.lineHeight).toBe(1.5);
    expect(prefs.brightness).toBe(70);
    expect(prefs.fontFamily).toBe('serif');
    expect(prefs.paragraphMode).toBe('article');
    expect(prefs.pageTurn).toBe('curl');
    expect(prefs.skin).toBe('custom');
    expect(prefs.customBg).toBe('#ffffff');
    expect(prefs.customPage).toBe('#fbfaf6');
    expect(prefs.customInk).toBe('#123456');
  });

  it('uses default numeric preferences for falsy or non-numeric values', () => {
    const prefs = clampReaderPreferences({
      fontSize: null,
      lineHeight: '',
      brightness: false,
    });

    expect(prefs.fontSize).toBe(17);
    expect(prefs.lineHeight).toBe(1.78);
    expect(prefs.brightness).toBe(100);
  });

  it('calculates heading pages from element rects relative to the measurement flow', () => {
    expect(horizontalOffsetToPage(626, 40, 300)).toBe(1);
    expect(horizontalOffsetToPage(940, 40, 300)).toBe(3);
    expect(horizontalOffsetToPage(20, 40, 300)).toBe(0);
    expect(horizontalOffsetToPage(940, 40, 0)).toBe(0);
  });

  it('falls back to book-style paragraph rhythm for malformed preferences', () => {
    expect(clampReaderPreferences({ paragraphMode: 'unknown' }).paragraphMode).toBe('book');
    expect(clampReaderPreferences(null).paragraphMode).toBe('book');
  });

  it('reflects unsupported desktop page-turn choices as curl', () => {
    expect(resolveReaderPageTurn('slide', 2)).toBe('curl');
    expect(resolveReaderPageTurn('curl', 2)).toBe('curl');
    expect(resolveReaderPageTurn('slide', 1)).toBe('slide');
    expect(resolveReaderPageTurn('instant', 2)).toBe('instant');
  });

  it('preserves reading position across mobile and desktop cursor models', () => {
    expect(cursorToAbsolutePage(3, 1)).toBe(3);
    expect(cursorToAbsolutePage(3, 2)).toBe(6);
    expect(absolutePageToCursor(6, 1, 12)).toBe(6);
    expect(absolutePageToCursor(6, 2, 12)).toBe(3);
    expect(absolutePageToCursor(99, 1, 12)).toBe(11);
    expect(absolutePageToCursor(99, 2, 12)).toBe(5);
  });

  it('accepts the kai reading font and falls back to serif for unknown families', () => {
    expect(clampReaderPreferences({ fontFamily: 'kai' }).fontFamily).toBe('kai');
    expect(clampReaderPreferences({ fontFamily: 'wingdings' }).fontFamily).toBe('serif');
  });
});

describe('reader flip physics gate', () => {
  it('maps progress to leaf travel symmetrically for both directions', () => {
    expect(flipTravel('next', 0)).toBe(0);
    expect(flipTravel('next', 1)).toBe(1);
    expect(flipTravel('prev', 0)).toBe(1);
    expect(flipTravel('prev', 1)).toBe(0);
    expect(flipTravel('next', 1.6)).toBe(1);
    expect(flipTravel('prev', -0.4)).toBe(1);
  });

  it('converts drag displacement into direction-aware progress', () => {
    expect(dragToProgress(-210, 400, 'next')).toBeCloseTo(0.5, 2);
    expect(dragToProgress(210, 400, 'prev')).toBeCloseTo(0.5, 2);
    // 反方向拖拽不产生负进度。
    expect(dragToProgress(120, 400, 'next')).toBe(0);
    expect(dragToProgress(-120, 400, 'prev')).toBe(0);
    expect(dragToProgress(-9999, 400, 'next')).toBe(1);
  });

  it('commits slow drags past the midpoint and cancels early releases', () => {
    expect(resolveFlipRelease(0.62, 0)).toBe(1);
    expect(resolveFlipRelease(0.38, 0)).toBe(0);
  });

  it('lets a fast fling commit even with a small displacement', () => {
    expect(resolveFlipRelease(0.14, 2.6)).toBe(1);
    expect(resolveFlipRelease(0.86, -2.6)).toBe(0);
  });

  it('integrates the critically damped spring to a settle without oscillation', () => {
    let state = { p: 0, v: 0 };
    let frames = 0;
    let overshoot = 0;
    while (!isFlipSettled(state, 1) && frames < 240) {
      state = stepFlipSpring(state, 1, 16.7);
      overshoot = Math.max(overshoot, state.p - 1);
      frames += 1;
    }
    expect(frames).toBeLessThan(120); // 2s 内落定
    expect(frames).toBeGreaterThan(10); // 不是瞬移
    expect(overshoot).toBeLessThan(0.06); // 纸张不回弹
    expect(state.p).toBeCloseTo(1, 2);
  });

  it('clamps runaway frame gaps so background tabs cannot teleport the leaf', () => {
    const jumped = stepFlipSpring({ p: 0, v: 0 }, 1, 5000);
    expect(jumped.p).toBeLessThan(0.35);
  });
});
