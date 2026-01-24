'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X, Settings2, Home, Clock, Archive, Link as LinkIcon, Info, Sun, Moon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getSiteSettings } from '../lib/services';
import { extractSocialLinks } from '../lib/socialLinks';
import { useTheme } from '@aetherblog/hooks';

// 导航页面类型
type NavPage = 'posts' | 'timeline' | 'archives' | 'friends' | 'about' | null;

/**
 * 移动端导航菜单组件
 * - 汉堡菜单按钮
 * - 使用 Portal 将菜单抽屉渲染到 body，避免被 header overflow 裁剪
 * - 乐观更新：点击立即切换高亮状态，不等待路由完成
 */
export default function MobileMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { isDark, toggleThemeWithAnimation } = useTheme();

  // 当前激活的导航页面（用于乐观更新）
  const [activePage, setActivePage] = useState<NavPage>(() => {
    if (pathname === '/timeline') return 'timeline';
    if (pathname === '/posts') return 'posts';
    if (pathname === '/archives') return 'archives';
    if (pathname === '/friends') return 'friends';
    if (pathname === '/about') return 'about';
    return null;
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: settings } = useQuery({
    queryKey: ['siteSettings'],
    queryFn: getSiteSettings,
    staleTime: 10 * 60 * 1000 // 10 mins
  });

  const authorName = settings?.author_name || settings?.authorName || 'Golovin';
  const authorAvatar = settings?.author_avatar || settings?.authorAvatar || 'https://github.com/shadcn.png';
  const authorBio = settings?.author_bio || settings?.authorBio || '一只小凉凉';
  const socialLinks = useMemo(() => extractSocialLinks(settings), [settings]);

  // 同步 pathname 到 activePage（用于浏览器前进/后退等情况）
  useEffect(() => {
    if (pathname === '/timeline') {
      setActivePage('timeline');
    } else if (pathname === '/posts') {
      setActivePage('posts');
    } else if (pathname === '/archives') {
      setActivePage('archives');
    } else if (pathname === '/friends') {
      setActivePage('friends');
    } else if (pathname === '/about') {
      setActivePage('about');
    } else {
      setActivePage(null);
    }
  }, [pathname]);

  // 路由变化时自动关闭菜单
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // 禁止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // 乐观更新：点击时立即切换 UI 状态，然后触发路由导航
  const handleNavClick = useCallback((target: NavPage) => {
    if (!target) return;

    // 立即更新 UI 状态（乐观更新）
    setActivePage(target);

    // 路由映射
    const routes: Record<NonNullable<NavPage>, string> = {
      posts: '/posts',
      timeline: '/timeline',
      archives: '/archives',
      friends: '/friends',
      about: '/about',
    };

    // 关闭菜单
    setIsOpen(false);

    // 直接导航（不使用 startTransition，确保立即触发）
    router.push(routes[target]);
  }, [router]);

  const navLinks = [
    { href: '/posts', label: '首页', icon: Home, key: 'posts' as NavPage },
    { href: '/timeline', label: '时间线', icon: Clock, key: 'timeline' as NavPage },
    { href: '/archives', label: '归档', icon: Archive, key: 'archives' as NavPage },
    { href: '/friends', label: '友链', icon: LinkIcon, key: 'friends' as NavPage },
    { href: '/about', label: '关于', icon: Info, key: 'about' as NavPage },
  ];

  // 菜单抽屉内容 - 使用 Portal 渲染到 body
  const menuDrawer = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
            onClick={() => setIsOpen(false)}
          />

          {/* 菜单抽屉 - 高级通透玻璃质感 (主题自适应) */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-48 bg-[var(--bg-overlay)] backdrop-blur-2xl border-l border-[var(--border-default)] z-[101] flex flex-col shadow-2xl overflow-y-auto"
          >
            {/* 1. 顶部区域：个人资料 (去除了强分割线) */}
            <div className="p-6 pb-2 relative bg-gradient-to-b from-[var(--bg-card)]/50 to-transparent">
              <div className="mt-6 flex flex-col items-center text-center">
                <div className="relative w-14 h-14 mb-2 group">
                  <div className="absolute inset-0 bg-gradient-to-tr from-primary to-purple-500 rounded-full blur-md opacity-50 group-hover:opacity-80 transition-opacity" />
                  <div className="relative w-full h-full rounded-full overflow-hidden border-2 border-[var(--border-default)] group-hover:border-primary transition-colors">
                    <img
                      src={authorAvatar}
                      alt={authorName}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
                <h3 className="text-black dark:text-[var(--text-primary)] font-bold text-sm mb-0.5">{authorName}</h3>
                <p className="text-black/60 dark:text-[var(--text-muted)] text-xs leading-relaxed line-clamp-3">
                  {authorBio}
                </p>
              </div>
            </div>

            {/* 2. 社交链接 - 强对比黑字 */}
            <div className="px-4 py-4">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] w-full justify-items-start">
                {socialLinks.length > 0 ? (
                  socialLinks.map((link) => {
                    const icon = link.iconUrl ? (
                      <img
                        src={link.iconUrl}
                        alt={link.label}
                        className="w-3 h-3 object-contain"
                      />
                    ) : (
                      <span className="w-3 h-3 rounded-full bg-[var(--bg-secondary)] text-[8px] flex items-center justify-center text-[var(--text-muted)]">
                        {link.label.slice(0, 1).toUpperCase()}
                      </span>
                    );

                    const linkClass = "w-full flex items-center justify-start gap-1.5 text-left px-2 py-1.5 rounded-lg text-black dark:text-[var(--text-muted)] hover:text-black dark:hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-[var(--bg-card-hover)] transition-colors";

                    return (
                      <a
                        key={link.id}
                        href={link.href}
                        className={linkClass}
                        target={link.isExternal ? "_blank" : undefined}
                        rel={link.isExternal ? "noopener noreferrer" : undefined}
                        title={link.label}
                      >
                        {icon}
                        <span className="truncate">{link.label}</span>
                      </a>
                    );
                  })
                ) : (
                  <span className="col-span-2 text-center text-[10px] text-[var(--text-muted)]">
                    暂无社交链接，请在后台设置中配置
                  </span>
                )}
              </div>
            </div>

            {/* 4. 导航链接 */}
            <nav className="flex-1 flex flex-col gap-1 p-4">
              {navLinks.filter(link => !['/posts', '/timeline'].includes(link.href)).map((link) => {
                const isActive = activePage === link.key;
                const Icon = link.icon;

                return (
                  <button
                    key={link.href}
                    onClick={() => handleNavClick(link.key)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left w-full cursor-pointer ${
                      isActive
                        ? 'bg-black/10 dark:bg-[var(--primary-light)]/10 text-black dark:text-[var(--color-primary)]'
                        : 'text-black dark:text-[var(--text-muted)] hover:text-black dark:hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-[var(--bg-card-hover)]'
                    }`}
                  >
                    <Icon size={16} />
                    {link.label}
                  </button>
                );
              })}
            </nav>

            {/* 5. 底部固定区域：清爽无边框设计 */}
            <div className="p-4 space-y-2 mt-auto">
              {/* 主题切换按钮 */}
              <button
                onClick={(e) => toggleThemeWithAnimation(e.clientX, e.clientY)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-black dark:text-[var(--text-secondary)] hover:text-black dark:hover:text-[var(--text-primary)] bg-black/5 dark:bg-white/5 border border-transparent dark:border-white/10 hover:bg-black/10 dark:hover:bg-white/10 transition-all shadow-sm"
              >
                {isDark ? <Moon size={16} /> : <Sun size={16} />}
                主题切换
              </button>

              {/* 管理后台 */}
              <a
                href={process.env.NEXT_PUBLIC_ADMIN_URL || "/admin/"}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-black dark:text-[var(--text-secondary)] hover:text-black dark:hover:text-[var(--text-primary)] bg-black/5 dark:bg-white/5 border border-transparent dark:border-white/10 hover:bg-black/10 dark:hover:bg-white/10 transition-all shadow-sm"
              >
                <Settings2 size={16} />
                管理后台
              </a>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <div className="md:hidden">
      {/* 汉堡按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        aria-label="Toggle Menu"
      >
        <Menu size={24} />
      </button>

      {/* 使用 Portal 将抽屉渲染到 body */}
      {mounted && createPortal(menuDrawer, document.body)}
    </div>
  );
}
