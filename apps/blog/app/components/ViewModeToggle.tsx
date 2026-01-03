'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * 视图模式切换组件
 * 具有滑动胶囊动画效果的首页/时间线切换器
 */
export default function ViewModeToggle() {
  const pathname = usePathname();
  const isTimeline = pathname === '/timeline';

  return (
    <div className="hidden md:flex items-center bg-white/5 rounded-full p-1 border border-white/5 relative">
      {/* Sliding pill indicator */}
      <div
        className="absolute top-1 bottom-1 w-[72px] bg-primary/20 rounded-full transition-all duration-300 ease-out"
        style={{
          left: isTimeline ? 'calc(50% + 2px)' : '4px',
        }}
      />
      
      {/* Links - fixed width to prevent layout shift */}
      <Link
        href="/posts"
        className={`relative z-10 w-[72px] text-center py-1.5 rounded-full text-sm font-medium transition-colors duration-300 ${
          !isTimeline ? 'text-primary' : 'text-gray-400 hover:text-white'
        }`}
      >
        首页
      </Link>
      <Link
        href="/timeline"
        className={`relative z-10 w-[72px] text-center py-1.5 rounded-full text-sm font-medium transition-colors duration-300 ${
          isTimeline ? 'text-primary' : 'text-gray-400 hover:text-white'
        }`}
      >
        时间线
      </Link>
    </div>
  );
}
