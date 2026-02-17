'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';

/**
 * 移动端专用导航切换器
 * 使用乐观更新：点击立即切换 UI 状态，不等待路由完成
 * 解决路由跳转时的按钮卡顿问题
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
      className="flex items-center bg-[var(--bg-secondary)] rounded-full p-1 border border-[var(--border-subtle)] flex-shrink-0"
    >
      <button
        type="button"
        aria-pressed={!isTimeline}
        onClick={() => handleNavClick('posts')}
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer motion-reduce:transition-none ${
          !isTimeline
            ? 'bg-primary text-white shadow-sm'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
      >
        首页
      </button>
      <button
        type="button"
        aria-pressed={isTimeline}
        onClick={() => handleNavClick('timeline')}
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer motion-reduce:transition-none ${
          isTimeline
            ? 'bg-primary text-white shadow-sm'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
      >
        时间线
      </button>
    </div>
  );
}
