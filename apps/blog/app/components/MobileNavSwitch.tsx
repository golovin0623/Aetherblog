'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';

/** 每个 segment 的固定宽度（px） */
const SEGMENT_W = 64;

/**
 * 移动端专用导航切换器
 * iOS 风格分段控制器，滑动胶囊动画 + 乐观更新
 * 使用 GPU 加速的 transform 而非 left，保障移动端流畅度
 */
export default function MobileNavSwitch() {
  const pathname = usePathname();
  const router = useRouter();

  // 本地状态用于乐观更新
  const [activeTab, setActiveTab] = useState<'posts' | 'timeline'>(
    pathname === '/timeline' ? 'timeline' : 'posts'
  );

  // 同步 pathname 到 activeTab（用于浏览器前进/后退等情况）
  useEffect(() => {
    if (pathname === '/timeline') {
      setActiveTab('timeline');
    } else if (pathname === '/posts') {
      setActiveTab('posts');
    }
    // 文章详情页保持当前状态不变
  }, [pathname]);

  // 乐观更新：点击时立即切换 UI 状态，然后触发路由导航
  const handleNavClick = useCallback((target: 'posts' | 'timeline') => {
    // 立即更新 UI 状态（乐观更新）
    setActiveTab(target);
    sessionStorage.setItem('blogNavSource', target);

    // 直接导航（不使用 startTransition，确保立即触发）
    router.push(target === 'timeline' ? '/timeline' : '/posts');
  }, [router]);

  const isTimeline = activeTab === 'timeline';

  return (
    <div
      role="group"
      aria-label="视图模式"
      className="relative flex items-center rounded-[12px] p-[2px] backdrop-blur-2xl bg-black/[0.08] dark:bg-white/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.10),inset_0_0.5px_1px_rgba(255,255,255,0.4)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),inset_0_0.5px_1px_rgba(255,255,255,0.08)] flex-shrink-0"
    >
      {/* 滑动胶囊指示器 - 使用 transform 实现 GPU 加速动画 */}
      <div
        className="absolute top-[2px] bottom-[2px] rounded-[10px] will-change-transform motion-reduce:transition-none"
        style={{
          width: SEGMENT_W,
          transition: 'transform 380ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          transform: isTimeline ? `translateX(${SEGMENT_W}px)` : 'translateX(0)',
        }}
      >
        {/* 亮色模式胶囊 */}
        <div
          className="absolute inset-0 rounded-[10px] dark:opacity-0 opacity-100 transition-opacity duration-200"
          style={{
            background: 'linear-gradient(180deg, #ffffff 0%, #fafafa 100%)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.10), 0 1px 1px rgba(0,0,0,0.06), inset 0 0 0 0.5px rgba(0,0,0,0.04)',
          }}
        />
        {/* 暗色模式胶囊 */}
        <div
          className="absolute inset-0 rounded-[10px] opacity-0 dark:opacity-100 transition-opacity duration-200"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.20), 0 1px 1px rgba(0,0,0,0.14), inset 0 0 0 0.5px rgba(255,255,255,0.08)',
          }}
        />
      </div>

      {/* Segment Buttons */}
      <Link
        href="/posts"
        aria-pressed={!isTimeline}
        aria-current={!isTimeline ? 'page' : undefined}
        onClick={(e) => {
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            handleNavClick('posts');
          }
        }}
        className={`relative z-10 text-center py-[6px] rounded-[10px] text-[12px] font-semibold tracking-[-0.01em] transition-colors duration-200 cursor-pointer ${
          !isTimeline
            ? 'text-black dark:text-white'
            : 'text-black/50 dark:text-white/50'
        }`}
        style={{ width: SEGMENT_W }}
      >
        首页
      </Link>
      <Link
        href="/timeline"
        aria-pressed={isTimeline}
        aria-current={isTimeline ? 'page' : undefined}
        onClick={(e) => {
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            handleNavClick('timeline');
          }
        }}
        className={`relative z-10 text-center py-[6px] rounded-[10px] text-[12px] font-semibold tracking-[-0.01em] transition-colors duration-200 cursor-pointer ${
          isTimeline
            ? 'text-black dark:text-white'
            : 'text-black/50 dark:text-white/50'
        }`}
        style={{ width: SEGMENT_W }}
      >
        时间线
      </Link>
    </div>
  );
}
