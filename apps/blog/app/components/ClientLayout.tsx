'use client';

import { TransitionProvider, PageTransition } from './PageTransition';
import VisitTracker from './VisitTracker';
import { ScrollToTop } from './ScrollToTop';
import { ReactNode } from 'react';

/**
 * 客户端布局包装器
 * 包含 TransitionProvider 以持久化页面过渡状态
 * 包含 PageTransition 以提供全局页面切换动画
 * 包含 VisitTracker 以记录页面访问统计
 */
export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
      <TransitionProvider>
        <VisitTracker />
        <ScrollToTop />
        <div id="main-content" className="focus:outline-none" tabIndex={-1}>
          <PageTransition>
            {children}
          </PageTransition>
        </div>
      </TransitionProvider>
  );
}
