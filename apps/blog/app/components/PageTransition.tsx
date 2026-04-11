'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useRef, useEffect, ReactNode } from 'react';

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
  // 用实例级 ref 而不是模块级变量存储 popstate 标记，避免 Fast Refresh /
  // 嵌套挂载 / 并行测试等场景下的跨实例状态泄漏。popstate 事件监听器通过闭包
  // 持有同一个 ref 对象，渲染函数也读取同一个 ref，两边天然共享。
  const popNavPendingRef = useRef(false);

  // popstate 监听：浏览器前进/返回按钮会触发 popstate，Next.js router.push 不会。
  // 检测到 popstate 时设置 ref 标记，下一次 pathname 变化（本次导航）时消费一次。
  // 同时在 <html> 上加 data-nav-type="pop"，让 CSS 禁用 FadeIn / animate-in 的入场动画。
  //
  // 清理逻辑直接放在 popstate handler 内部（而不是依赖 pathname 变化的 useEffect），
  // 因为 popstate 也可能由 hash / 仅 query 参数变化触发——这种情况下 usePathname()
  // 返回值不变，依赖 [pathname] 的 useEffect 不会触发，data-nav-type 就会"卡"在
  // <html> 上，导致后续所有正常导航都丢失入场动画。用 2 帧内直接清理来规避这个问题。
  useEffect(() => {
    let cleanupRaf1: number | null = null;
    let cleanupRaf2: number | null = null;

    const cancelPending = () => {
      if (cleanupRaf1 !== null) cancelAnimationFrame(cleanupRaf1);
      if (cleanupRaf2 !== null) cancelAnimationFrame(cleanupRaf2);
      cleanupRaf1 = null;
      cleanupRaf2 = null;
    };

    const handlePopState = () => {
      popNavPendingRef.current = true;
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.navType = 'pop';
      }

      // 取消任何未完成的旧清理，然后重新排 2 帧的清理。
      // 2 帧足以让本次 popstate 触发的组件挂载完成首帧渲染；
      // 同时覆盖 hash/query-only popstate 场景（pathname 不变也会正确清理）。
      cancelPending();
      cleanupRaf1 = requestAnimationFrame(() => {
        cleanupRaf2 = requestAnimationFrame(() => {
          if (typeof document !== 'undefined') {
            delete document.documentElement.dataset.navType;
          }
          // 同步清理 popNavPendingRef：如果是 hash/query popstate，pathname 不变
          // 导致渲染时的消费分支不会跑，标记会残留并污染下一次真正的前进导航。
          popNavPendingRef.current = false;
          cleanupRaf1 = null;
          cleanupRaf2 = null;
        });
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      cancelPending();
      // 组件卸载时兜底清理：防止 data-nav-type 残留影响下一次挂载的实例
      if (typeof document !== 'undefined') {
        delete document.documentElement.dataset.navType;
      }
      popNavPendingRef.current = false;
    };
  }, []);

  // 计算滑动方向 - 仅在 /posts <-> /timeline 之间触发
  const prevPath = previousPathRef.current;

  if (prevPath !== pathname) {
    // 优先级最高：返回/前进导航（popstate）跳过所有入场动画，
    // 匹配浏览器原生返回的瞬时体验，避免和 Router Cache / bfcache 冲突产生"立即出现再闪一下"的错觉。
    if (popNavPendingRef.current) {
      popNavPendingRef.current = false;
      directionRef.current = 0;
      shouldAnimateRef.current = false;
      transitionTypeRef.current = 'none';
    } else {
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
  // 移动端检测：移动端 GPU 合成 transform 位移动画开销大
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  // iOS PWA standalone 检测：WKWebView 合成层 bug 需降级动画
  const isStandalone = typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
     (window.navigator as any).standalone === true);

  // 根据过渡类型选择进入动画配置
  const getInitialAnimation = () => {
    if (!shouldAnimate) return false;
    
    if (transitionType === 'slide') {
      // iOS PWA / 移动端: 纯 opacity 过渡，避免 transform 引发合成层闪烁
      if (isMobile || isStandalone) {
        return { opacity: 0 };
      }
      return { 
        x: direction > 0 ? '5%' : '-5%', 
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
    // slide 类型: 跳过 exit 动画，瞬间消失，仅 enter 有动画（避免移动端掉帧）
    return undefined;
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={getInitialAnimation()}
        animate={{ 
          x: 0, 
          y: 0,
          scale: 1,
          opacity: 1 
        }}
        exit={getExitAnimation()}
        transition={{
          type: 'tween',
          duration: shouldAnimate ? (transitionType === 'fade' ? 0.35 : 0.15) : 0,
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
