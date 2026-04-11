'use client';

import { ReactNode } from 'react';

interface FadeInProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
}

/**
 * 淡入动画包装组件
 * 使用 globals.css 中定义的全局 @keyframes fadeInUp
 * 避免每个组件实例注入 <style> 标签（iOS WKWebView 中多个 <style> 注入会引发重排）
 *
 * data-fade-in 标记用于在返回/前进导航（popstate）时让 globals.css 精准禁用入场动画，
 * 避免和 Router Cache / bfcache 已经恢复的内容冲突产生"立即出现再闪一下"的错觉。
 */
export default function FadeIn({
  children,
  className = '',
  delay = 0,
  duration = 0.5
}: FadeInProps) {
  return (
    <div
      data-fade-in
      className={className}
      style={{
        animation: `fadeInUp ${duration}s ease-out ${delay}s both`,
      }}
    >
      {children}
    </div>
  );
}
