'use client';
import { useState, useCallback } from 'react';

/**
 * 复制到剪贴板 —— 带三层降级:
 *   1. navigator.clipboard.writeText(异步 API,只在 secure context 可用)
 *   2. document.execCommand('copy')(legacy 同步 API,HTTP 环境仍工作)
 *   3. catch 所有异常只 console.warn,不向外抛(避免 Next.js 红屏)
 */
function legacyCopyText(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

export function useCopyToClipboard(): [boolean, (text: string) => Promise<boolean>] {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    let success = false;
    try {
      // Tier 1:现代异步 API —— 仅 secure context
      if (
        typeof navigator !== 'undefined' &&
        typeof window !== 'undefined' &&
        window.isSecureContext &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(text);
        success = true;
      } else {
        // Tier 2:legacy execCommand 降级
        success = legacyCopyText(text);
      }
    } catch (error) {
      // Tier 3:兜底 execCommand,仍失败则 warn
      try {
        success = legacyCopyText(text);
      } catch {
        success = false;
      }
      if (!success) {
        // 只 warn 不 error —— 避免 dev 红屏,用户并不在乎复制失败
        console.warn('Copy failed:', error);
      }
    }

    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    return success;
  }, []);

  return [copied, copy];
}
