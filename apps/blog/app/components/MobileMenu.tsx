'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Settings2, Home, Clock, Archive, Link as LinkIcon, Info } from 'lucide-react';

/**
 * 移动端导航菜单组件
 * - 汉堡菜单按钮
 * - 全屏下拉抽屉
 * - 包含所有导航链接和管理后台入口
 */
export default function MobileMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

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

  const navLinks = [
    { href: '/posts', label: '首页', icon: Home },
    { href: '/timeline', label: '时间线', icon: Clock },
    { href: '/archives', label: '归档', icon: Archive },
    { href: '/friends', label: '友链', icon: LinkIcon },
    { href: '/about', label: '关于', icon: Info },
  ];

  return (
    <div className="md:hidden">
      {/* 汉堡按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-gray-300 hover:text-white transition-colors relative z-50"
        aria-label="Toggle Menu"
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* 菜单抽屉 */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* 背景遮罩 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => setIsOpen(false)}
            />

            {/* 菜单内容 */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 20, stiffness: 100 }}
              className="fixed right-0 top-0 bottom-0 w-64 bg-[#0a0a0f] border-l border-white/10 z-50 p-6 pt-24 shadow-2xl"
            >
              <nav className="flex flex-col gap-6">
                {navLinks.map((link) => {
                  const isActive = pathname === link.href || (link.href === '/posts' && pathname === '/');
                  const Icon = link.icon;
                  
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`flex items-center gap-4 text-lg font-medium transition-colors ${
                        isActive ? 'text-primary' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      <Icon size={20} />
                      {link.label}
                    </Link>
                  );
                })}

                <div className="h-px bg-white/10 my-2" />

                {/* 管理后台链接 */}
                <a
                  href={process.env.NEXT_PUBLIC_ADMIN_URL || "/admin/"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 text-lg font-medium text-gray-400 hover:text-white transition-colors"
                >
                  <Settings2 size={20} />
                  管理后台
                </a>
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
