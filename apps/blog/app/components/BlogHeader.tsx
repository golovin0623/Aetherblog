'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';

/**
 * 博客共享头部组件
 * - 在所有页面显示统一样式
 * - 在文章详情页 (/posts/[slug]) 自动隐藏，鼠标靠近顶部时显示
 */
export default function BlogHeader() {
  const pathname = usePathname();
  const isTimeline = pathname === '/timeline';
  const isArticleDetail = pathname.startsWith('/posts/') && pathname !== '/posts';
  
  // 鼠标位置状态
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isVisible, setIsVisible] = useState(true);
  const [isHovering, setIsHovering] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);

  // 文章详情页自动隐藏逻辑
  useEffect(() => {
    if (!isArticleDetail) {
      setIsVisible(true);
      return;
    }

    // 进入文章详情页后 2 秒自动隐藏（原来 3 秒，减少 30%）
    const timer = setTimeout(() => {
      if (!isHovering) {
        setIsVisible(false);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [isArticleDetail, isHovering, pathname]);

  // 滚动隐藏逻辑 - 下滑隐藏，上滑或靠近顶部时显示
  useEffect(() => {
    if (!isArticleDetail) return;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // 靠近顶部时始终显示
      if (currentScrollY < 100) {
        setIsVisible(true);
      } else if (currentScrollY > lastScrollY + 10) {
        // 下滑超过 10px 时隐藏
        setIsVisible(false);
      } else if (currentScrollY < lastScrollY - 30) {
        // 上滑超过 30px 时显示
        setIsVisible(true);
      }
      
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isArticleDetail, lastScrollY]);

  // 监听鼠标移动，更新光束位置和显隐状态
  const updateMousePosition = useCallback((e: React.MouseEvent) => {
    // 获取 header 元素的位置
    const header = e.currentTarget.getBoundingClientRect();
    setMousePosition({
      x: e.clientX - header.left,
      y: e.clientY - header.top,
    });
    
    // 确保在 header 上移动时也标记为 hovering
    if (isArticleDetail) {
      setIsHovering(true);
    }
  }, [isArticleDetail]);

  // 全局鼠标监听 - 用于触发显示和重置状态
  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (!isArticleDetail) return;
    
    // 鼠标在顶部 60px 区域内时显示
    if (e.clientY < 60) {
      if (!isHovering) setIsHovering(true);
      if (!isVisible) setIsVisible(true);
    } else if (e.clientY > 120) {
      // 鼠标离开顶部区域一定距离后，标记为不再悬停
      // 这会触发 useEffect 中的 2秒倒计时隐藏
      if (isHovering) setIsHovering(false);
    }
  }, [isArticleDetail, isHovering, isVisible]);

  useEffect(() => {
    if (isArticleDetail) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      return () => window.removeEventListener('mousemove', handleGlobalMouseMove);
    }
  }, [isArticleDetail, handleGlobalMouseMove]);

  return (
    <>
      {/* 顶部感应区域 - 文章详情页时始终存在 */}
      {isArticleDetail && (
        <div 
          className="fixed top-0 left-0 right-0 h-4 z-[60]"
          onMouseEnter={() => {
            setIsHovering(true);
            setIsVisible(true);
          }}
        />
      )}

      <header 
        className={`fixed top-0 left-0 right-0 z-50 py-4 transition-all duration-500 ease-out overflow-hidden group ${
          isVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
        }`}
        style={{
          // 基础背景
          background: 'rgba(10, 10, 15, 0.6)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        }}
        onMouseMove={updateMousePosition}
        onMouseEnter={() => isArticleDetail && setIsHovering(true)}
        onMouseLeave={() => isArticleDetail && setIsHovering(false)}
      >
        {/* 聚光灯效果层 */}
        <div 
          className="absolute inset-0 pointer-events-none transition-opacity duration-500"
          style={{
            background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(99, 102, 241, 0.15), transparent 40%)`,
            opacity: isHovering || !isArticleDetail ? 1 : 0,
          }}
        />
        
        {/* 顶部高亮线条 - 增强立体感 */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between relative z-10">
          <Link href="/" className="flex items-center gap-2 group/logo">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-white font-bold text-lg group-hover/logo:shadow-[0_0_20px_rgba(124,58,237,0.5)] transition-shadow">
              A
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              AetherBlog
            </span>
          </Link>
          
          <nav className="flex gap-6 items-center">
            {/* View Mode Toggle with sliding animation */}
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
            
            <div className="h-4 w-px bg-white/10 mx-2 hidden md:block"></div>
            <Link href="/archives" className="text-gray-400 hover:text-white transition-colors text-sm font-medium">归档</Link>
            <Link href="/friends" className="text-gray-400 hover:text-white transition-colors text-sm font-medium">友链</Link>
            <Link href="/about" className="text-gray-400 hover:text-white transition-colors text-sm font-medium">关于</Link>
          </nav>
        </div>
      </header>
    </>
  );
}
