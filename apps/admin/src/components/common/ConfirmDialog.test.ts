import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.resolve(__dirname, './ConfirmDialog.tsx'), 'utf8');

describe('ConfirmDialog overlay contract', () => {
  it('closes portalled selects before paint and always layers above them', () => {
    expect(source).toContain('useLayoutEffect(() => {');
    expect(source).toContain('window.dispatchEvent(new Event(SELECT_OVERLAY_CLOSE_EVENT));');
    expect(source).toContain('z-[10000]');
  });

  it('uses the shared reference-counted scroll lock for nested overlays', () => {
    expect(source).toContain("import { acquireOverlayScrollLock } from '@/lib/overlayScrollLock';");
    expect(source).toContain('return acquireOverlayScrollLock();');
    expect(source).not.toContain("document.body.style.overflow = 'hidden'");
  });

  it('consumes Escape at the top modal even while a destructive write is pending', () => {
    expect(source).toMatch(
      /if \(event\.key === 'Escape'\) \{\s*event\.preventDefault\(\);\s*event\.stopImmediatePropagation\(\);\s*if \(pendingRef\.current\) return;/
    );
  });
});
