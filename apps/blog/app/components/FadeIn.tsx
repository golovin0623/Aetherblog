'use client';

import { ReactNode } from 'react';

interface FadeInProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
}

/**
 * 淡入动画包装组件 - 纯 CSS 版本
 * 无需等待 JS 库加载，动画立即生效，零卡顿
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
      
      {/* 内联 CSS keyframes - 确保样式立即可用 */}
      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
