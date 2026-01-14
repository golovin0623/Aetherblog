'use client';

import { TransitionProvider, PageTransition } from './PageTransition';
import { ReactNode } from 'react';

/**
 * 客户端布局包装器
 * 包含 TransitionProvider 以持久化页面过渡状态
 * 包含 PageTransition 以提供全局页面切换动画
 * 包含 QueryClientProvider (Providers) 以管理数据缓存
 */
export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
      <TransitionProvider>
        <PageTransition>
          {children}
        </PageTransition>
      </TransitionProvider>
  );
}
