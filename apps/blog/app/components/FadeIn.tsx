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
 */
export default function FadeIn({ 
  children, 
  className = '',
  delay = 0,
  duration = 0.5 
}: FadeInProps) {
  return (
    <div
      className={className}
      style={{
        animation: `fadeInUp ${duration}s ease-out ${delay}s both`,
      }}
    >
      {children}
    </div>
  );
}
