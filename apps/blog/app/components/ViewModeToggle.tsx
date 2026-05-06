'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * 视图模式切换组件
 * 具有滑动胶囊动画效果的首页/时间线切换器
 */
const ViewModeToggleBase = ({ compact = false }: { compact?: boolean }) => {
  const pathname = usePathname();
  const isTimeline = pathname === '/timeline';

  // 基于紧凑模式的尺寸
  const widthClass = compact ? 'w-[64px]' : 'w-[72px]';
  const paddingClass = compact ? 'p-0.5' : 'p-1';
  const textClass = compact ? 'text-xs' : 'text-sm';
  const pillInset = compact ? '2px' : '4px';

  // 链接基础样式 —— 焦点环偏移色匹配 Link 的直接父容器背景 (--bg-secondary)，
  // 这样 ring-offset 在视觉上呈现为透明间隙而非异色描边。
  const linkBaseClass = `relative z-10 ${widthClass} text-center py-1.5 rounded-full ${textClass} font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]`;

  return (
    <div
      role="group"
      aria-label="视图模式切换"
      className={`flex items-center bg-[var(--bg-secondary)] rounded-full ${paddingClass} border border-[var(--border-subtle)] relative`}
    >
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
        aria-current={!isTimeline ? 'page' : undefined}
        className={`${linkBaseClass} ${
          !isTimeline ? 'text-primary' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
      >
        首页
      </Link>
      <Link
        href="/timeline"
        aria-current={isTimeline ? 'page' : undefined}
        className={`${linkBaseClass} ${
          isTimeline ? 'text-primary' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
      >
        时间线
      </Link>
    </div>
  );
};

// 使用 React.memo 避免父组件重渲染时引发的无意义重渲染。
const ViewModeToggle = React.memo(ViewModeToggleBase);
export default ViewModeToggle;
