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
  transitionType: 'slide' | 'fade' | 'none';
}

const TransitionContext = createContext<TransitionContextType>({
  direction: 0,
  shouldAnimate: false,
  transitionType: 'none',
});

export function useTransition() {
  return useContext(TransitionContext);
}

interface TransitionProviderProps {
  children: ReactNode;
}

// 判断是否是文章详情页
function isArticleDetailPath(path: string): boolean {
  return path.startsWith('/posts/') && path !== '/posts';
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
  const transitionTypeRef = useRef<'slide' | 'fade' | 'none'>('none');

  // 计算滑动方向 - 仅在 /posts <-> /timeline 之间触发
  const prevPath = previousPathRef.current;
  
  if (prevPath !== pathname) {
    const currentOrder = PAGE_ORDER[pathname] ?? -1;
    const prevOrder = PAGE_ORDER[prevPath] ?? -1;
    const fromArticle = isArticleDetailPath(prevPath);
    const toArticle = isArticleDetailPath(pathname);

    // 情况1: /posts <-> /timeline 滑动动画
    if (currentOrder !== -1 && prevOrder !== -1) {
      directionRef.current = currentOrder > prevOrder ? 1 : -1;
      shouldAnimateRef.current = true;
      transitionTypeRef.current = 'slide';
    } 
    // 情况2: 进入或离开文章详情页 - 淡入淡出
    else if (fromArticle || toArticle) {
      directionRef.current = 0;
      shouldAnimateRef.current = true;
      transitionTypeRef.current = 'fade';
    }
    // 其他情况：无动画
    else {
      directionRef.current = 0;
      shouldAnimateRef.current = false;
      transitionTypeRef.current = 'none';
    }

    previousPathRef.current = pathname;
  }

  const value = {
    direction: directionRef.current,
    shouldAnimate: shouldAnimateRef.current,
    transitionType: transitionTypeRef.current,
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
 * 支持两种动画类型：
 * 1. slide: /posts <-> /timeline 之间的滑动
 * 2. fade: 进入/离开文章详情页的淡入淡出 (支持双向过渡)
 */
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const { direction, shouldAnimate, transitionType } = useTransition();

  // 根据过渡类型选择进入动画配置
  const getInitialAnimation = () => {
    if (!shouldAnimate) return false;
    
    if (transitionType === 'slide') {
      return { 
        x: direction > 0 ? '15%' : '-15%', 
        opacity: 0.8 
      };
    } else if (transitionType === 'fade') {
      return { 
        opacity: 0,
        y: 10 
      };
    }
    return false;
  };

  // 根据过渡类型选择退出动画配置
  const getExitAnimation = () => {
    if (!shouldAnimate) return undefined;
    
    if (transitionType === 'fade') {
      // 退出时淡出，不移动位置以避免重叠混乱
      return { 
        opacity: 0,
      };
    }
    // slide 类型默认不需要显式 exit，因为 popLayout 会处理移除
    return undefined;
  };

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={pathname}
        initial={getInitialAnimation()}
        animate={{ 
          x: 0, 
          y: 0,
          opacity: 1 
        }}
        exit={getExitAnimation()}
        transition={{
          type: 'tween',
          duration: shouldAnimate ? (transitionType === 'fade' ? 0.35 : 0.25) : 0,
          ease: transitionType === 'fade' ? [0.22, 1, 0.36, 1] : 'easeOut',
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
