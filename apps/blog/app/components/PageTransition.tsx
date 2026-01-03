'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useRef, ReactNode } from 'react';

// 页面顺序映射
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
  const hasNavigatedRef = useRef(false);

  // 计算滑动方向
  const prevPath = previousPathRef.current;
  
  if (prevPath !== pathname) {
    hasNavigatedRef.current = true;
    
    const currentOrder = PAGE_ORDER[pathname] ?? -1;
    const prevOrder = PAGE_ORDER[prevPath] ?? -1;

    if (currentOrder !== -1 && prevOrder !== -1) {
      directionRef.current = currentOrder > prevOrder ? 1 : -1;
    } else {
      directionRef.current = 0;
    }

    previousPathRef.current = pathname;
  }

  const value = {
    direction: directionRef.current,
    shouldAnimate: hasNavigatedRef.current && directionRef.current !== 0,
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
 */
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const { direction, shouldAnimate } = useTransition();

  // 优化后的动画变体 - 减少距离提升性能
  const variants = {
    initial: {
      x: direction > 0 ? '15%' : '-15%',
      opacity: 0.9,
    },
    animate: {
      x: 0,
      opacity: 1,
    },
    exit: {
      x: direction > 0 ? '-15%' : '15%',
      opacity: 0.9,
    },
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        variants={shouldAnimate ? variants : undefined}
        initial={shouldAnimate ? 'initial' : false}
        animate="animate"
        exit={shouldAnimate ? 'exit' : undefined}
        transition={{
          type: 'tween',
          duration: 0.2, // 更短的动画时长
          ease: 'easeOut',
        }}
        className="w-full"
        style={{ 
          willChange: shouldAnimate ? 'transform, opacity' : 'auto',
          transform: 'translate3d(0, 0, 0)', // 强制 GPU 加速
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
