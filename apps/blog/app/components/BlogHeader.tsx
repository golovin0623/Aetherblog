'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { Settings2 } from 'lucide-react';
import { ThemeToggle } from '@aetherblog/hooks';
import MobileMenu from './MobileMenu';
import MobileNavSwitch from './MobileNavSwitch';

/**
 * 博客共享头部组件
 * - 在所有页面显示统一样式
 * - 在文章详情页 (/posts/[slug]) 自动隐藏，鼠标靠近顶部时显示
 * - 响应式设计：桌面端显示完整导航，移动端显示汉堡菜单
 */
export default function BlogHeader() {
  const pathname = usePathname();
  const isTimelinePage = pathname === '/timeline';
  const isPostsPage = pathname === '/posts';
  const isArticleDetail = pathname.startsWith('/posts/') && pathname !== '/posts';
  
  // 使用 sessionStorage 记住用户的来源页面
  // 当从时间线进入文章详情时，切换器仍显示"时间线"为选中状态
  const [activeTab, setActiveTab] = useState<'posts' | 'timeline'>('posts');
  
  useEffect(() => {
    if (isTimelinePage) {
      // 用户在时间线页面，记住这个状态
      sessionStorage.setItem('blogNavSource', 'timeline');
      setActiveTab('timeline');
    } else if (isPostsPage) {
      // 用户在首页/文章列表页面
      sessionStorage.setItem('blogNavSource', 'posts');
      setActiveTab('posts');
    } else if (isArticleDetail) {
      // 在文章详情页，使用之前记住的状态
      const source = sessionStorage.getItem('blogNavSource');
      setActiveTab(source === 'timeline' ? 'timeline' : 'posts');
    }
  }, [pathname, isTimelinePage, isPostsPage, isArticleDetail]);
  
  const isTimeline = activeTab === 'timeline';
  
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

    // 进入文章详情页后 2 秒自动隐藏
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
        className={`fixed top-0 left-0 w-screen z-50 py-4 transition-all duration-500 ease-out group ${
          isVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
        }`}
        style={{
          background: 'var(--bg-overlay)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border-subtle)',
          boxShadow: '0 4px 24px -8px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        }}
        onMouseMove={updateMousePosition}
        onMouseEnter={() => isArticleDetail && setIsHovering(true)}
        onMouseLeave={() => isArticleDetail && setIsHovering(false)}
      >
        {/* 聚光灯效果层 - 使用 CSS 变量 */}
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-500"
          style={{
            background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, var(--spotlight-color), transparent 40%)`,
            opacity: isHovering || !isArticleDetail ? 'var(--spotlight-opacity)' : 0,
          }}
        />

        {/* 顶部高亮线条 - 使用 CSS 变量增强立体感 */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{
            background: `linear-gradient(to right, transparent, var(--highlight-line), transparent)`
          }}
        />

        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between relative z-10">
          <Link href="/" className="flex items-center gap-2 group/logo">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-white font-bold text-lg group-hover/logo:shadow-[var(--shadow-primary-lg)] transition-shadow flex-shrink-0">
              A
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-[var(--text-primary)] to-[var(--text-muted)] bg-clip-text text-transparent">
              AetherBlog
            </span>
          </Link>

          {/* Mobile View Toggle - Centered */}

          
          {/* Desktop Navigation */}
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0 ml-auto">
            {/* Mobile View Toggle - Right Aligned & Stable */}
            <div className="md:hidden flex items-center justify-center">
              <MobileNavSwitch />
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex gap-6 items-center">
              {/* iOS 21 Style Segmented Control */}
              <div className="relative flex items-center rounded-[14px] p-[3px] backdrop-blur-2xl bg-black/[0.08] dark:bg-white/[0.08] shadow-[0_1px_3px_rgba(0,0,0,0.12),inset_0_0.5px_1px_rgba(255,255,255,0.5)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3),inset_0_0.5px_1px_rgba(255,255,255,0.1)]">
                {/* Animated Pill - True iOS Style */}
                <div
                  className="absolute top-[3px] bottom-[3px] w-[76px] rounded-[11px] transition-all duration-[400ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)]"
                  style={{
                    left: isTimeline ? 'calc(50% - 3px)' : '3px',
                  }}
                >
                  {/* Light theme pill - Pure white with subtle shadow */}
                  <div
                    className="absolute inset-0 rounded-[11px] dark:opacity-0 opacity-100 transition-opacity duration-200"
                    style={{
                      background: 'linear-gradient(180deg, #ffffff 0%, #fafafa 100%)',
                      boxShadow: '0 3px 8px rgba(0,0,0,0.12), 0 1px 1px rgba(0,0,0,0.08), inset 0 0 0 0.5px rgba(0,0,0,0.04)',
                    }}
                  />
                  {/* Dark theme pill - Subtle white glow */}
                  <div
                    className="absolute inset-0 rounded-[11px] opacity-0 dark:opacity-100 transition-opacity duration-200"
                    style={{
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.10) 100%)',
                      boxShadow: '0 3px 8px rgba(0,0,0,0.24), 0 1px 1px rgba(0,0,0,0.16), inset 0 0 0 0.5px rgba(255,255,255,0.1)',
                    }}
                  />
                </div>

                {/* Segment Buttons */}
                <Link
                  href="/posts"
                  className={`relative z-10 w-[76px] text-center py-[7px] rounded-[11px] text-[13px] font-semibold tracking-[-0.01em] transition-all duration-200 ${
                    !isTimeline
                      ? 'text-black dark:text-white'
                      : 'text-black/60 hover:text-black/70 dark:text-white/60 dark:hover:text-white/70'
                  }`}
                >
                  首页
                </Link>
                <Link
                  href="/timeline"
                  className={`relative z-10 w-[76px] text-center py-[7px] rounded-[11px] text-[13px] font-semibold tracking-[-0.01em] transition-all duration-200 ${
                    isTimeline
                      ? 'text-black dark:text-white'
                      : 'text-black/60 hover:text-black/70 dark:text-white/60 dark:hover:text-white/70'
                  }`}
                >
                  时间线
                </Link>
              </div>

              <div className="h-4 w-px bg-[var(--border-default)] mx-2"></div>
              <Link
                href="/archives"
                className={`relative text-sm font-medium transition-all duration-200 hover:text-primary ${
                  pathname === '/archives'
                    ? 'text-primary'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                归档
                {pathname === '/archives' && (
                  <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </Link>
              <Link
                href="/friends"
                className={`relative text-sm font-medium transition-all duration-200 hover:text-primary ${
                  pathname === '/friends'
                    ? 'text-primary'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                友链
                {pathname === '/friends' && (
                  <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </Link>
              <Link
                href="/about"
                className={`relative text-sm font-medium transition-all duration-200 hover:text-primary ${
                  pathname === '/about'
                    ? 'text-primary'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                关于
                {pathname === '/about' && (
                  <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </Link>
              
              {/* 管理后台入口 */}
              <div className="h-4 w-px bg-[var(--border-default)] mx-1"></div>
              
              {/* 主题切换 */}
              <ThemeToggle size="sm" />
              
              <a 
                href={process.env.NEXT_PUBLIC_ADMIN_URL || "/admin/"} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center justify-center w-8 h-8 rounded-full bg-transparent hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all duration-300 group/admin"
                title="管理后台"
              >
                <Settings2 className="w-4 h-4 group-hover/admin:rotate-90 transition-transform duration-500" />
              </a>
            </nav>

            {/* Mobile Navigation */}
            <MobileMenu />
          </div>
        </div>
      </header>
    </>
  );
}
