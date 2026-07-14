import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const musicPageSource = readFileSync(path.resolve(__dirname, '../MusicPage.tsx'), 'utf8');
const adminIndexSource = readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8');

describe('mobile track editor interaction', () => {
  it('starts downward drag only from the handle or header and keeps form scrolling native', () => {
    expect(musicPageSource).toContain('data-track-editor-drag-handle');
    expect(musicPageSource).toContain('data-track-editor-drag-region');
    expect(musicPageSource).toContain('dragListener={false}');
    expect(musicPageSource).toContain('sheetDragControls.start(event);');
    expect(musicPageSource).toContain("target.closest('button, a, input, textarea, select, [role=\"combobox\"]')");
    expect(musicPageSource).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain');
    expect(musicPageSource).toContain("touchAction: 'auto'");
  });

  it('uses distance and velocity thresholds, rebounds short gestures, and honors reduced motion', () => {
    expect(musicPageSource).toContain('const distanceThreshold = Math.min(132, Math.max(76, sheetHeight * 0.2));');
    expect(musicPageSource).toContain('info.velocity.y >= 900 && info.offset.y >= 24');
    expect(musicPageSource).toContain('settleSheet();');
    expect(musicPageSource).toContain("drag={mobile ? 'y' : false}");
    expect(musicPageSource).toMatch(
      /if \(prefersReducedMotion\) \{\s*sheetY\.set\(0\);\s*onSettled\?\.\(\);/
    );
    expect(musicPageSource).toContain('duration: 0.22');
  });

  it('truncates an unbounded media filename without squeezing the close action', () => {
    expect(musicPageSource).toContain('className="min-w-0 flex-1"');
    expect(musicPageSource).toContain('className="mt-1 truncate text-xs text-[var(--ink-muted)]"');
    expect(musicPageSource).toContain("className={cn(iconButtonClass(), 'shrink-0')}");
  });

  it('keeps all three footer actions on one row at 320px', () => {
    expect(musicPageSource).toContain(
      'max-[360px]:!grid max-[360px]:grid-cols-[1.35fr_0.8fr_0.9fr]',
    );
    expect(musicPageSource.match(/max-\[360px\]:min-w-0 max-\[360px\]:gap-1\.5/g)).toHaveLength(3);
  });
});

describe('music overlay coordination', () => {
  it('keeps one confirmation dialog active at a time', () => {
    expect(musicPageSource).toContain('const activeConfirmation = pendingDelete');
    expect(musicPageSource).toContain('const activeConfirmationConfig: MusicConfirmationConfig | null');
    expect(musicPageSource.match(/<ConfirmDialog/g)).toHaveLength(1);
    expect(musicPageSource).toContain('isOpen={activeConfirmationConfig != null}');
  });

  it('uses the same reference-counted lock for the mobile sheet', () => {
    expect(musicPageSource).toContain('return acquireOverlayScrollLock();');
    expect(musicPageSource).not.toContain("document.body.style.overflow = 'hidden'");
  });

  it('suppresses the global dock in a pre-paint layout effect', () => {
    expect(musicPageSource).toMatch(
      /useLayoutEffect\(\(\) => \{\s*setDockSuppressed\(activeTab === 'display'\);/
    );
  });

  it('opts the admin shell into full safe-area viewport geometry', () => {
    expect(adminIndexSource).toContain(
      'content="width=device-width, initial-scale=1.0, viewport-fit=cover"'
    );
  });
});
