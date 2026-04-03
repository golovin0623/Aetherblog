'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, FileText, Calendar } from 'lucide-react';
import { logger } from '../lib/logger';

interface ArchivePost {
  id: string;
  title: string;
  slug: string;
  publishedAt: string;
}

interface MonthData {
  month: number;
  posts: ArchivePost[];
}

interface YearData {
  year: number;
  months: MonthData[];
  totalPosts: number;
}

interface TimelineTreeProps {
  archives: YearData[];
}

const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const DEFAULT_VISIBLE_POSTS = 10;

// SessionStorage 键
const STORAGE_KEYS = {
  EXPANDED_YEARS: 'timeline_expanded_years',
  EXPANDED_MONTHS: 'timeline_expanded_months',
  EXPANDED_POSTS_MONTHS: 'timeline_expanded_posts_months',
  LAST_CLICKED_POST: 'timeline_last_clicked_post',
};

// ============================================================================
// 记忆化组件
// ============================================================================

const PostItem = React.memo(({
  post,
  isHighlighted,
  isHighlightFading,
  handlePostClick,
  fadeOpacity
}: {
  post: ArchivePost;
  isHighlighted: boolean;
  isHighlightFading: boolean;
  handlePostClick: (id: string) => void;
  fadeOpacity: string;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Link
        href={`/posts/${post.slug}`}
        onClick={() => handlePostClick(post.id)}
        className={`group flex items-center gap-2 py-1.5 px-2 rounded-md transition-all transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] ${isHighlighted
          ? `${isHighlightFading ? 'duration-1000 bg-transparent ring-0 opacity-100 translate-x-0' : 'duration-300 bg-primary/15 ring-1 ring-primary/40 translate-x-1'}`
          : `duration-200 hover:bg-[var(--bg-card-hover)] hover:translate-x-1 ${fadeOpacity}`
          }`}
      >
        <FileText className={`h-4 w-4 transition-colors ${isHighlighted ? 'text-primary' : 'text-[var(--text-muted)] group-hover:text-primary'
          }`} />
        <span className={`flex-1 text-sm font-serif truncate transition-colors ${isHighlighted ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
          }`}>
          {post.title}
        </span>
        <span className="text-xs font-serif italic text-[var(--text-muted)]">
          {new Date(post.publishedAt).getDate()}日
        </span>
      </Link>
    </motion.div>
  );
});
PostItem.displayName = 'PostItem';

const MonthSection = React.memo(({
  year,
  monthData,
  isExpanded,
  toggleMonth,
  showAllPosts,
  toggleShowAllPosts,
  highlightedPostId,
  isHighlightFading,
  handlePostClick
}: {
  year: number;
  monthData: MonthData;
  isExpanded: boolean;
  toggleMonth: (yearMonth: string) => void;
  showAllPosts: boolean;
  toggleShowAllPosts: (yearMonth: string) => void;
  highlightedPostId: string | null;
  isHighlightFading: boolean;
  handlePostClick: (id: string) => void;
}) => {
  const yearMonth = `${year}-${monthData.month}`;
  const hasMorePosts = monthData.posts.length > DEFAULT_VISIBLE_POSTS;
  const visiblePosts = showAllPosts
    ? monthData.posts
    : monthData.posts.slice(0, DEFAULT_VISIBLE_POSTS);
  const hiddenCount = monthData.posts.length - DEFAULT_VISIBLE_POSTS;

  return (
    <div>
      {/* 月份节点 */}
      <button
        onClick={() => toggleMonth(yearMonth)}
        aria-expanded={isExpanded}
        aria-controls={`timeline-month-${yearMonth}`}
        className="group flex items-center gap-2.5 w-full text-left py-1.5 px-2.5 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-subtle)] hover:border-primary/20 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
      >
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-primary/70" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-primary/70" />
          )}
        </div>
        <Calendar className="h-3.5 w-3.5 text-primary/50" />
        <span className="text-sm font-medium font-serif text-[var(--text-primary)]">{MONTH_NAMES[monthData.month - 1]}</span>
        <span className="ml-auto px-1.5 py-0.5 rounded-full text-[11px] font-serif italic bg-[var(--bg-secondary)] text-[var(--text-muted)]">
          {monthData.posts.length} 篇
        </span>
      </button>

      {/* 文章列表 - 带动画 */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            id={`timeline-month-${yearMonth}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1 ml-4 md:ml-8 space-y-1 relative">
              {visiblePosts.map((post, index) => {
                const shouldFade = hasMorePosts && !showAllPosts;
                const isSecondLast = index === visiblePosts.length - 2;
                const isLast = index === visiblePosts.length - 1;
                const fadeOpacity = shouldFade
                  ? (isLast ? 'opacity-40' : isSecondLast ? 'opacity-70' : '')
                  : '';

                return (
                  <PostItem
                    key={post.id}
                    post={post}
                    isHighlighted={highlightedPostId === post.id}
                    isHighlightFading={isHighlightFading}
                    handlePostClick={handlePostClick}
                    fadeOpacity={fadeOpacity}
                  />
                );
              })}

              {/* 展开/收起 - 仅箭头图标 */}
              {hasMorePosts && (
                <motion.div
                  className="flex justify-center pt-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <button
                    onClick={() => toggleShowAllPosts(yearMonth)}
                    className="group p-1.5 rounded-full hover:bg-[var(--bg-card-hover)] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
                    title={showAllPosts ? '收起' : `还有 ${hiddenCount} 篇`}
                  >
                    <motion.div
                      animate={{ rotate: showAllPosts ? 180 : 0 }}
                      transition={{ duration: 0.3, ease: 'easeInOut' }}
                    >
                      <ChevronDown className="h-4 w-4 text-gray-500 group-hover:text-primary" />
                    </motion.div>
                  </button>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
MonthSection.displayName = 'MonthSection';

const YearSection = React.memo(({
  yearData,
  isExpanded,
  toggleYear,
  expandedMonths,
  toggleMonth,
  expandedPostsMonths,
  toggleShowAllPosts,
  highlightedPostId,
  isHighlightFading,
  handlePostClick,
  animationDelay
}: {
  yearData: YearData;
  isExpanded: boolean;
  toggleYear: (year: number) => void;
  expandedMonths: Set<string>;
  toggleMonth: (yearMonth: string) => void;
  expandedPostsMonths: Set<string>;
  toggleShowAllPosts: (yearMonth: string) => void;
  highlightedPostId: string | null;
  isHighlightFading: boolean;
  handlePostClick: (id: string) => void;
  animationDelay: string;
}) => {
  return (
    <div
      className="relative"
      style={{ animationDelay }}
    >
      {/* 年份节点 */}
      <button
        onClick={() => toggleYear(yearData.year)}
        aria-expanded={isExpanded}
        aria-controls={`timeline-year-${yearData.year}`}
        className="group flex items-center gap-3 w-full text-left py-2 px-3 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-subtle)] hover:border-primary/30 transition-all duration-200 transform hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
      >
        {/* 展开时带脉冲动画的节点 */}
        <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 text-primary group-hover:bg-primary/30 transition-colors">
          {/* 展开时的脉冲环动画 */}
          {isExpanded && (
            <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping" style={{ animationDuration: '2s' }} />
          )}
          {isExpanded ? (
            <ChevronDown className="h-5 w-5 relative z-10" />
          ) : (
            <ChevronRight className="h-5 w-5 relative z-10" />
          )}
        </div>
        <span className="text-xl font-bold font-serif text-[var(--text-primary)] group-hover:text-primary/90 transition-colors">{yearData.year}</span>
        <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-serif italic bg-[var(--bg-secondary)] text-[var(--text-muted)] group-hover:bg-primary/20 group-hover:text-primary/80 transition-colors">
          {yearData.totalPosts} 篇
        </span>
      </button>

      {/* 月份列表 */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            id={`timeline-year-${yearData.year}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 ml-2 pl-2 md:ml-4 md:pl-4 border-l-2 border-[var(--border-subtle)] space-y-2">
              {yearData.months.map((monthData) => {
                const yearMonth = `${yearData.year}-${monthData.month}`;
                const isMonthExpanded = expandedMonths.has(yearMonth);
                const showAllPosts = expandedPostsMonths.has(yearMonth);

                return (
                  <MonthSection
                    key={yearMonth}
                    year={yearData.year}
                    monthData={monthData}
                    isExpanded={isMonthExpanded}
                    toggleMonth={toggleMonth}
                    showAllPosts={showAllPosts}
                    toggleShowAllPosts={toggleShowAllPosts}
                    highlightedPostId={highlightedPostId}
                    isHighlightFading={isHighlightFading}
                    handlePostClick={handlePostClick}
                  />
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}, (prevProps, nextProps) => {
  // 自定义比较函数，防止不必要的重渲染
  // 仅在以下情况重渲染：
  // 1. 年份数据变更（引用或内容）
  // 2. 本年份的 isExpanded 变更
  // 3. 本年度内月份展开状态变更
  // 4. 其他相关 props 变更（highlightedPostId、isHighlightFading）

  // 检查原始值/稳定 props 是否变更
  if (
    prevProps.yearData !== nextProps.yearData ||
    prevProps.isExpanded !== nextProps.isExpanded ||
    prevProps.highlightedPostId !== nextProps.highlightedPostId ||
    prevProps.isHighlightFading !== nextProps.isHighlightFading ||
    prevProps.animationDelay !== nextProps.animationDelay ||
    prevProps.toggleYear !== nextProps.toggleYear ||
    prevProps.toggleMonth !== nextProps.toggleMonth ||
    prevProps.toggleShowAllPosts !== nextProps.toggleShowAllPosts ||
    prevProps.handlePostClick !== nextProps.handlePostClick
  ) {
    return false; // props 已变更，需要重渲染
  }

  // 检查本年度内月份展开状态是否变更
  const { year, months } = nextProps.yearData;
  for (const monthData of months) {
    const yearMonth = `${year}-${monthData.month}`;
    const prevMonthExpanded = prevProps.expandedMonths.has(yearMonth);
    const nextMonthExpanded = nextProps.expandedMonths.has(yearMonth);
    const prevShowAllPosts = prevProps.expandedPostsMonths.has(yearMonth);
    const nextShowAllPosts = nextProps.expandedPostsMonths.has(yearMonth);

    if (prevMonthExpanded !== nextMonthExpanded || prevShowAllPosts !== nextShowAllPosts) {
      return false; // 月份状态已变更，需要重渲染
    }
  }

  return true; // 无相关变更，跳过重渲染
});
YearSection.displayName = 'YearSection';

// ============================================================================
// 主组件
// ============================================================================

export const TimelineTree: React.FC<TimelineTreeProps> = ({ archives }) => {
  // 默认：展开所有年份
  const allYears = useMemo(() => new Set(archives.map(a => a.year)), [archives]);
  const allMonths = useMemo(() => {
    const set = new Set<string>();
    archives.forEach(y => y.months.forEach(m => set.add(`${y.year}-${m.month}`)));
    return set;
  }, [archives]);

  // 从 sessionStorage 恢复状态，或使用默认值 (初始渲染必须与 SSR 一致)
  const [expandedYears, setExpandedYears] = useState<Set<number>>(allYears);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(allMonths);
  const [expandedPostsMonths, setExpandedPostsMonths] = useState<Set<string>>(new Set());
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);
  const [isHighlightFading, setIsHighlightFading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // 在稳定回调中访问的 refs
  const expandedYearsRef = useRef(expandedYears);
  const expandedMonthsRef = useRef(expandedMonths);
  const expandedPostsMonthsRef = useRef(expandedPostsMonths);

  useEffect(() => {
    expandedYearsRef.current = expandedYears;
    expandedMonthsRef.current = expandedMonths;
    expandedPostsMonthsRef.current = expandedPostsMonths;
  }, [expandedYears, expandedMonths, expandedPostsMonths]);

  // 组件挂载时从 sessionStorage 恢复状态 (仅限从文章详情返回时)
  useEffect(() => {
    setIsMounted(true);

    try {
      // 只有存在 "返回导航" 标记时才恢复状态
      const shouldRestore = sessionStorage.getItem('timeline_should_restore');
      if (!shouldRestore) {
        // 刷新或直接访问：清除所有旧状态
        sessionStorage.removeItem(STORAGE_KEYS.EXPANDED_YEARS);
        sessionStorage.removeItem(STORAGE_KEYS.EXPANDED_MONTHS);
        sessionStorage.removeItem(STORAGE_KEYS.EXPANDED_POSTS_MONTHS);
        sessionStorage.removeItem(STORAGE_KEYS.LAST_CLICKED_POST);
        return;
      }

      // 恢复状态
      const savedYears = sessionStorage.getItem(STORAGE_KEYS.EXPANDED_YEARS);
      const savedMonths = sessionStorage.getItem(STORAGE_KEYS.EXPANDED_MONTHS);
      const savedPostsMonths = sessionStorage.getItem(STORAGE_KEYS.EXPANDED_POSTS_MONTHS);
      const lastClickedPost = sessionStorage.getItem(STORAGE_KEYS.LAST_CLICKED_POST);

      if (savedYears) setExpandedYears(new Set(JSON.parse(savedYears)));
      if (savedMonths) setExpandedMonths(new Set(JSON.parse(savedMonths)));
      if (savedPostsMonths) setExpandedPostsMonths(new Set(JSON.parse(savedPostsMonths)));

      // 高亮上次点击的文章，带渐隐效果
      if (lastClickedPost) {
        setHighlightedPostId(lastClickedPost);
        setIsHighlightFading(false);
        // 1.5秒后开始渐隐
        setTimeout(() => setIsHighlightFading(true), 1500);
        // 渐隐动画结束后移除高亮 (动画持续 1 秒)
        setTimeout(() => setHighlightedPostId(null), 2500);
      }

      // 清除所有状态（一次性使用）
      sessionStorage.removeItem('timeline_should_restore');
      sessionStorage.removeItem(STORAGE_KEYS.EXPANDED_YEARS);
      sessionStorage.removeItem(STORAGE_KEYS.EXPANDED_MONTHS);
      sessionStorage.removeItem(STORAGE_KEYS.EXPANDED_POSTS_MONTHS);
      sessionStorage.removeItem(STORAGE_KEYS.LAST_CLICKED_POST);
    } catch (e) {
      logger.warn('Failed to restore timeline state:', e);
    }
  }, []);

  // 保存状态到 sessionStorage (Stable callback)
  const saveState = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      // 设置 "应该恢复" 标记
      sessionStorage.setItem('timeline_should_restore', 'true');
      sessionStorage.setItem(STORAGE_KEYS.EXPANDED_YEARS, JSON.stringify([...expandedYearsRef.current]));
      sessionStorage.setItem(STORAGE_KEYS.EXPANDED_MONTHS, JSON.stringify([...expandedMonthsRef.current]));
      sessionStorage.setItem(STORAGE_KEYS.EXPANDED_POSTS_MONTHS, JSON.stringify([...expandedPostsMonthsRef.current]));
    } catch (e) {
      logger.warn('Failed to save timeline state:', e);
    }
  }, []);

  // 点击文章时保存状态 (Stable callback)
  const handlePostClick = useCallback((postId: string) => {
    saveState();
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEYS.LAST_CLICKED_POST, postId);
    }
  }, [saveState]);

  // 稳定的折叠切换处理器
  const toggleYear = useCallback((year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  }, []);

  const toggleMonth = useCallback((yearMonth: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(yearMonth)) {
        next.delete(yearMonth);
      } else {
        next.add(yearMonth);
      }
      return next;
    });
  }, []);

  const toggleShowAllPosts = useCallback((yearMonth: string) => {
    setExpandedPostsMonths((prev) => {
      const next = new Set(prev);
      if (next.has(yearMonth)) {
        next.delete(yearMonth);
      } else {
        next.add(yearMonth);
      }
      return next;
    });
  }, []);

  if (!isMounted) {
    // 渲染前在 SSR 时确保静态占位内容或者直接透出默认内容避免 mismatch
  }

  return (
    <div className="space-y-4">
      {archives.map((yearData, yearIndex) => (
        <YearSection
          key={yearData.year}
          yearData={yearData}
          isExpanded={expandedYears.has(yearData.year)}
          toggleYear={toggleYear}
          expandedMonths={expandedMonths}
          toggleMonth={toggleMonth}
          expandedPostsMonths={expandedPostsMonths}
          toggleShowAllPosts={toggleShowAllPosts}
          highlightedPostId={highlightedPostId}
          isHighlightFading={isHighlightFading}
          handlePostClick={handlePostClick}
          animationDelay={`${yearIndex * 100}ms`}
        />
      ))}

      {archives.length === 0 && (
        <div className="text-center py-12">
          <Calendar className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-4" />
          <p className="text-[var(--text-secondary)]">暂无归档文章</p>
        </div>
      )}
    </div>
  );
};

export default TimelineTree;
