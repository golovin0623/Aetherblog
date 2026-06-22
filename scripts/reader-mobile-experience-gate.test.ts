import { describe, expect, it } from 'vitest';
import {
  absolutePageToCursor,
  clampReaderPreferences,
  computeReaderDims,
  cursorToAbsolutePage,
  horizontalOffsetToPage,
  resolveReaderPageTurn,
  resolveReaderSkin,
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
    expect(dims.pageW * 2).toBeLessThanOrEqual(1412);
    expect(dims.pageH).toBeLessThanOrEqual(744);
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
});
