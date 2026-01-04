'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useRef, ReactNode } from 'react';

// 页面顺序映射 - 仅这两个路径之间有滑动动画
const PAGE_ORDER: Record<string, number> = {
  '/posts': 0,
  '/timeline': 1,
};

interface TransitionContextType {
  direction: number;
  shouldAnimate: boolean;
}

const TransitionContext = createContext<TransitionContextType>({
  direction: 0,
  shouldAnimate: false,
});

export function useTransition() {
  return useContext(TransitionContext);
}

interface TransitionProviderProps {
  children: ReactNode;
}

/**
 * 页面过渡状态提供者
 * 放在 layout.tsx 中，跨路由持久化
 */
export function TransitionProvider({ children }: TransitionProviderProps) {
  const pathname = usePathname();
  const previousPathRef = useRef<string>(pathname);
  const directionRef = useRef(0);
  const shouldAnimateRef = useRef(false);

  // 计算滑动方向 - 仅在 /posts <-> /timeline 之间触发
  const prevPath = previousPathRef.current;
  
  if (prevPath !== pathname) {
    const currentOrder = PAGE_ORDER[pathname] ?? -1;
    const prevOrder = PAGE_ORDER[prevPath] ?? -1;

    // Only animate if BOTH paths are in the defined PAGE_ORDER
    if (currentOrder !== -1 && prevOrder !== -1) {
      directionRef.current = currentOrder > prevOrder ? 1 : -1;
      shouldAnimateRef.current = true;
    } else {
      // Reset for any other navigation (e.g., to article detail)
      directionRef.current = 0;
      shouldAnimateRef.current = false;
    }

    previousPathRef.current = pathname;
  }

  const value = {
    direction: directionRef.current,
    shouldAnimate: shouldAnimateRef.current,
  };

  return (
    <TransitionContext.Provider value={value}>
      {children}
    </TransitionContext.Provider>
  );
}

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * 页面过渡动画包装器
 * 只对进入的页面应用动画，不对退出的页面应用动画
 * 这样可以避免导航到非动画路径时残留的退出动画问题
 */
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const { direction, shouldAnimate } = useTransition();

  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={pathname}
        initial={shouldAnimate ? { 
          x: direction > 0 ? '15%' : '-15%', 
          opacity: 0.8 
        } : false}
        animate={{ 
          x: 0, 
          opacity: 1 
        }}
        // 不使用 exit 动画，避免残留状态影响后续导航
        transition={{
          type: 'tween',
          duration: shouldAnimate ? 0.25 : 0,
          ease: 'easeOut',
        }}
        className="w-full"
        style={{ 
          willChange: shouldAnimate ? 'transform, opacity' : 'auto',
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
