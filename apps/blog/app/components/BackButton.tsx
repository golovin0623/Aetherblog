'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

interface BackButtonProps {
  fallbackHref?: string;
  className?: string;
}

/**
 * 返回按钮组件
 * 使用 router.back() 返回上一页，保持浏览历史和滚动位置
 * 标准实现，无需手动遮罩，过渡由全局 PageTransition 处理
 */
export default function BackButton({ 
  fallbackHref = '/posts', 
  className = '' 
}: BackButtonProps) {
  const router = useRouter();

  const handleBack = () => {
    // 检查是否有浏览历史
    // 如果没有（比如直接通过 URL 打开），则跳转到 fallback 页面
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };

  return (
    <button
      onClick={handleBack}
      className={`inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors ${className}`}
    >
      <ArrowLeft className="w-4 h-4" />
      返回
    </button>
  );
}
