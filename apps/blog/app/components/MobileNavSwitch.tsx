'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * 移动端专用导航切换器
 * 放弃复杂的滑动动画，使用最稳健的 CSS 类名切换
 * 解决路由跳转时的布局偏移问题
 */
export default function MobileNavSwitch() {
  const pathname = usePathname();
  const isTimeline = pathname === '/timeline';

  return (
    <div className="flex items-center bg-[var(--bg-secondary)] rounded-full p-1 border border-[var(--border-subtle)] flex-shrink-0">
      <Link
        href="/posts"
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
          !isTimeline 
            ? 'bg-primary text-white shadow-sm' 
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
      >
        首页
      </Link>
      <Link
        href="/timeline"
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
          isTimeline 
            ? 'bg-primary text-white shadow-sm' 
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
      >
        时间线
      </Link>
    </div>
  );
}
