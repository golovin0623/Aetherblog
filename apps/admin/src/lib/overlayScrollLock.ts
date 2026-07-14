type RootScrollLockStyle = Pick<
  CSSStyleDeclaration,
  'overflow' | 'overscrollBehavior' | 'scrollBehavior'
>;

type BodyScrollLockStyle = Pick<
  CSSStyleDeclaration,
  | 'position'
  | 'top'
  | 'left'
  | 'right'
  | 'width'
  | 'overflow'
  | 'overscrollBehavior'
  | 'paddingRight'
>;

export interface OverlayScrollLockEnvironment {
  rootStyle: RootScrollLockStyle;
  bodyStyle: BodyScrollLockStyle;
  scrollX: number;
  scrollY: number;
  scrollbarGap: number;
  bodyPaddingRight: number;
  scrollTo: (x: number, y: number) => void;
}

interface OverlayScrollLockSnapshot {
  environment: OverlayScrollLockEnvironment;
  root: RootScrollLockStyle;
  body: BodyScrollLockStyle;
}

export interface OverlayScrollLockManager {
  acquire: () => () => void;
  getLockCount: () => number;
}

function copyRootStyle(style: RootScrollLockStyle): RootScrollLockStyle {
  return {
    overflow: style.overflow,
    overscrollBehavior: style.overscrollBehavior,
    scrollBehavior: style.scrollBehavior,
  };
}

function copyBodyStyle(style: BodyScrollLockStyle): BodyScrollLockStyle {
  return {
    position: style.position,
    top: style.top,
    left: style.left,
    right: style.right,
    width: style.width,
    overflow: style.overflow,
    overscrollBehavior: style.overscrollBehavior,
    paddingRight: style.paddingRight,
  };
}

function restoreRootStyle(target: RootScrollLockStyle, snapshot: RootScrollLockStyle) {
  target.overflow = snapshot.overflow;
  target.overscrollBehavior = snapshot.overscrollBehavior;
  target.scrollBehavior = snapshot.scrollBehavior;
}

function restoreBodyStyle(target: BodyScrollLockStyle, snapshot: BodyScrollLockStyle) {
  target.position = snapshot.position;
  target.top = snapshot.top;
  target.left = snapshot.left;
  target.right = snapshot.right;
  target.width = snapshot.width;
  target.overflow = snapshot.overflow;
  target.overscrollBehavior = snapshot.overscrollBehavior;
  target.paddingRight = snapshot.paddingRight;
}

/**
 * Reference-counted overlay scroll lock.
 *
 * A fixed body keeps iOS Safari from moving the page behind a sheet. The
 * original inline styles and exact scroll coordinates are restored only when
 * the last nested overlay closes.
 */
export function createOverlayScrollLockManager(
  resolveEnvironment: () => OverlayScrollLockEnvironment | null,
): OverlayScrollLockManager {
  let lockCount = 0;
  let snapshot: OverlayScrollLockSnapshot | null = null;

  const acquire = () => {
    const environment = resolveEnvironment();
    if (!environment) return () => undefined;

    if (lockCount === 0) {
      snapshot = {
        environment,
        root: copyRootStyle(environment.rootStyle),
        body: copyBodyStyle(environment.bodyStyle),
      };
      environment.rootStyle.overflow = 'hidden';
      environment.rootStyle.overscrollBehavior = 'none';
      environment.bodyStyle.position = 'fixed';
      environment.bodyStyle.top = `${-environment.scrollY}px`;
      environment.bodyStyle.left = `${-environment.scrollX}px`;
      environment.bodyStyle.right = '0';
      environment.bodyStyle.width = '100%';
      environment.bodyStyle.overflow = 'hidden';
      environment.bodyStyle.overscrollBehavior = 'none';
      if (environment.scrollbarGap > 0) {
        environment.bodyStyle.paddingRight = `${environment.bodyPaddingRight + environment.scrollbarGap}px`;
      }
    }

    lockCount += 1;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount > 0 || !snapshot) return;

      const currentSnapshot = snapshot;
      snapshot = null;
      restoreBodyStyle(currentSnapshot.environment.bodyStyle, currentSnapshot.body);
      currentSnapshot.environment.rootStyle.scrollBehavior = 'auto';
      currentSnapshot.environment.scrollTo(
        currentSnapshot.environment.scrollX,
        currentSnapshot.environment.scrollY,
      );
      restoreRootStyle(currentSnapshot.environment.rootStyle, currentSnapshot.root);
    };
  };

  return {
    acquire,
    getLockCount: () => lockCount,
  };
}

const browserOverlayScrollLock = createOverlayScrollLockManager(() => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const computedBodyPaddingRight = Number.parseFloat(
    window.getComputedStyle(document.body).paddingRight,
  );
  return {
    rootStyle: document.documentElement.style,
    bodyStyle: document.body.style,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    scrollbarGap: Math.max(0, window.innerWidth - document.documentElement.clientWidth),
    bodyPaddingRight: Number.isFinite(computedBodyPaddingRight) ? computedBodyPaddingRight : 0,
    scrollTo: (x, y) => window.scrollTo(x, y),
  };
});

export function acquireOverlayScrollLock(): () => void {
  return browserOverlayScrollLock.acquire();
}
