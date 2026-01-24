import { useEffect, useRef, useCallback, useState } from 'react';

interface UseSmartPollingOptions {
  callback: () => void | Promise<void>;
  interval: number; // seconds
  idleTimeout?: number; // milliseconds, default 5 minutes
  enabled?: boolean;
}

/**
 * 智能轮询 Hook
 * 
 * 功能:
 * 1. 定时执行 callback
 * 2. 页面不可见时(切换标签)自动暂停
 * 3. 用户无操作超过 idleTimeout 时自动暂停
 * 4. 页面重新可见或用户操作时立即恢复并执行一次
 */
export function useSmartPolling({
  callback,
  interval,
  idleTimeout = 5 * 60 * 1000, // 5 minutes
  enabled = true
}: UseSmartPollingOptions) {
  const [isIdle, setIsIdle] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Ref for callback to avoid effect dependencies
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Handle visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden: modify nothing, just let interval pause logic pick it up if needed, 
        // actually simplest is to clear interval on hide and restart on show
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } else {
        // Tab visible: trigger immediate update and restart timer if not idle
        if (!isIdle && enabled) {
          callbackRef.current();
          startPolling();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isIdle, enabled]);

  // Handle user activity to reset idle timer
  useEffect(() => {
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      if (isIdle) {
        setIsIdle(false);
        // Resume polling immediately
        if (enabled && !document.hidden) {
          callbackRef.current();
          startPolling();
        }
      }
    };

    // Events to track activity
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    
    // Throttle event listeners
    let throttleTimeout: ReturnType<typeof setTimeout> | null = null;
    const throttledHandler = () => {
      if (!throttleTimeout) {
        handleActivity();
        throttleTimeout = setTimeout(() => {
          throttleTimeout = null;
        }, 1000);
      }
    };

    events.forEach(event => window.addEventListener(event, throttledHandler));
    
    return () => {
      events.forEach(event => window.removeEventListener(event, throttledHandler));
      if (throttleTimeout) clearTimeout(throttleTimeout);
    };
  }, [isIdle, enabled]);

  // Polling logic
  const startPolling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    
    timerRef.current = setInterval(() => {
      // Create a safety check only specific for polling
      if (!document.hidden && !isIdle && enabled) {
        callbackRef.current();
      }
    }, interval * 1000);
  }, [interval, isIdle, enabled]);

  // Check for idle status
  useEffect(() => {
    const checkIdle = () => {
      const now = Date.now();
      if (now - lastActivityRef.current > idleTimeout) {
        if (!isIdle) {
          setIsIdle(true);
          // Stop polling when idle
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      }
    };

    idleCheckTimerRef.current = setInterval(checkIdle, 10000); // Check every 10s
    
    return () => {
      if (idleCheckTimerRef.current) clearInterval(idleCheckTimerRef.current);
    };
  }, [idleTimeout, isIdle]);

  // Start initial polling
  useEffect(() => {
    if (enabled && !isIdle && !document.hidden) {
      startPolling();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startPolling, enabled, isIdle]);

  return { isIdle };
}
