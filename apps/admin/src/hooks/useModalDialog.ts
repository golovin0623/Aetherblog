// 弹窗通用行为 —— 焦点管理 + Esc 关闭 + 滚动锁
// ref: .claude/design-system/05-components.md · Modal
//
// 背景：声明 role="dialog" aria-modal="true" 却不做焦点管理，比不声明更糟 ——
// 读屏器按 aria-modal 语义认为对话框外内容已惰性化，实际 Tab 仍会走到遮罩背后
// （portal 挂在 body 末尾，键盘用户要穿越整页才进得来）。本 hook 把
// ConfirmDialog 已验证的范式抽出来，供 portal 弹窗统一复用。

import { useEffect, useLayoutEffect, useRef } from 'react';
import { SELECT_OVERLAY_CLOSE_EVENT } from '@aetherblog/ui';
import { acquireOverlayScrollLock } from '@/lib/overlayScrollLock';

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

interface UseModalDialogOptions {
  /** 关闭回调（Esc / 焦点陷阱不拦截时由调用方自行触发） */
  onClose: () => void;
  /** 为 false 时不接管 Esc —— 例如内层确认弹窗已打开，交由内层处理 */
  escEnabled?: boolean;
}

/**
 * 返回挂到弹窗容器上的 ref。挂载期间：
 * - 记录先前焦点，rAF 后把焦点移入弹窗（首个可聚焦元素，否则容器本身）
 * - Tab / Shift+Tab 在弹窗内循环（焦点陷阱）
 * - Esc 关闭，且跳过 IME 组合态（中文输入法按 Esc 取消候选词不应关窗丢表单）
 * - 卸载时还原焦点、释放滚动锁
 */
export function useModalDialog<T extends HTMLElement = HTMLDivElement>({
  onClose,
  escEnabled = true,
}: UseModalDialogOptions) {
  const dialogRef = useRef<T>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const escEnabledRef = useRef(escEnabled);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    escEnabledRef.current = escEnabled;
  }, [escEnabled]);

  useLayoutEffect(() => {
    window.dispatchEvent(new Event(SELECT_OVERLAY_CLOSE_EVENT));
    return acquireOverlayScrollLock();
  }, []);

  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusFrame = window.requestAnimationFrame(() => {
      const container = dialogRef.current;
      if (!container) return;
      // 焦点落在首个可聚焦控件上；没有则聚焦容器本身（需 tabIndex={-1}）
      const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? container).focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      // IME 组合态：中文/日文输入法按 Esc 取消候选词时浏览器同样派发
      // key='Escape'，若不放行会把整个弹窗连同未保存的表单一起关掉。
      if (event.isComposing || event.keyCode === 229) return;

      if (event.key === 'Escape') {
        if (!escEnabledRef.current) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const container = dialogRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // 焦点在弹窗外（例如刚打开尚未移入）时，Tab 一律拉回弹窗内
      if (!container.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
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
  }, []);

  return dialogRef;
}
