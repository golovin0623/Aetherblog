'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings2, Search } from 'lucide-react';
import { ThemeToggle } from '@aetherblog/hooks';
import MobileMenu from './MobileMenu';
import MobileNavSwitch from './MobileNavSwitch';
import { SearchPanel } from './SearchPanel';
import { buildAdminUrl, getAdminLinkConfig, reportAdminLinkIssueOnce } from '../lib/adminUrl';

/**
 * 博客共享头部组件
 * - 在所有页面显示统一样式
 * - 在文章详情页 (/posts/[slug]) 自动隐藏，鼠标靠近顶部时显示
 * - 响应式设计：桌面端显示完整导航，移动端显示汉堡菜单
 * - 乐观更新：点击切换按钮立即更新 UI，不等待路由完成
 */
export default function BlogHeader() {
  const pathname = usePathname();
  const router = useRouter();

  const isTimelinePage = pathname === '/timeline';
  const isPostsPage = pathname === '/posts';
  const isArticleDetail = pathname.startsWith('/posts/') && pathname !== '/posts';
  const adminLinkConfig = getAdminLinkConfig();
  const adminHomeUrl = buildAdminUrl('/');
  const isAdminLinkAvailable = Boolean(adminHomeUrl);

  // 导航页面类型
  type NavPage = 'posts' | 'timeline' | 'archives' | 'friends' | 'about' | null;

  // 当前激活的导航页面（用于乐观更新）
  const [activePage, setActivePage] = useState<NavPage>(() => {
    if (pathname === '/timeline') return 'timeline';
    if (pathname === '/posts') return 'posts';
    if (pathname === '/archives') return 'archives';
    if (pathname === '/friends') return 'friends';
    if (pathname === '/about') return 'about';
    return null;
  });

  // 使用 sessionStorage 记住用户的来源页面（首页/时间线切换器专用）
  const [activeTab, setActiveTab] = useState<'posts' | 'timeline'>('posts');

  // 同步 pathname 到状态（用于浏览器前进/后退等情况）
  useEffect(() => {
    // 更新 activePage
    if (pathname === '/timeline') {
      setActivePage('timeline');
      setActiveTab('timeline');
      sessionStorage.setItem('blogNavSource', 'timeline');
    } else if (pathname === '/posts') {
      setActivePage('posts');
      setActiveTab('posts');
      sessionStorage.setItem('blogNavSource', 'posts');
    } else if (pathname === '/archives') {
      setActivePage('archives');
    } else if (pathname === '/friends') {
      setActivePage('friends');
    } else if (pathname === '/about') {
      setActivePage('about');
    } else if (isArticleDetail) {
      setActivePage(null);
      const source = sessionStorage.getItem('blogNavSource');
      setActiveTab(source === 'timeline' ? 'timeline' : 'posts');
    } else {
      setActivePage(null);
    }
  }, [pathname, isArticleDetail]);

  useEffect(() => {
    reportAdminLinkIssueOnce();
  }, []);

  // 乐观更新：点击时立即切换 UI 状态，然后触发路由导航
  const handleNavClick = useCallback((target: NavPage) => {
    if (!target) return;

    // 立即更新 UI 状态（乐观更新）
    setActivePage(target);

    // 首页/时间线切换器状态同步
    if (target === 'posts' || target === 'timeline') {
      setActiveTab(target);
      sessionStorage.setItem('blogNavSource', target);
    }

    // 路由映射
    const routes: Record<NonNullable<NavPage>, string> = {
      posts: '/posts',
      timeline: '/timeline',
      archives: '/archives',
      friends: '/friends',
      about: '/about',
    };

    // 直接导航（不使用 startTransition，确保立即触发）
    router.push(routes[target]);
  }, [router]);

  const isTimeline = activeTab === 'timeline';

  // 鼠标位置状态
  // Optimization: Use useRef for spotlight to avoid re-renders on mouse move
  const spotlightRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);

  const [isVisible, setIsVisible] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  // Optimization: Use useRef for scroll position to avoid re-renders and listener thrashing
  const lastScrollYRef = useRef(0);

  // Stable handlers for search panel using useCallback
  const openSearchPanel = useCallback(() => {
    setIsSearchOpen(true);
  }, []);

  const closeSearchPanel = useCallback(() => {
    setIsSearchOpen(false);
  }, []);

  // 全局快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K 切换搜索面板
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }

      // / 键打开搜索 (如果不是在输入框中)
      if (e.key === '/' && !isSearchOpen) {
        const target = e.target as HTMLElement;
        const isTyping =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable;

        if (!isTyping) {
          e.preventDefault();
          setIsSearchOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen]);

  // 文章详情页显隐初始化：不再进入详情页后自动收折
  useEffect(() => {
    if (!isArticleDetail) {
      setIsVisible(true);
      return;
    }

    setIsVisible(true);
    lastScrollYRef.current = window.scrollY;
  }, [isArticleDetail, pathname]);

  // 滚动隐藏逻辑 - 上滑手势（页面向下滚动）触发收折，向上滚动恢复
  useEffect(() => {
    if (!isArticleDetail) return;

    let rafId: number | null = null;

    const handleScroll = () => {
      if (rafId) return;

      rafId = requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;
        const lastScrollY = lastScrollYRef.current;

        // 靠近顶部时始终显示
        if (currentScrollY < 100) {
          setIsVisible(true);
        } else if (currentScrollY > lastScrollY + 18) {
          // 手指上滑（内容下行）超过阈值后收折
          setIsVisible(false);
        } else if (currentScrollY < lastScrollY - 28) {
          // 内容上行时恢复
          setIsVisible(true);
        }

        lastScrollYRef.current = currentScrollY;
        rafId = null;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isArticleDetail]);

  // Clean up animation frame on unmount
  useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  // 监听鼠标移动，更新光束位置和显隐状态
  const updateMousePosition = useCallback((e: React.MouseEvent) => {
    if (!spotlightRef.current) return;

    // 获取 header 元素的位置
    const { clientX, clientY, currentTarget } = e;

    // Cancel previous frame if any
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
    }

    // Schedule update
    frameRef.current = requestAnimationFrame(() => {
      if (!spotlightRef.current) {
        frameRef.current = 0;
        return;
      }
      const rect = currentTarget.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      spotlightRef.current.style.background = `radial-gradient(600px circle at ${x}px ${y}px, var(--spotlight-color), transparent 40%)`;
      frameRef.current = 0;
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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-md focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
      >
        跳转到主要内容
      </a>
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
        className={`fixed top-0 left-0 w-screen z-50 py-4 transition-all duration-300 ease-out will-change-transform group ${isVisible ? 'translate-y-0 opacity-100' : '-translate-y-[110%] opacity-0'
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
          ref={spotlightRef}
          data-testid="blog-header-spotlight"
          className="absolute inset-0 pointer-events-none transition-opacity duration-500"
          style={{
            // background is managed by updateMousePosition via ref
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

          {/* 移动端视图切换 - 居中 */}


          {/* 桌面端导航 */}
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0 ml-auto">
            {/* 移动端视图切换 - 右对齐且稳定 */}
            <div className="md:hidden flex items-center justify-center gap-2">
              <button
                type="button"
                aria-label="搜索"
                onClick={openSearchPanel}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Search className="w-4 h-4" />
              </button>
              <MobileNavSwitch />
            </div>

            {/* 桌面端导航 */}
            <nav className="hidden md:flex gap-6 items-center">
              {/* iOS 21 风格分段控制器 */}
              <div
                role="group"
                aria-label="视图模式"
                className="relative flex items-center rounded-[14px] p-[3px] backdrop-blur-2xl bg-black/[0.08] dark:bg-white/[0.08] shadow-[0_1px_3px_rgba(0,0,0,0.12),inset_0_0.5px_1px_rgba(255,255,255,0.5)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3),inset_0_0.5px_1px_rgba(255,255,255,0.1)]"
              >
                {/* 动画胶囊 - 真实 iOS 风格 */}
                <div
                  className="absolute top-[3px] bottom-[3px] w-[76px] rounded-[11px] transition-all duration-[400ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)]"
                  style={{
                    left: isTimeline ? 'calc(50% - 3px)' : '3px',
                  }}
                >
                  {/* 亮色模式胶囊 - 纯白带微阴影 */}
                  <div
                    className="absolute inset-0 rounded-[11px] dark:opacity-0 opacity-100 transition-opacity duration-200"
                    style={{
                      background: 'linear-gradient(180deg, #ffffff 0%, #fafafa 100%)',
                      boxShadow: '0 3px 8px rgba(0,0,0,0.12), 0 1px 1px rgba(0,0,0,0.08), inset 0 0 0 0.5px rgba(0,0,0,0.04)',
                    }}
                  />
                  {/* 暗色模式胶囊 - 微白光晕 */}
                  <div
                    className="absolute inset-0 rounded-[11px] opacity-0 dark:opacity-100 transition-opacity duration-200"
                    style={{
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.10) 100%)',
                      boxShadow: '0 3px 8px rgba(0,0,0,0.24), 0 1px 1px rgba(0,0,0,0.16), inset 0 0 0 0.5px rgba(255,255,255,0.1)',
                    }}
                  />
                </div>

                {/* Segment Buttons - 使用 button + handleNavClick 实现乐观更新 */}
                <button
                  type="button"
                  aria-pressed={!isTimeline}
                  onClick={() => handleNavClick('posts')}
                  className={`relative z-10 w-[76px] text-center py-[7px] rounded-[11px] text-[13px] font-semibold tracking-[-0.01em] transition-all duration-200 cursor-pointer ${!isTimeline
                      ? 'text-black dark:text-white'
                      : 'text-black/60 hover:text-black/70 dark:text-white/60 dark:hover:text-white/70'
                    }`}
                >
                  首页
                </button>
                <button
                  type="button"
                  aria-pressed={isTimeline}
                  onClick={() => handleNavClick('timeline')}
                  className={`relative z-10 w-[76px] text-center py-[7px] rounded-[11px] text-[13px] font-semibold tracking-[-0.01em] transition-all duration-200 cursor-pointer ${isTimeline
                      ? 'text-black dark:text-white'
                      : 'text-black/60 hover:text-black/70 dark:text-white/60 dark:hover:text-white/70'
                    }`}
                >
                  时间线
                </button>
              </div>

              <div className="h-4 w-px bg-[var(--border-default)] mx-2"></div>
              <button
                onClick={() => handleNavClick('archives')}
                className={`relative text-sm font-medium transition-all duration-200 hover:text-primary cursor-pointer ${activePage === 'archives'
                    ? 'text-primary'
                    : 'text-[var(--text-secondary)]'
                  }`}
              >
                归档
                {activePage === 'archives' && (
                  <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </button>
              <button
                onClick={() => handleNavClick('friends')}
                className={`relative text-sm font-medium transition-all duration-200 hover:text-primary cursor-pointer ${activePage === 'friends'
                    ? 'text-primary'
                    : 'text-[var(--text-secondary)]'
                  }`}
              >
                友链
                {activePage === 'friends' && (
                  <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </button>
              <button
                onClick={() => handleNavClick('about')}
                className={`relative text-sm font-medium transition-all duration-200 hover:text-primary cursor-pointer ${activePage === 'about'
                    ? 'text-primary'
                    : 'text-[var(--text-secondary)]'
                  }`}
              >
                关于
                {activePage === 'about' && (
                  <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </button>

              {/* 管理后台入口 */}
              <div className="h-4 w-px bg-[var(--border-default)] mx-1"></div>

              {/* 搜索按钮 */}
              <button
                type="button"
                aria-label="搜索"
                title="Search (⌘ K)"
                onClick={openSearchPanel}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-transparent hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all duration-300 group/search"
              >
                <Search className="w-4 h-4 group-hover/search:scale-110 transition-transform" />
              </button>

              {/* 主题切换 */}
              <ThemeToggle size="sm" />

              {isAdminLinkAvailable ? (
                <a
                  href={adminHomeUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center w-8 h-8 rounded-full bg-transparent hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all duration-300 group/admin"
                  title="管理后台"
                  aria-label="管理后台"
                >
                  <Settings2 className="w-4 h-4 group-hover/admin:rotate-90 transition-transform duration-500" />
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-label="管理后台未配置"
                  title={`管理后台未配置：${adminLinkConfig.reason}`}
                  className="flex items-center justify-center w-8 h-8 rounded-full bg-transparent text-[var(--text-muted)] opacity-50 cursor-not-allowed"
                >
                  <Settings2 className="w-4 h-4" />
                </button>
              )}
            </nav>

            {/* 移动端导航 */}
            <MobileMenu />
          </div>
        </div>
      </header>

      <SearchPanel isOpen={isSearchOpen} onClose={closeSearchPanel} />
    </>
  );
}
