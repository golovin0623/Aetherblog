'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, FileText, Calendar } from 'lucide-react';

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
const DEFAULT_VISIBLE_POSTS = 5;

export const TimelineTree: React.FC<TimelineTreeProps> = ({ archives }) => {
  // Default: all years expanded
  const allYears = useMemo(() => new Set(archives.map(a => a.year)), [archives]);
  const [expandedYears, setExpandedYears] = useState<Set<number>>(allYears);
  
  // Default: all months expanded
  const allMonths = useMemo(() => {
    const set = new Set<string>();
    archives.forEach(y => y.months.forEach(m => set.add(`${y.year}-${m.month}`)));
    return set;
  }, [archives]);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(allMonths);

  // Track which months have "show all" enabled
  const [expandedPostsMonths, setExpandedPostsMonths] = useState<Set<string>>(new Set());

  const toggleYear = (year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  };

  const toggleMonth = (yearMonth: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(yearMonth)) {
        next.delete(yearMonth);
      } else {
        next.add(yearMonth);
      }
      return next;
    });
  };

  const toggleShowAllPosts = (yearMonth: string) => {
    setExpandedPostsMonths((prev) => {
      const next = new Set(prev);
      if (next.has(yearMonth)) {
        next.delete(yearMonth);
      } else {
        next.add(yearMonth);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {archives.map((yearData, yearIndex) => {
        const isYearExpanded = expandedYears.has(yearData.year);

        return (
          <div
            key={yearData.year}
            className="relative"
            style={{ animationDelay: `${yearIndex * 100}ms` }}
          >
            {/* 年份节点 */}
            <button
              onClick={() => toggleYear(yearData.year)}
              className="group flex items-center gap-3 w-full text-left py-2 px-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 text-primary">
                {isYearExpanded ? (
                  <ChevronDown className="h-5 w-5" />
                ) : (
                  <ChevronRight className="h-5 w-5" />
                )}
              </div>
              <span className="text-xl font-bold text-white">{yearData.year}</span>
              <span className="ml-auto px-2 py-0.5 rounded-full text-xs bg-white/10 text-gray-400">
                {yearData.totalPosts} 篇
              </span>
            </button>

            {/* 月份列表 */}
            {isYearExpanded && (
              <div className="mt-2 ml-4 pl-4 border-l-2 border-white/10 space-y-2">
                {yearData.months.map((monthData) => {
                  const yearMonth = `${yearData.year}-${monthData.month}`;
                  const isMonthExpanded = expandedMonths.has(yearMonth);
                  const showAllPosts = expandedPostsMonths.has(yearMonth);
                  const hasMorePosts = monthData.posts.length > DEFAULT_VISIBLE_POSTS;
                  const visiblePosts = showAllPosts 
                    ? monthData.posts 
                    : monthData.posts.slice(0, DEFAULT_VISIBLE_POSTS);
                  const hiddenCount = monthData.posts.length - DEFAULT_VISIBLE_POSTS;

                  return (
                    <div key={yearMonth}>
                      {/* 月份节点 */}
                      <button
                        onClick={() => toggleMonth(yearMonth)}
                        className="group flex items-center gap-2 w-full text-left py-1.5 px-2 rounded-md hover:bg-white/5 transition-colors"
                      >
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-white/5 group-hover:bg-white/10 transition-colors">
                          {isMonthExpanded ? (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-gray-400" />
                          )}
                        </div>
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <span className="text-gray-300">{MONTH_NAMES[monthData.month - 1]}</span>
                        <span className="ml-auto text-xs text-gray-500">
                          {monthData.posts.length} 篇
                        </span>
                      </button>

                      {/* 文章列表 */}
                      {isMonthExpanded && (
                        <div className="mt-1 ml-8 space-y-1 relative">
                          {visiblePosts.map((post, index) => {
                            // 计算淡出效果：当有更多文章且未展开时，倒数第2个和最后一个逐渐变淡
                            const shouldFade = hasMorePosts && !showAllPosts;
                            const isSecondLast = index === visiblePosts.length - 2;
                            const isLast = index === visiblePosts.length - 1;
                            const fadeOpacity = shouldFade 
                              ? (isLast ? 'opacity-40' : isSecondLast ? 'opacity-70' : '')
                              : '';
                            
                            return (
                              <Link
                                key={post.id}
                                href={`/posts/${post.slug}`}
                                className={`group flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-white/5 transition-all duration-300 ${fadeOpacity}`}
                              >
                                <FileText className="h-4 w-4 text-gray-500 group-hover:text-primary transition-colors" />
                                <span className="flex-1 text-sm text-gray-400 group-hover:text-white truncate transition-colors">
                                  {post.title}
                                </span>
                                <span className="text-xs text-gray-600">
                                  {new Date(post.publishedAt).getDate()}日
                                </span>
                              </Link>
                            );
                          })}
                          
                          {/* 展开/收起更多文章 - 居中优雅设计 */}
                          {hasMorePosts && (
                            <div className="flex justify-center pt-2 pb-1">
                              <button
                                onClick={() => toggleShowAllPosts(yearMonth)}
                                className="group flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 hover:border-primary/30 hover:bg-primary/10 backdrop-blur-sm transition-all duration-300"
                              >
                                <span className={`transition-transform duration-300 ${showAllPosts ? 'rotate-180' : ''}`}>
                                  <ChevronDown className="h-3.5 w-3.5 text-gray-500 group-hover:text-primary" />
                                </span>
                                <span className="text-xs font-medium text-gray-400 group-hover:text-primary transition-colors">
                                  {showAllPosts ? '收起' : `展开更多 ${hiddenCount} 篇`}
                                </span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {archives.length === 0 && (
        <div className="text-center py-12">
          <Calendar className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500">暂无归档文章</p>
        </div>
      )}
    </div>
  );
};

export default TimelineTree;
