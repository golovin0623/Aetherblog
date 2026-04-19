'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Loader2, FileText, Folder, Tag, ArrowRight, History, TrendingUp, Sparkles, Clock, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
  source?: string; // "keyword" | "semantic" | "hybrid"
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

/** 前缀路由 —— 识别输入开头的特殊字符,切换到不同模式 */
type SearchMode = 'default' | 'command' | 'tag' | 'ai';

function parseQueryMode(raw: string): { mode: SearchMode; payload: string; prefix: string } {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('>')) return { mode: 'command', prefix: '>', payload: trimmed.slice(1).trimStart() };
  if (trimmed.startsWith('/')) return { mode: 'tag',     prefix: '/', payload: trimmed.slice(1).trimStart() };
  if (trimmed.startsWith('?')) return { mode: 'ai',      prefix: '?', payload: trimmed.slice(1).trimStart() };
  return { mode: 'default', prefix: '', payload: raw };
}

const MODE_META: Record<SearchMode, { label: string; hint: string }> = {
  default: { label: 'SEARCH',  hint: '全文检索' },
  command: { label: 'COMMAND', hint: '指令模式(> 前缀)' },
  tag:     { label: 'TAG',     hint: '标签筛选(/ 前缀)' },
  ai:      { label: 'ASK',     hint: 'AI 问答(? 前缀)' },
};

/** Format ISO timestamp to YYYY-MM-DD (UTC to avoid timezone day shift) */
function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const SearchResultItem = React.memo(({
  result,
  isActive,
  onClick,
  onMouseEnter,
  index
}: {
  result: SearchResult;
  isActive: boolean;
  onClick: (result: SearchResult) => void;
  onMouseEnter: (index: number) => void;
  index: number;
}) => {
  return (
    <div
      id={`search-result-${result.id}`}
      role="option"
      aria-selected={isActive}
      onClick={() => onClick(result)}
      onMouseEnter={() => onMouseEnter(index)}
      className={`flex items-start gap-4 px-4 py-4 cursor-pointer transition-colors ${
        isActive ? 'bg-[var(--bg-card-hover)]' : 'hover:bg-[var(--bg-secondary)]'
      }`}
    >
      <div className={`flex-shrink-0 p-2 rounded-lg ${isActive ? 'bg-primary/20' : 'bg-[var(--bg-secondary)]'}`}>
        <FileText className={`h-5 w-5 ${isActive ? 'text-primary' : 'text-[var(--text-muted)]'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className={`font-medium truncate mb-1 ${isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
          {result.title}
        </h4>
        {result.highlight && (
          <p className="text-sm text-[var(--text-muted)] line-clamp-2 mb-2">{result.highlight}</p>
        )}
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] overflow-hidden">
          {result.category && (
            <span className="flex items-center gap-1 shrink-0">
              <Folder className="h-3 w-3" />
              <span className="truncate max-w-[6rem]">{result.category}</span>
            </span>
          )}
          <span className="shrink-0">{formatDate(result.publishedAt)}</span>
          {result.source && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-primary border border-primary/30 text-xs whitespace-nowrap">
              {result.source === 'keyword'
                ? '关键词匹配'
                : result.source === 'semantic'
                  ? '语义匹配'
                  : '综合匹配'}
            </span>
          )}
        </div>
      </div>
      <ArrowRight className={`flex-shrink-0 h-5 w-5 transition-transform ${isActive ? 'text-primary translate-x-1' : 'text-[var(--text-muted)]'}`} />
    </div>
  );
});

SearchResultItem.displayName = 'SearchResultItem';

const SearchPanelBase: React.FC<SearchPanelProps> = ({ isOpen, onClose }) => {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const queryMode = parseQueryMode(query);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [aiAnswer, setAiAnswer] = useState<AiAnswer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(true);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [semanticEnabled, setSemanticEnabled] = useState(false);
  const [aiQaEnabled, setAiQaEnabled] = useState(false);
  const clearTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 获取搜索功能开关状态 —— aiQaEnabled 用于前端自我 gate, 避免在站点没开 QA
  // 的情况下还发 EventSource 拿 400, 把报错吞进 console (见 SearchPanel
  // 原先 "Failed to fetch" 噪音)
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    fetch('/api/v1/public/search/features', { signal: controller.signal })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setSemanticEnabled(!!data?.data?.semanticEnabled);
        setAiQaEnabled(!!data?.data?.aiQaEnabled);
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          setSemanticEnabled(false);
          setAiQaEnabled(false);
        }
      });
    return () => controller.abort();
  }, [isOpen]);

  // 卸载时清理定时器
  useEffect(() => {
    return () => {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  // 将查询存入 ref 以保持回调稳定
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  // 加载搜索历史
  useEffect(() => {
    const history = localStorage.getItem('searchHistory');
    if (history) {
      setSearchHistory(JSON.parse(history));
    }
  }, []);

  // 保存搜索历史 - 优化以移除对 searchHistory 的依赖
  const saveToHistory = useCallback((term: string) => {
    setSearchHistory(prev => {
      const updated = [term, ...prev.filter((h) => h !== term)].slice(0, 5);
      localStorage.setItem('searchHistory', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // 清空历史
  const clearHistory = useCallback(() => {
    if (!confirmClearHistory) {
      setConfirmClearHistory(true);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setConfirmClearHistory(false), 3000);
      return;
    }
    setSearchHistory([]);
    localStorage.removeItem('searchHistory');
    setConfirmClearHistory(false);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
  }, [confirmClearHistory]);

  // 处理热门搜索点击 - 使用 data-* 属性避免为每个按钮创建新函数
  const handleTrendingClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const term = e.currentTarget.dataset.term;
    if (term) {
      setQuery(term);
    }
  }, []);

  // 跟踪当前 QA 流的 EventSource，便于清理
  const eventSourceRef = useRef<EventSource | null>(null);
  // 跟踪当前搜索请求的 AbortController —— 快速输入/关闭面板时中断在飞的 fetch,
  // 不然组件卸载后 fetch reject 会在 console 抛 "TypeError: Failed to fetch".
  const searchAbortRef = useRef<AbortController | null>(null);

  // 清理 EventSource
  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // 组件卸载时清理 EventSource + 在飞的 fetch
  useEffect(() => {
    return () => {
      closeEventSource();
      searchAbortRef.current?.abort();
    };
  }, [closeEventSource]);

  // 执行搜索
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setAiAnswer(null);
      setIsLoading(false);
      setIsAiLoading(false);
      setShowHistory(true);
      closeEventSource();
      searchAbortRef.current?.abort();
      return;
    }

    setIsLoading(true);
    setShowHistory(false);
    closeEventSource();

    // 终止上一次请求 (debounce 快速连打时)
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      // 调用搜索 API
      const res = await fetch(
        `/api/v1/public/search?q=${encodeURIComponent(searchQuery)}&mode=hybrid&limit=10`,
        { signal: controller.signal }
      );
      if (!res.ok) {
        setResults([]);
        setIsLoading(false);
        setIsAiLoading(false);
        setAiAnswer(null);
        return;
      }
      const data = await res.json();
      const items = data?.data?.items;
      if (Array.isArray(items) && items.length > 0) {
        setResults(items.map((item: Record<string, unknown>) => ({
          id: String(item.id ?? ''),
          title: String(item.title ?? ''),
          slug: String(item.slug ?? ''),
          highlight: String(item.highlight || item.summary || ''),
          category: item.category ? String(item.category) : undefined,
          publishedAt: String(item.publishedAt ?? ''),
          score: typeof item.score === 'number' ? item.score : undefined,
          source: typeof item.source === 'string' ? item.source : undefined,
        })));
      } else {
        setResults([]);
      }
      setIsLoading(false);

      // QA 流式回答 —— 仅在站点开启 AI 问答时才启动 EventSource.
      // 没开启还打 /qa 会收 204/4xx, EventSource.onerror 会吞掉但 devtools 里
      // 仍然刷 "Failed to load /api/v1/public/search/qa" 噪音. 前置判断直接绕开.
      if (!aiQaEnabled) {
        setIsAiLoading(false);
        setAiAnswer(null);
        return;
      }

      setIsAiLoading(true);
      setAiAnswer(null);

      const es = new EventSource(`/api/v1/public/search/qa?q=${encodeURIComponent(searchQuery)}`);
      eventSourceRef.current = es;
      let accumulatedAnswer = '';

      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          switch (payload.type) {
            case 'delta':
              accumulatedAnswer += payload.content ?? '';
              setAiAnswer(prev => ({
                answer: accumulatedAnswer,
                sources: prev?.sources,
              }));
              setIsAiLoading(false);
              break;
            case 'sources':
              setAiAnswer(prev => ({
                answer: prev?.answer ?? accumulatedAnswer,
                sources: Array.isArray(payload.sources) ? payload.sources : undefined,
              }));
              break;
            case 'done':
              es.close();
              eventSourceRef.current = null;
              break;
            case 'error':
              logger.error('QA stream error:', payload);
              es.close();
              eventSourceRef.current = null;
              setIsAiLoading(false);
              // 出错时不显示 AI 回答区域
              if (!accumulatedAnswer) {
                setAiAnswer(null);
              }
              break;
          }
        } catch {
          // 忽略无法解析的消息
        }
      };

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        setIsAiLoading(false);
        // 连接失败且无已有内容时，隐藏 AI 回答
        if (!accumulatedAnswer) {
          setAiAnswer(null);
        }
      };
    } catch (error) {
      // AbortError 是主动中断, 不是 bug, 不噪音到 console
      if ((error as { name?: string })?.name === 'AbortError') return;
      logger.error('Search error:', error);
      setResults([]);
      setIsLoading(false);
      setIsAiLoading(false);
    }
  }, [closeEventSource, aiQaEnabled]);

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => performSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  // 处理结果点击 - 使用 queryRef 避免依赖变化
  const handleResultClick = useCallback((result: SearchResult) => {
    saveToHistory(queryRef.current);
    router.push(`/posts/${result.slug}`);
    onClose();
  }, [saveToHistory, router, onClose]);

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

  // 自动聚焦 - 略微延迟以配合入场动画
  useEffect(() => {
    if (isOpen && inputRef.current) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 遮罩层 - framer-motion 平滑渐入 */}
          <motion.div
            key="search-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md"
          />

          {/* 搜索面板 - 弹性缩放 + 滑入 */}
          <motion.div
            key="search-panel"
            initial={{ opacity: 0, scale: 0.95, y: -20, x: "-50%" }}
            animate={{ opacity: 1, scale: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, scale: 0.95, y: -20, x: "-50%" }}
            transition={{
              duration: 0.3,
              ease: [0.22, 1, 0.36, 1],
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="search-dialog-title"
            className="surface-overlay fixed left-1/2 top-[10%] z-50 w-[calc(100%-2rem)] max-w-2xl overflow-hidden"
          >
        <h2 id="search-dialog-title" className="sr-only">搜索面板</h2>

        {/* 搜索输入框 */}
        <form onSubmit={(e) => e.preventDefault()} className="relative">
          <div className="group/search flex items-center px-5 py-4 border-b border-[var(--border-subtle)] transition-colors duration-300 focus-within:border-primary focus-within:bg-[var(--bg-card-hover)]">
            <Search className="h-5 w-5 flex-shrink-0 text-[var(--text-muted)] transition-colors duration-300 group-focus-within/search:text-primary" />
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
              placeholder="搜索文章、标签、分类… · 试试 > 指令 · / 标签 · ? AI 问答"
              className="flex-1 ml-3.5 mr-3 bg-transparent text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none text-lg"
            />
            {/* 前缀路由 —— 展示当前激活的模式 chip(COMMAND / TAG / ASK) */}
            {queryMode.mode !== 'default' && (
              <span
                className="cmd-chip mr-2 font-mono text-[10px] uppercase tracking-[0.16em]"
                aria-label={MODE_META[queryMode.mode].hint}
                title={MODE_META[queryMode.mode].hint}
              >
                {MODE_META[queryMode.mode].label}
              </span>
            )}
            {query && (
              <button
                type="button"
                aria-label="清空搜索关键词"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:rounded"
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
                <p className="ai-stream text-[var(--text-secondary)] text-sm leading-relaxed">
                  {aiAnswer.answer}
                  {/* 流式光标 —— 末尾闪烁的极光块,提示 AI 正在生成 */}
                  {isAiLoading === false && aiAnswer.answer && (
                    <span className="ink-cursor" aria-hidden="true" />
                  )}
                </p>
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
                    <button
                      type="button"
                      onClick={clearHistory}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 ${
                        confirmClearHistory
                          ? 'text-red-500 bg-red-500/10 font-medium'
                          : 'text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10'
                      }`}
                    >
                      <Trash2 className="h-3 w-3" />
                      {confirmClearHistory ? '确认清空?' : '清空'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {searchHistory.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setQuery(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-transparent"
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
                      type="button"
                      onClick={handleTrendingClick}
                      data-term={item}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-transparent"
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
                <SearchResultItem
                  key={result.id}
                  result={result}
                  isActive={index === activeIndex}
                  onClick={handleResultClick}
                  onMouseEnter={setActiveIndex}
                  index={index}
                />
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
                      type="button"
                      onClick={handleTrendingClick}
                      data-term={item}
                      className="px-3 py-1.5 rounded-full text-sm bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-transparent"
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
            {semanticEnabled && (
              <div className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-primary" />
                <span>AI 语义搜索已启用</span>
              </div>
            )}
          </div>
        </div>
      </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export const SearchPanel = React.memo(SearchPanelBase);
export default SearchPanel;
