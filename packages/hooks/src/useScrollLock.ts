import { useEffect, useRef } from 'react';

export function useScrollLock(lock: boolean = true): void {
  const originalStyle = useRef<string>('');

  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (lock) {
      // Store original overflow
      originalStyle.current = document.body.style.overflow;
      // Prevent scrolling
      document.body.style.overflow = 'hidden';
    }

    return () => {
      // Restore original overflow
      document.body.style.overflow = originalStyle.current;
    };
  }, [lock]);
}
