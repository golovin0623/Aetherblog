'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Globe, LayoutList, Hexagon } from 'lucide-react';
import { useLocalStorage, useIsMobile } from '@aetherblog/hooks';
import FriendCard from '../components/FriendCard';
import FriendIconBubble from '../components/FriendIconBubble';
import { FriendLink } from '../lib/services';

type ViewMode = 'list' | 'icon';

// Apple Watch 风格蜂窝网格参数
const ICON_MOBILE = 52;
const ICON_DESKTOP = 64;
const HONEYCOMB_GAP = 12;
const COLS_MOBILE = 4;
const COLS_DESKTOP = 6;

// 胶囊切换器内边距 (对应 p-0.5 / p-1)
const TOGGLE_PADDING_MOBILE = 2;
const TOGGLE_PADDING_DESKTOP = 4;

interface FriendsListProps {
  initialFriends: FriendLink[];
}

export default function FriendsList({ initialFriends }: FriendsListProps) {
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>('friends-view-mode', 'list');
  const isMobile = useIsMobile();

  // 防止 SSR 水合不匹配：服务端始终渲染 list，客户端挂载后再切换到 localStorage 中保存的模式
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => { setHasMounted(true); }, []);
  const activeMode: ViewMode = hasMounted ? viewMode : 'list';

  const handleSetList = useCallback(() => setViewMode('list'), [setViewMode]);
  const handleSetIcon = useCallback(() => setViewMode('icon'), [setViewMode]);

  const iconSize = isMobile ? ICON_MOBILE : ICON_DESKTOP;
  const cols = isMobile ? COLS_MOBILE : COLS_DESKTOP;

  // 构建蜂窝行：偶数行 N 个，奇数行 N-1 个，justify-center 自动产生错位效果
  const iconRows = useMemo(() => {
    const rows: FriendLink[][] = [];
    let idx = 0;
    let isFullRow = true;
    while (idx < initialFriends.length) {
      const count = isFullRow ? cols : Math.max(cols - 1, 1);
      rows.push(initialFriends.slice(idx, idx + count));
      idx += count;
      isFullRow = !isFullRow;
    }
    return rows;
  }, [initialFriends, cols]);

  return (
    <div className="min-h-screen bg-background text-[var(--text-primary)] selection:bg-primary/30">
      <main className="max-w-6xl mx-auto px-4 pt-24 pb-24 md:pb-12">
        {/* 背景环境光 */}
        <div className="fixed top-0 left-0 right-0 h-[500px] pointer-events-none -z-10">
          <div
            className="absolute top-[-100px] right-1/4 w-[600px] h-[500px] bg-primary/10 rounded-full theme-transition-glow"
            style={{
              filter: 'blur(var(--ambient-glow-blur))',
              opacity: 'var(--ambient-glow-opacity)'
            }}
          />
          <div
            className="absolute top-1/4 left-0 w-[400px] h-[400px] bg-blue-500/10 rounded-full theme-transition-glow"
            style={{
              filter: 'blur(var(--ambient-glow-blur))',
              opacity: 'var(--ambient-glow-opacity)'
            }}
          />
        </div>
        
        {/* 页面头部 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10 flex flex-row items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <h1 className="text-xl sm:text-3xl font-bold text-[var(--text-primary)] flex items-center gap-2 sm:gap-3 mb-1 sm:mb-3">
              <Users className="w-6 h-6 sm:w-8 sm:h-8 text-primary flex-shrink-0" />
              友情链接
            </h1>
            <p className="text-[var(--text-muted)] text-sm sm:text-lg hidden sm:block">
              这里是我的朋友们，欢迎交换友链！
            </p>
          </div>

          {/* 视图模式切换 - 胶囊式滑动切换器 */}
          {initialFriends.length > 0 && (
            <div role="group" aria-label="视图模式切换" className="flex items-center p-0.5 sm:p-1 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] backdrop-blur-sm flex-shrink-0 relative">
              {/* 滑动胶囊指示器 */}
              <motion.div
                className="absolute top-0.5 sm:top-1 bottom-0.5 sm:bottom-1 rounded-full bg-primary/20"
                initial={false}
                animate={{
                  left: activeMode === 'list' ? (isMobile ? TOGGLE_PADDING_MOBILE : TOGGLE_PADDING_DESKTOP) : '50%',
                  width: isMobile ? `calc(50% - ${TOGGLE_PADDING_MOBILE}px)` : `calc(50% - ${TOGGLE_PADDING_DESKTOP}px)`,
                }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
              <button
                type="button"
                onClick={handleSetList}
                aria-label="列表视图"
                aria-pressed={activeMode === 'list'}
                className={`relative z-10 flex items-center justify-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] ${
                  activeMode === 'list'
                    ? 'text-primary'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">列表</span>
              </button>
              <button
                type="button"
                onClick={handleSetIcon}
                aria-label="气泡视图"
                aria-pressed={activeMode === 'icon'}
                className={`relative z-10 flex items-center justify-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] ${
                  activeMode === 'icon'
                    ? 'text-primary'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Hexagon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">气泡</span>
              </button>
            </div>
          )}
        </motion.div>

        {initialFriends.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)] gap-4"
          >
            <div className="w-16 h-16 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center">
              <Globe className="w-8 h-8 opacity-50" />
            </div>
            <p>暂无友链，稍后再来看看吧</p>
          </motion.div>
        ) : (
          <AnimatePresence mode="wait">
            {activeMode === 'list' ? (
              <motion.div
                key="list"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
              >
                {initialFriends.map((friend, index) => (
                  <motion.div
                    key={friend.id}
                    initial={{ opacity: 0, y: isMobile ? 8 : 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: isMobile ? 0.25 : 0.4,
                      delay: isMobile ? Math.min(index * 0.03, 0.3) : index * 0.1,
                    }}
                  >
                    <FriendCard
                      name={friend.name}
                      url={friend.url}
                      avatar={friend.logo || ''}
                      description={friend.description}
                      themeColor={friend.themeColor}
                      index={index}
                    />
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="icon"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.3 }}
                className="relative py-4 md:py-8"
              >
                {/* 中心环境光 */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[50%] h-[60%] bg-primary/[0.04] rounded-full blur-[100px] pointer-events-none" />

                {/* 蜂窝网格 */}
                <div
                  className="relative flex flex-col items-center"
                  style={{ gap: `${isMobile ? 6 : 8}px` }}
                >
                  {iconRows.map((row, rowIdx) => {
                    const baseIdx = iconRows
                      .slice(0, rowIdx)
                      .reduce((sum, r) => sum + r.length, 0);
                    return (
                      <div
                        key={rowIdx}
                        className="flex justify-center"
                        style={{ gap: `${HONEYCOMB_GAP}px` }}
                      >
                        {row.map((friend, colIdx) => (
                          <FriendIconBubble
                            key={friend.id}
                            name={friend.name}
                            url={friend.url}
                            avatar={friend.logo || ''}
                            description={friend.description}
                            themeColor={friend.themeColor}
                            index={baseIdx + colIdx}
                            isMobile={isMobile}
                            size={iconSize}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {/* 友链申请行动号召 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-16 text-center"
        >
          <p className="text-[var(--text-muted)] text-sm">
            想要交换友链？请在
            <a 
              href="https://github.com/golovin0623/Aetherblog/issues" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline mx-1"
            >
              GitHub Issues
            </a>
            提交申请
          </p>
        </motion.div>
      </main>
    </div>
  );
}
