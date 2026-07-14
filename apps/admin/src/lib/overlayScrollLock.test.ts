import { describe, expect, it, vi } from 'vitest';
import {
  createOverlayScrollLockManager,
  type OverlayScrollLockEnvironment,
} from './overlayScrollLock';

function createEnvironment() {
  const rootStyle = {
    overflow: 'clip',
    overscrollBehavior: 'contain',
    scrollBehavior: 'smooth',
  };
  const bodyStyle = {
    position: 'relative',
    top: '2px',
    left: '3px',
    right: '4px',
    width: 'calc(100% - 1px)',
    overflow: 'auto',
    overscrollBehavior: 'contain',
    paddingRight: '8px',
  };
  const scrollTo = vi.fn();
  const environment: OverlayScrollLockEnvironment = {
    rootStyle,
    bodyStyle,
    scrollX: 17,
    scrollY: 420,
    scrollbarGap: 15,
    bodyPaddingRight: 8,
    scrollTo,
  };
  return { environment, rootStyle, bodyStyle, scrollTo };
}

describe('overlay scroll lock', () => {
  it('uses an iOS-safe fixed body and restores the exact page state', () => {
    const { environment, rootStyle, bodyStyle, scrollTo } = createEnvironment();
    const manager = createOverlayScrollLockManager(() => environment);

    const release = manager.acquire();

    expect(rootStyle).toMatchObject({
      overflow: 'hidden',
      overscrollBehavior: 'none',
    });
    expect(bodyStyle).toMatchObject({
      position: 'fixed',
      top: '-420px',
      left: '-17px',
      right: '0',
      width: '100%',
      overflow: 'hidden',
      overscrollBehavior: 'none',
      paddingRight: '23px',
    });

    release();

    expect(rootStyle).toEqual({
      overflow: 'clip',
      overscrollBehavior: 'contain',
      scrollBehavior: 'smooth',
    });
    expect(bodyStyle).toEqual({
      position: 'relative',
      top: '2px',
      left: '3px',
      right: '4px',
      width: 'calc(100% - 1px)',
      overflow: 'auto',
      overscrollBehavior: 'contain',
      paddingRight: '8px',
    });
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledWith(17, 420);
  });

  it('keeps nested overlays locked until the final idempotent release', () => {
    const { environment, bodyStyle, scrollTo } = createEnvironment();
    const manager = createOverlayScrollLockManager(() => environment);

    const releaseSheet = manager.acquire();
    const releaseDialog = manager.acquire();
    expect(manager.getLockCount()).toBe(2);

    releaseSheet();
    releaseSheet();
    expect(manager.getLockCount()).toBe(1);
    expect(bodyStyle.position).toBe('fixed');
    expect(scrollTo).not.toHaveBeenCalled();

    releaseDialog();
    expect(manager.getLockCount()).toBe(0);
    expect(bodyStyle.position).toBe('relative');
    expect(scrollTo).toHaveBeenCalledWith(17, 420);
  });
});
