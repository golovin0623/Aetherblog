'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * 视图模式切换组件
 * 具有滑动胶囊动画效果的首页/时间线切换器
 */
export default function ViewModeToggle({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const isTimeline = pathname === '/timeline';

  // 基于紧凑模式的尺寸
  const widthClass = compact ? 'w-[64px]' : 'w-[72px]';
  const paddingClass = compact ? 'p-0.5' : 'p-1';
  const textClass = compact ? 'text-xs' : 'text-sm';
  const pillInset = compact ? '2px' : '4px';

  return (
    <div className={`flex items-center bg-[var(--bg-secondary)] rounded-full ${paddingClass} border border-[var(--border-subtle)] relative`}>
      {/* 滑动药丸指示器 */}
      <div
        className={`absolute top-0.5 bottom-0.5 ${widthClass} bg-primary/20 rounded-full transition-all duration-300 ease-out`}
        style={{
          left: isTimeline ? `calc(50% + ${compact ? '0px' : '2px'})` : pillInset,
        }}
      />
      
      {/* 链接 - 固定宽度防止布局偏移 */}
      <Link
        href="/posts"
        className={`relative z-10 ${widthClass} text-center py-1.5 rounded-full ${textClass} font-medium transition-colors duration-300 ${
          !isTimeline ? 'text-primary' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
      >
        首页
      </Link>
      <Link
        href="/timeline"
        className={`relative z-10 ${widthClass} text-center py-1.5 rounded-full ${textClass} font-medium transition-colors duration-300 ${
          isTimeline ? 'text-primary' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
      >
        时间线
      </Link>
    </div>
  );
}
