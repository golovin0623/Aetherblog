'use client';

import { TransitionProvider, PageTransition } from './PageTransition';
import VisitTracker from './VisitTracker';
import { ScrollToTop } from './ScrollToTop';
import { ReactNode, useEffect } from 'react';

/**
 * 客户端布局包装器
 * 包含 TransitionProvider 以持久化页面过渡状态
 * 包含 PageTransition 以提供全局页面切换动画
 * 包含 VisitTracker 以记录页面访问统计
 */
export default function ClientLayout({ children }: { children: ReactNode }) {
  // 全局锚点链接平滑滚动：拦截 <a href="#xxx"> 的点击事件，
  // 用 JS scrollIntoView({ behavior: 'smooth' }) 替代 CSS scroll-behavior: smooth。
  // 这样 Next.js 路由切换时 scrollTo(0,0) 依然是瞬时跳转，不会干扰页面过渡动画。
  useEffect(() => {
    const handleAnchorClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const id = anchor.getAttribute('href')?.slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        // 尊重用户的减少运动偏好 —— 前庭功能障碍/恐动症用户跳转改为瞬时
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });

        // 键盘焦点管理：滚动后把焦点移到目标元素，避免 Tab 焦点回到页面顶部
        // 不可聚焦的目标临时挂 tabIndex="-1"，blur 后清理保持 DOM 干净
        const hadTabIndex = target.hasAttribute('tabindex');
        if (!hadTabIndex) {
          target.setAttribute('tabindex', '-1');
          target.addEventListener(
            'blur',
            () => target.removeAttribute('tabindex'),
            { once: true },
          );
        }
        target.focus({ preventScroll: true });
      }
    };
    document.addEventListener('click', handleAnchorClick);
    return () => document.removeEventListener('click', handleAnchorClick);
  }, []);

  return (
      <TransitionProvider>
        <VisitTracker />
        <ScrollToTop />
        <div id="main-content" className="focus:outline-2 focus:outline-primary/30 focus:outline-offset-[-2px] focus:rounded-sm" tabIndex={-1}>
          <PageTransition>
            {children}
          </PageTransition>
        </div>
      </TransitionProvider>
  );
}
