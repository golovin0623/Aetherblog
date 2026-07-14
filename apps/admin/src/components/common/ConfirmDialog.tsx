'use client';

import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Copy, Info, Loader2, Trash2, X } from 'lucide-react';
import { SELECT_OVERLAY_CLOSE_EVENT } from '@aetherblog/ui';
import { cn } from '@/lib/utils';
import { acquireOverlayScrollLock } from '@/lib/overlayScrollLock';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'copy';
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const variantConfig = {
  danger: {
    icon: Trash2,
    iconBg: 'bg-status-danger/10',
    iconColor: 'text-status-danger',
    button: 'bg-status-danger text-white hover:bg-status-danger/90',
  },
  warning: {
    icon: AlertTriangle,
    iconBg: 'bg-status-warning/10',
    iconColor: 'text-status-warning',
    button: 'bg-[var(--ink-primary)] text-[var(--bg-void)] hover:opacity-90',
  },
  info: {
    icon: Info,
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
    button: 'bg-[var(--ink-primary)] text-[var(--bg-void)] hover:opacity-90',
  },
  copy: {
    icon: Copy,
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
    button: 'bg-[var(--ink-primary)] text-[var(--bg-void)] hover:opacity-90',
  },
} as const;

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'danger',
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const prefersReducedMotion = useReducedMotion();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const pendingRef = useRef(pending);

  useLayoutEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useLayoutEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    window.dispatchEvent(new Event(SELECT_OVERLAY_CLOSE_EVENT));
    return acquireOverlayScrollLock();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusFrame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (pendingRef.current) return;
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ) ?? []).filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocusedRef.current?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  if (typeof document === 'undefined') return null;
  const config = variantConfig[variant];
  const IconComponent = config.icon;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.16 }}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={() => {
              if (!pending) onCancel();
            }}
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            aria-busy={pending}
            tabIndex={-1}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="surface-overlay relative w-full max-w-md overflow-hidden rounded-[1.25rem] focus:outline-none"
          >
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="absolute right-3 top-3 z-10 grid h-11 w-11 place-items-center rounded-full text-[var(--text-muted)] transition-[background-color,color,opacity] duration-100 hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="关闭确认对话框"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="p-5 sm:p-6">
              <div className="flex items-start gap-3 pr-11 sm:gap-4">
                <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', config.iconBg)}>
                  <IconComponent className={cn('h-5 w-5', config.iconColor)} />
                </div>
                <div className="min-w-0 pt-0.5">
                  <h3 id={titleId} className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
                  <p id={descriptionId} className="mt-1.5 text-sm leading-6 text-[var(--text-secondary)]">{message}</p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-2.5">
                <button
                  ref={cancelButtonRef}
                  type="button"
                  onClick={onCancel}
                  disabled={pending}
                  className="min-h-11 rounded-xl bg-[var(--bg-secondary)] px-4 text-sm font-semibold text-[var(--text-secondary)] transition-[background-color,color,opacity] duration-100 hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {cancelText}
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={pending}
                  className={cn(
                    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-opacity duration-100 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60',
                    config.button
                  )}
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {confirmText}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export default ConfirmDialog;
