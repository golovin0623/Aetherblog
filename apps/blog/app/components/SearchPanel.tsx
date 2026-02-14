'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Loader2, FileText, Folder, Tag, ArrowRight, History, TrendingUp, Sparkles, Clock, Trash2 } from 'lucide-react';
import { logger } from '../lib/logger';

interface SearchResult {
  id: string;
  title: string;
  slug: string;
  highlight?: string;
  category?: string;
  tags?: string[];
  publishedAt: string;
  score?: number;
}

interface AiAnswer {
  answer: string;
  sources?: { title: string; slug: string }[];
}

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const TRENDING_SEARCHES = ['Spring Boot', 'React', 'Docker', 'Kubernetes', 'TypeScript'];

export const SearchPanel: React.FC<SearchPanelProps> = ({ isOpen, onClose }) => {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [aiAnswer, setAiAnswer] = useState<AiAnswer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(true);

  // 加载搜索历史
  useEffect(() => {
    const history = localStorage.getItem('searchHistory');
    if (history) {
      setSearchHistory(JSON.parse(history));
    }
  }, []);

  // 保存搜索历史
  const saveToHistory = useCallback((term: string) => {
    const updated = [term, ...searchHistory.filter((h) => h !== term)].slice(0, 5);
    setSearchHistory(updated);
    localStorage.setItem('searchHistory', JSON.stringify(updated));
  }, [searchHistory]);

  // 清空历史
  const clearHistory = useCallback(() => {
    setSearchHistory([]);
    localStorage.removeItem('searchHistory');
  }, []);

  // 执行搜索
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setAiAnswer(null);
      setShowHistory(true);
      return;
    }

    setIsLoading(true);
    setShowHistory(false);

    try {
      // 模拟API调用
      await new Promise((r) => setTimeout(r, 300));

      // 模拟无结果的情况
      if (searchQuery.toLowerCase().includes('empty') || searchQuery.toLowerCase().includes('null')) {
        setResults([]);
      } else {
        setResults([
          {
            id: '1',
            title: `关于 ${searchQuery} 的技术实践`,
            slug: 'example-post',
            highlight: `这篇文章详细介绍了 ${searchQuery} 的最佳实践...`,
            category: '技术分享',
            tags: [searchQuery, 'Tutorial'],
            publishedAt: '2026-01-01',
            score: 0.95,
          },
        ]);
      }
      setIsLoading(false);

      // AI回答
      setIsAiLoading(true);
      await new Promise((r) => setTimeout(r, 500));
      setAiAnswer({
        answer: `根据博客内容，${searchQuery} 是一个非常重要的技术概念...`,
        sources: [{ title: '相关文章', slug: 'example' }],
      });
      setIsAiLoading(false);
    } catch (error) {
      logger.error('Search error:', error);
      setIsLoading(false);
      setIsAiLoading(false);
    }
  }, []);

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => performSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  // 处理结果点击
  const handleResultClick = useCallback((result: SearchResult) => {
    saveToHistory(query);
    router.push(`/posts/${result.slug}`);
    onClose();
  }, [saveToHistory, query, router, onClose]);

  // 滚动到激活项
  useEffect(() => {
    if (activeIndex >= 0 && resultsRef.current) {
      const activeElement = resultsRef.current.children[activeIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex]);

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : -1));
          break;
        case 'Enter':
          if (activeIndex >= 0 && results[activeIndex]) {
            handleResultClick(results[activeIndex]);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, activeIndex, handleResultClick, onClose]);

  // 搜索结果变化时重置激活项
  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  // 自动聚焦
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* 遮罩层 */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md animate-fadeIn"
      />

      {/* 搜索面板 */}
      <div className="fixed left-1/2 top-[10%] z-50 -translate-x-1/2 w-full max-w-2xl bg-[var(--bg-card)] backdrop-blur-xl rounded-2xl border border-[var(--border-default)] shadow-2xl shadow-black/20 overflow-hidden animate-slideDown">
        {/* 搜索输入框 */}
        <form onSubmit={(e) => e.preventDefault()} className="relative">
          <div className="flex items-center px-4 py-4 border-b border-[var(--border-subtle)]">
            <Search className="h-5 w-5 text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="search-results-list"
              aria-expanded={results.length > 0 && !showHistory}
              aria-activedescendant={activeIndex >= 0 && results[activeIndex] ? `search-result-${results[activeIndex].id}` : undefined}
              aria-label="搜索框"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索文章、标签、分类... (支持自然语言)"
              className="flex-1 mx-3 bg-transparent text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none text-lg"
            />
            {query && (
              <button
                type="button"
                aria-label="清空搜索关键词"
                onClick={() => setQuery('')}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            )}
            {isLoading && <Loader2 className="h-5 w-5 text-primary animate-spin" />}
          </div>
        </form>

        {/* 内容区域 */}
        <div className="max-h-[60vh] overflow-y-auto">
          {/* AI 回答 */}
          {(aiAnswer || isAiLoading) && !showHistory && (
            <div className="border-b border-[var(--border-subtle)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-primary/20">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm font-medium text-primary">AI 智能回答</span>
                {isAiLoading && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
              </div>
              {isAiLoading ? (
                <div className="space-y-2">
                  <div className="h-4 bg-[var(--bg-secondary)] rounded animate-pulse" />
                  <div className="h-4 bg-[var(--bg-secondary)] rounded animate-pulse w-3/4" />
                </div>
              ) : aiAnswer && (
                <p className="text-[var(--text-secondary)] text-sm leading-relaxed">{aiAnswer.answer}</p>
              )}
            </div>
          )}

          {/* 搜索历史 */}
          {showHistory && !query && (
            <div className="p-4 space-y-6">
              {searchHistory.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                      <History className="h-4 w-4" />
                      <span>搜索历史</span>
                    </div>
                    <button onClick={clearHistory} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors">
                      <Trash2 className="h-3 w-3" />
                      清空
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {searchHistory.map((item) => (
                      <button
                        key={item}
                        onClick={() => setQuery(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-all"
                      >
                        <Clock className="h-3 w-3 text-[var(--text-muted)]" />
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 热门搜索 */}
              <div>
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] mb-3">
                  <TrendingUp className="h-4 w-4" />
                  <span>热门搜索</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {TRENDING_SEARCHES.map((item, index) => (
                    <button
                      key={item}
                      onClick={() => setQuery(item)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all"
                    >
                      <span className="text-xs font-bold text-primary/60">{index + 1}</span>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 搜索结果 */}
          {!showHistory && results.length > 0 && (
            <div
              ref={resultsRef}
              id="search-results-list"
              role="listbox"
              className="divide-y divide-[var(--border-subtle)]"
            >
              {results.map((result, index) => (
                <div
                  key={result.id}
                  id={`search-result-${result.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => handleResultClick(result)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex items-start gap-4 px-4 py-4 cursor-pointer transition-colors ${
                    index === activeIndex ? 'bg-[var(--bg-card-hover)]' : 'hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  <div className={`flex-shrink-0 p-2 rounded-lg ${index === activeIndex ? 'bg-primary/20' : 'bg-[var(--bg-secondary)]'}`}>
                    <FileText className={`h-5 w-5 ${index === activeIndex ? 'text-primary' : 'text-[var(--text-muted)]'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className={`font-medium truncate mb-1 ${index === activeIndex ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                      {result.title}
                    </h4>
                    {result.highlight && (
                      <p className="text-sm text-[var(--text-muted)] line-clamp-2 mb-2">{result.highlight}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                      {result.category && (
                        <span className="flex items-center gap-1">
                          <Folder className="h-3 w-3" />
                          {result.category}
                        </span>
                      )}
                      <span>{result.publishedAt}</span>
                      {result.score && (
                        <span className="px-1.5 py-0.5 rounded text-primary border border-primary/30 text-xs">
                          匹配度 {Math.round(result.score * 100)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowRight className={`flex-shrink-0 h-5 w-5 transition-transform ${index === activeIndex ? 'text-primary translate-x-1' : 'text-[var(--text-muted)]'}`} />
                </div>
              ))}
            </div>
          )}

          {/* 无结果 */}
          {!showHistory && !isLoading && query && results.length === 0 && (
            <div className="py-12 text-center" role="alert">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[var(--bg-secondary)] mb-4">
                <Search className="h-8 w-8 text-[var(--text-muted)]" />
              </div>
              <p className="text-[var(--text-secondary)] mb-6">
                未找到与 &quot;<span className="text-[var(--text-primary)]">{query}</span>&quot; 相关的内容
              </p>

              <div className="text-left px-8 max-w-lg mx-auto">
                <p className="text-xs text-[var(--text-muted)] mb-3 text-center">试试搜索以下热门话题：</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {TRENDING_SEARCHES.map((item) => (
                    <button
                      key={item}
                      onClick={() => setQuery(item)}
                      className="px-3 py-1.5 rounded-full text-sm bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-all"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部快捷键提示 */}
        <div className="px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)]">↑</kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)]">↓</kbd>
                导航
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)]">Enter</kbd>
                打开
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)]">ESC</kbd>
                关闭
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-primary" />
              <span>AI 语义搜索已启用</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default SearchPanel;
