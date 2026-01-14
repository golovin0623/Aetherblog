'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * 访问追踪组件
 * 用于记录页面访问到后端统计系统
 */
export default function VisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    // 从路径中提取 postId（如果是文章页）
    const postIdMatch = pathname.match(/\/posts\/(\d+)/);
    const postId = postIdMatch ? parseInt(postIdMatch[1], 10) : null;

    // 异步记录访问，不阻塞页面渲染
    const recordVisit = async () => {
      try {
        await fetch('/api/v1/public/visit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            path: pathname,
            postId: postId,
          }),
        });
      } catch (error) {
        // 静默失败，不影响用户体验
        console.debug('Failed to record visit:', error);
      }
    };

    // 仅在客户端执行
    if (typeof window !== 'undefined') {
      recordVisit();
    }
  }, [pathname]);

  return null; // 不渲染任何 UI
}
