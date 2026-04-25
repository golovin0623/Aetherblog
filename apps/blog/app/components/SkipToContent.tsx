import React from 'react';

/**
 * 跳至内容组件 (Skip to content)
 * 为键盘导航用户提供快速跳过导航栏，直接访问主要内容的便捷方式。
 * 默认在视觉上隐藏，只有当键盘聚焦时才会显示在屏幕顶部。
 */
export default function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="fixed left-4 top-4 z-[9999] -translate-y-24 rounded-md bg-[var(--bg-primary)] px-4 py-3 font-medium text-primary shadow-lg ring-1 ring-[var(--border-default)] transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[var(--bg-primary)]"
    >
      跳至主要内容
    </a>
  );
}
