import { useEffect, useRef, useCallback, useState } from 'react';

interface UseSmartPollingOptions {
  callback: () => void | Promise<void>;
  interval: number; // 秒
  idleTimeout?: number; // 毫秒，默认 5 分钟
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
  
  // 用于回调的 Ref，避免 effect 依赖
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // 处理可见性变化
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // 标签页隐藏: 不做任何修改，让间隔暂停逻辑处理，
        // 实际上最简单的方法是在隐藏时清除间隔，显示时重新启动
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } else {
        // 标签页可见: 立即触发更新，如果未空闲则重启计时器
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

  // 处理用户活动以重置空闲计时器
  useEffect(() => {
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      if (isIdle) {
        setIsIdle(false);
        // 立即恢复轮询
        if (enabled && !document.hidden) {
          callbackRef.current();
          startPolling();
        }
      }
    };

    // 追踪活动的事件
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    
    // 节流事件监听器
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

  // 轮询逻辑
  const startPolling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    
    timerRef.current = setInterval(() => {
      // 创建仅针对轮询的安全检查
      if (!document.hidden && !isIdle && enabled) {
        callbackRef.current();
      }
    }, interval * 1000);
  }, [interval, isIdle, enabled]);

  // 检查空闲状态
  useEffect(() => {
    const checkIdle = () => {
      const now = Date.now();
      if (now - lastActivityRef.current > idleTimeout) {
        if (!isIdle) {
          setIsIdle(true);
          // 空闲时停止轮询
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      }
    };

    idleCheckTimerRef.current = setInterval(checkIdle, 10000); // 每 10 秒检查一次
    
    return () => {
      if (idleCheckTimerRef.current) clearInterval(idleCheckTimerRef.current);
    };
  }, [idleTimeout, isIdle]);

  // 开始初始轮询
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
