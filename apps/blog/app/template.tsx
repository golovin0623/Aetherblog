'use client';

import { PageTransition } from './components/PageTransition';

/**
 * Next.js 模板
 * 每次导航时重新渲染，用于触发页面过渡动画
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
