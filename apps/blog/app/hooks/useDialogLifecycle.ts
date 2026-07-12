'use client';

import { useEffect, useRef, type RefObject } from 'react';

type ScrollLockSnapshot = {
  scrollPosition: number;
  documentOverflow: string;
  documentOverscrollBehavior: string;
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyWidth: string;
};

let scrollLockCount = 0;
let scrollLockSnapshot: ScrollLockSnapshot | null = null;

function lockDocumentScroll(): () => void {
  scrollLockCount += 1;

  if (scrollLockCount === 1) {
    const scrollPosition = window.scrollY;
    scrollLockSnapshot = {
      scrollPosition,
      documentOverflow: document.documentElement.style.overflow,
      documentOverscrollBehavior: document.documentElement.style.overscrollBehavior,
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyWidth: document.body.style.width,
    };

    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollPosition}px`;
    document.body.style.width = '100%';
  }

  return () => {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount > 0 || !scrollLockSnapshot) return;

    const {
      scrollPosition,
      documentOverflow,
      documentOverscrollBehavior,
      bodyOverflow,
      bodyPosition,
      bodyTop,
      bodyWidth,
    } = scrollLockSnapshot;
    scrollLockSnapshot = null;

    document.documentElement.style.overflow = documentOverflow;
    document.documentElement.style.overscrollBehavior = documentOverscrollBehavior;
    document.body.style.overflow = bodyOverflow;
    document.body.style.position = bodyPosition;
    document.body.style.top = bodyTop;
    document.body.style.width = bodyWidth;
    window.scrollTo(0, scrollPosition);
  };
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && element.getClientRects().length > 0;
  });
}

export function useDialogLifecycle({
  open,
  onClose,
  containerRef,
  initialFocusRef,
  returnFocusRef,
  modal = true,
  trapFocus = true,
}: {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  modal?: boolean;
  trapFocus?: boolean;
}) {
  const latestReturnFocusRef = useRef(returnFocusRef);

  useEffect(() => {
    latestReturnFocusRef.current = returnFocusRef;
  }, [returnFocusRef]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const releaseScrollLock = modal ? lockDocumentScroll() : undefined;

    const focusTimer = window.setTimeout(() => {
      const container = containerRef.current;
      const target = initialFocusRef?.current || (container ? visibleFocusableElements(container)[0] : null);
      target?.focus({ preventScroll: true });
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (!trapFocus || event.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;
      const focusable = visibleFocusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      window.clearTimeout(focusTimer);
      releaseScrollLock?.();
      // The opener may unmount while the dialog is open. Resolve the explicit ref
      // after React has rendered it again instead of retaining a detached element.
      window.setTimeout(() => {
        const returnTarget = previouslyFocused?.isConnected && previouslyFocused !== document.body
          ? previouslyFocused
          : latestReturnFocusRef.current?.current;
        returnTarget?.focus({ preventScroll: true });
      }, 0);
    };
  }, [containerRef, initialFocusRef, modal, onClose, open, trapFocus]);
}
