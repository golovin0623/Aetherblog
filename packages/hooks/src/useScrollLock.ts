'use client';
import { useEffect, useRef } from 'react';

export function useScrollLock(lock: boolean = true): void {
  const originalStyle = useRef<string>('');

  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (lock) {
      // 保存原始 overflow
      originalStyle.current = document.body.style.overflow;
      // 禁止滚动
      document.body.style.overflow = 'hidden';
    }

    return () => {
      // 恢复原始 overflow
      document.body.style.overflow = originalStyle.current;
    };
  }, [lock]);
}
