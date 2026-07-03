'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  X,
  Loader2,
  FileText,
  Folder,
  ArrowRight,
  History,
  TrendingUp,
  Sparkles,
  Clock,
  Trash2,
  MessageCircle,
  BookOpen,
  AlertCircle,
  LogIn,
  ShieldCheck,
} from 'lucide-react';
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
  authHint?: AuthHint;
}

interface AuthHint {
  message: string;
  loginUrl: string;
  workspaceUrl?: string;
  label?: string;
}

interface SearchFeatures {
  keywordEnabled: boolean;
  semanticEnabled: boolean;
  aiQaEnabled: boolean;
}

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type PanelMode = 'search' | 'ask';
type ActualSearchMode = 'keyword' | 'semantic' | 'hybrid' | 'disabled' | '';

const TRENDING_SEARCHES = ['Spring Boot', 'React', 'Docker', 'Kubernetes', 'TypeScript'];

const DEFAULT_FEATURES: SearchFeatures = {
  keywordEnabled: true,
  semanticEnabled: false,
  aiQaEnabled: false,
};

const MODE_OPTIONS: Array<{ mode: PanelMode; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { mode: 'search', label: '文章', icon: BookOpen },
  { mode: 'ask', label: '问答', icon: MessageCircle },
];

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function stripAskPrefix(value: string): string {
  return value.replace(/^\s*\?\s*/, '');
}

function resultSourceLabel(source?: string): string {
  switch (source) {
    case 'keyword':
      return '关键词';
    case 'semantic':
      return '语义';
    case 'hybrid':
      return '综合';
    default:
      return '匹配';
  }
}

function modeStatusLabel(mode: ActualSearchMode, features: SearchFeatures): string {
  if (mode === 'keyword') return '关键词检索';
  if (mode === 'semantic') return '语义检索';
  if (mode === 'hybrid') return '综合检索';
  if (mode === 'disabled') return '检索未启用';
  return features.keywordEnabled ? '关键词检索' : '检索待确认';
}

function parseAuthHint(payload: unknown): AuthHint | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : '';
  const loginUrl = typeof record.loginUrl === 'string' ? record.loginUrl : '';
  if (!message || !loginUrl || !loginUrl.startsWith('/') || loginUrl.startsWith('//')) {
    return undefined;
  }
  const safeWorkspaceUrl = typeof record.workspaceUrl === 'string'
    && record.workspaceUrl.startsWith('/')
    && !record.workspaceUrl.startsWith('//');
  const workspaceUrl = safeWorkspaceUrl ? record.workspaceUrl as string : undefined;
  const label = typeof record.label === 'string' ? record.label : undefined;
  return { message, loginUrl, workspaceUrl, label };
}

const SearchResultItem = React.memo(({
  result,
  isActive,
  onClick,
  onMouseEnter,
  index,
}: {
  result: SearchResult;
  isActive: boolean;
  onClick: (result: SearchResult) => void;
  onMouseEnter: (index: number) => void;
  index: number;
}) => {
  return (
    <button
      id={`search-result-${result.id}`}
      type="button"
      role="option"
      aria-selected={isActive}
      onClick={() => onClick(result)}
      onMouseEnter={() => onMouseEnter(index)}
      className={`group/result flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-card)] sm:gap-4 sm:px-5 ${
        isActive ? 'bg-[var(--bg-card-hover)]' : 'hover:bg-[var(--bg-secondary)]'
      }`}
    >
      <span className={`mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border ${
        isActive
          ? 'border-primary/35 bg-primary/15 text-primary'
          : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-muted)]'
      }`}>
        <FileText className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[15px] font-semibold ${
          isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
        }`}>
          {result.title}
        </span>
        {result.highlight && (
          <span className="mt-1.5 block line-clamp-2 text-sm leading-6 text-[var(--text-muted)]">
            {result.highlight}
          </span>
        )}
        <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          {result.category && (
            <span className="inline-flex max-w-[8rem] items-center gap-1 overflow-hidden">
              <Folder className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{result.category}</span>
            </span>
          )}
          {result.publishedAt && <span>{formatDate(result.publishedAt)}</span>}
          <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {resultSourceLabel(result.source)}
          </span>
        </span>
      </span>
      <ArrowRight className={`mt-2 h-4 w-4 flex-shrink-0 transition-transform ${
        isActive ? 'translate-x-1 text-primary' : 'text-[var(--text-muted)] group-hover/result:translate-x-0.5'
      }`} />
    </button>
  );
});

SearchResultItem.displayName = 'SearchResultItem';

const SearchPanelBase: React.FC<SearchPanelProps> = ({ isOpen, onClose }) => {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const clearTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [activeMode, setActiveMode] = useState<PanelMode>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [actualSearchMode, setActualSearchMode] = useState<ActualSearchMode>('');
  const [searchError, setSearchError] = useState('');
  const [aiAnswer, setAiAnswer] = useState<AiAnswer | null>(null);
  const [aiError, setAiError] = useState('');
  const [hasAsked, setHasAsked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [features, setFeatures] = useState<SearchFeatures>(DEFAULT_FEATURES);

  const trimmedQuery = query.trim();
  const queryRef = useRef(query);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const resetAskState = useCallback(() => {
    closeEventSource();
    setAiAnswer(null);
    setAiError('');
    setIsAiLoading(false);
    setHasAsked(false);
  }, [closeEventSource]);

  const resetSearchState = useCallback(() => {
    searchAbortRef.current?.abort();
    setResults([]);
    setSearchError('');
    setActualSearchMode('');
    setIsLoading(false);
    setActiveIndex(-1);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setActiveMode('search');
      setActiveIndex(-1);
      return;
    }

    closeEventSource();
    searchAbortRef.current?.abort();
    setIsLoading(false);
    setIsAiLoading(false);
  }, [closeEventSource, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    fetch('/api/v1/public/search/features', { signal: controller.signal })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data?.data) {
          setFeatures(DEFAULT_FEATURES);
          return;
        }
        setFeatures({
          keywordEnabled: !!data?.data?.keywordEnabled,
          semanticEnabled: !!data?.data?.semanticEnabled,
          aiQaEnabled: !!data?.data?.aiQaEnabled,
        });
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          setFeatures(DEFAULT_FEATURES);
        }
      });
    return () => controller.abort();
  }, [isOpen]);

  useEffect(() => {
    try {
      const history = localStorage.getItem('searchHistory');
      if (history) {
        const parsed = JSON.parse(history);
        if (Array.isArray(parsed)) {
          setSearchHistory(parsed.filter((item): item is string => typeof item === 'string').slice(0, 5));
        }
      }
    } catch {
      setSearchHistory([]);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
      }
      closeEventSource();
      searchAbortRef.current?.abort();
    };
  }, [closeEventSource]);

  const saveToHistory = useCallback((term: string) => {
    const normalized = stripAskPrefix(term).trim();
    if (!normalized) return;
    setSearchHistory(prev => {
      const updated = [normalized, ...prev.filter((h) => h !== normalized)].slice(0, 5);
      localStorage.setItem('searchHistory', JSON.stringify(updated));
      return updated;
    });
  }, []);

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

  const mapSearchResults = useCallback((items: unknown[]): SearchResult[] => {
    return items.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        id: String(record.id ?? ''),
        title: String(record.title ?? ''),
        slug: String(record.slug ?? ''),
        highlight: String(record.highlight || record.summary || ''),
        category: record.category ? String(record.category) : undefined,
        publishedAt: String(record.publishedAt ?? ''),
        score: typeof record.score === 'number' ? record.score : undefined,
        source: typeof record.source === 'string' ? record.source : undefined,
      };
    }).filter(item => item.id && item.slug && item.title);
  }, []);

  const performArticleSearch = useCallback(async (rawQuery: string) => {
    const searchQuery = rawQuery.trim();
    if (!searchQuery) {
      resetSearchState();
      return;
    }

    if (!features.keywordEnabled && !features.semanticEnabled) {
      setResults([]);
      setSearchError('检索能力未启用');
      setActualSearchMode('disabled');
      setIsLoading(false);
      return;
    }

    closeEventSource();
    setIsLoading(true);
    setSearchError('');
    setActualSearchMode('');
    searchAbortRef.current?.abort();

    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      const res = await fetch(
        `/api/v1/public/search?q=${encodeURIComponent(searchQuery)}&mode=hybrid&limit=10`,
        { signal: controller.signal }
      );

      if (!res.ok) {
        setResults([]);
        setSearchError('搜索暂时不可用');
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      const payload = data?.data;
      const items = Array.isArray(payload?.items) ? mapSearchResults(payload.items) : [];
      setResults(items);
      setActualSearchMode(typeof payload?.mode === 'string' ? payload.mode as ActualSearchMode : '');
      setIsLoading(false);
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') return;
      logger.error('Search error:', error);
      setResults([]);
      setSearchError('搜索暂时不可用');
      setIsLoading(false);
    }
  }, [closeEventSource, features.keywordEnabled, features.semanticEnabled, mapSearchResults, resetSearchState]);

  const startAiAnswer = useCallback((rawQuery?: string) => {
    const askQuery = stripAskPrefix(rawQuery ?? queryRef.current).trim();
    setActiveMode('ask');
    resetSearchState();
    closeEventSource();
    setHasAsked(true);
    setAiAnswer(null);
    setAiError('');

    if (!askQuery) {
      setIsAiLoading(false);
      return;
    }

    saveToHistory(askQuery);

    if (!features.aiQaEnabled) {
      setIsAiLoading(false);
      setAiError('AI 问答未启用');
      return;
    }

    setIsAiLoading(true);
    const es = new EventSource(`/api/v1/public/search/qa?q=${encodeURIComponent(askQuery)}`);
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
              authHint: prev?.authHint,
            }));
            setIsAiLoading(false);
            break;
          case 'sources':
            setAiAnswer(prev => ({
              answer: prev?.answer ?? accumulatedAnswer,
              sources: Array.isArray(payload.sources) ? payload.sources : undefined,
              authHint: prev?.authHint,
            }));
            break;
          case 'auth_hint': {
            const authHint = parseAuthHint(payload);
            if (authHint) {
              setAiAnswer(prev => ({
                answer: prev?.answer ?? accumulatedAnswer,
                sources: prev?.sources,
                authHint,
              }));
            }
            break;
          }
          case 'result': {
            const data = payload.data as Record<string, unknown> | undefined;
            const authHint = parseAuthHint(data?.authHint);
            if (authHint) {
              setAiAnswer(prev => ({
                answer: prev?.answer ?? accumulatedAnswer,
                sources: prev?.sources,
                authHint,
              }));
            }
            break;
          }
          case 'done':
            es.close();
            eventSourceRef.current = null;
            setIsAiLoading(false);
            break;
          case 'error':
            logger.error('QA stream error:', payload);
            es.close();
            eventSourceRef.current = null;
            setIsAiLoading(false);
            if (!accumulatedAnswer) {
              setAiAnswer(null);
              setAiError('AI 问答暂时不可用');
            }
            break;
        }
      } catch {
        // 忽略无法解析的 SSE 帧。
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setIsAiLoading(false);
      if (!accumulatedAnswer) {
        setAiAnswer(null);
        setAiError('AI 问答暂时不可用');
      }
    };
  }, [closeEventSource, features.aiQaEnabled, resetSearchState, saveToHistory]);

  useEffect(() => {
    if (!isOpen || activeMode !== 'search') return;
    const timer = setTimeout(() => performArticleSearch(trimmedQuery), 260);
    return () => clearTimeout(timer);
  }, [activeMode, isOpen, performArticleSearch, trimmedQuery]);

  const handleModeChange = useCallback((mode: PanelMode) => {
    setActiveMode(mode);
    setActiveIndex(-1);
    if (mode === 'search') {
      resetAskState();
      window.setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    resetSearchState();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [resetAskState, resetSearchState]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value.trimStart().startsWith('?')) {
      setActiveMode('ask');
      setQuery(stripAskPrefix(value));
      resetSearchState();
      setAiAnswer(null);
      setAiError('');
      setHasAsked(false);
      return;
    }

    setQuery(value);
    if (activeMode === 'ask') {
      closeEventSource();
      setAiAnswer(null);
      setAiError('');
      setIsAiLoading(false);
      setHasAsked(false);
    }
  }, [activeMode, closeEventSource, resetSearchState]);

  const handleResultClick = useCallback((result: SearchResult) => {
    saveToHistory(queryRef.current);
    router.push(`/posts/${result.slug}`);
    onClose();
  }, [onClose, router, saveToHistory]);

  const handleTopicClick = useCallback((term: string) => {
    setActiveMode('search');
    resetAskState();
    setQuery(term);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [resetAskState]);

  const handleClearQuery = useCallback(() => {
    setQuery('');
    resetSearchState();
    resetAskState();
    inputRef.current?.focus();
  }, [resetAskState, resetSearchState]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedQuery) return;

    if (activeMode === 'ask') {
      startAiAnswer(trimmedQuery);
      return;
    }

    if (activeIndex >= 0 && results[activeIndex]) {
      handleResultClick(results[activeIndex]);
      return;
    }

    if (results[0]) {
      handleResultClick(results[0]);
      return;
    }

    performArticleSearch(trimmedQuery);
  }, [activeIndex, activeMode, handleResultClick, performArticleSearch, results, startAiAnswer, trimmedQuery]);

  useEffect(() => {
    if (activeIndex >= 0 && resultsRef.current) {
      const activeElement = resultsRef.current.children[activeIndex] as HTMLElement;
      activeElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (activeMode !== 'search') return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : -1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeMode, isOpen, onClose, results.length]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const inputPlaceholder = activeMode === 'ask'
    ? '向博客提问，例如 Docker 怎么使用'
    : '搜索文章、标签、分类或正文';

  const showSearchHome = activeMode === 'search' && !trimmedQuery;
  const showSearchResults = activeMode === 'search' && trimmedQuery && results.length > 0;
  const showSearchEmpty = activeMode === 'search' && trimmedQuery && !isLoading && results.length === 0;
  const showAskIntro = activeMode === 'ask' && !hasAsked && !aiAnswer && !aiError && !isAiLoading;
  const showAskAnswer = activeMode === 'ask' && (hasAsked || aiAnswer || aiError || isAiLoading);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="search-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md"
          />

          <motion.div
            key="search-panel"
            initial={{ opacity: 0, scale: 0.96, y: -16, x: '-50%' }}
            animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, scale: 0.96, y: -16, x: '-50%' }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="search-dialog-title"
            data-testid="blog-search-panel"
            className="surface-overlay fixed left-1/2 top-[calc(env(safe-area-inset-top)_+_5rem)] z-50 flex max-h-[min(78vh,760px)] w-[calc(100%-1rem)] max-w-2xl flex-col overflow-hidden sm:top-[10%] sm:w-[calc(100%-2rem)]"
          >
            <h2 id="search-dialog-title" className="sr-only">搜索面板</h2>

            <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/45">
              <div className="grid grid-cols-2 gap-1 p-2" role="tablist" aria-label="搜索模式">
                {MODE_OPTIONS.map(({ mode, label, icon: Icon }) => {
                  const active = activeMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => handleModeChange(mode)}
                      className={`flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-card)] ${
                        active
                          ? 'border-primary/30 bg-primary/15 text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
                          : 'border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>

              <form onSubmit={handleSubmit} className="px-4 pb-4 sm:px-5">
                <div className="group/search flex min-h-[3.25rem] items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3.5 transition-colors focus-within:border-primary/60 focus-within:bg-[var(--bg-card-hover)]">
                  {activeMode === 'ask' ? (
                    <MessageCircle className="h-5 w-5 flex-shrink-0 text-[var(--text-muted)] transition-colors group-focus-within/search:text-primary" />
                  ) : (
                    <Search className="h-5 w-5 flex-shrink-0 text-[var(--text-muted)] transition-colors group-focus-within/search:text-primary" />
                  )}
                  <input
                    ref={inputRef}
                    type="text"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls="search-results-list"
                    aria-expanded={activeMode === 'search' && results.length > 0}
                    aria-activedescendant={activeMode === 'search' && activeIndex >= 0 && results[activeIndex] ? `search-result-${results[activeIndex].id}` : undefined}
                    aria-label={activeMode === 'ask' ? 'AI 问答输入框' : '文章搜索输入框'}
                    value={query}
                    onChange={handleInputChange}
                    placeholder={inputPlaceholder}
                    className="min-w-0 flex-1 bg-transparent text-base text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] sm:text-lg"
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="清空输入"
                      title="清空输入"
                      onClick={handleClearQuery}
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {activeMode === 'search' && isLoading && <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-primary" />}
                  {activeMode === 'ask' && (
                    <button
                      type="submit"
                      disabled={!trimmedQuery || isAiLoading}
                      className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      {isAiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      <span className="hidden sm:inline">提问</span>
                    </button>
                  )}
                </div>
              </form>
            </div>

            {activeMode === 'search' && trimmedQuery && (
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-2 text-xs text-[var(--text-muted)] sm:px-5">
                <span className="truncate">
                  {isLoading ? '检索中' : results.length > 0 ? `${results.length} 篇相关内容` : searchError || modeStatusLabel(actualSearchMode, features)}
                </span>
                <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  {modeStatusLabel(actualSearchMode, features)}
                </span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {showSearchHome && (
                <div className="space-y-6 p-4 sm:p-5">
                  {searchHistory.length > 0 && (
                    <section>
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)]">
                          <History className="h-4 w-4" />
                          <span>最近搜索</span>
                        </div>
                        <button
                          type="button"
                          onClick={clearHistory}
                          className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-card)] ${
                            confirmClearHistory
                              ? 'bg-red-500/10 font-semibold text-red-500'
                              : 'text-[var(--text-muted)] hover:bg-red-400/10 hover:text-red-400'
                          }`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {confirmClearHistory ? '确认清空' : '清空'}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {searchHistory.map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => handleTopicClick(item)}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                          >
                            <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                            {item}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  <section>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text-muted)]">
                      <TrendingUp className="h-4 w-4" />
                      <span>热门搜索</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {TRENDING_SEARCHES.map((item, index) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => handleTopicClick(item)}
                          className="inline-flex min-h-10 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        >
                          <span className="text-xs text-primary/65">{index + 1}</span>
                          {item}
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              )}

              {showSearchResults && (
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

              {showSearchEmpty && (
                <div className="px-6 py-12 text-center" role="status">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                    {searchError ? (
                      <AlertCircle className="h-8 w-8 text-amber-400" />
                    ) : (
                      <Search className="h-8 w-8 text-[var(--text-muted)]" />
                    )}
                  </div>
                  <p className="mx-auto max-w-sm text-[var(--text-secondary)]">
                    {searchError || (
                      <>
                        没有找到「<span className="text-[var(--text-primary)]">{trimmedQuery}</span>」
                      </>
                    )}
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {features.aiQaEnabled && !searchError && (
                      <button
                        type="button"
                        onClick={() => startAiAnswer(trimmedQuery)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      >
                        <MessageCircle className="h-4 w-4" />
                        用 AI 问答
                      </button>
                    )}
                    {TRENDING_SEARCHES.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => handleTopicClick(item)}
                        className="inline-flex min-h-10 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showAskIntro && (
                <div className="space-y-6 p-4 sm:p-5">
                  {!features.aiQaEnabled && (
                    <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-200">
                      <div className="flex items-center gap-2 font-semibold">
                        <AlertCircle className="h-4 w-4" />
                        AI 问答未启用
                      </div>
                    </div>
                  )}
                  {features.aiQaEnabled && (
                    <div className="rounded-2xl border border-primary/20 bg-primary/10 p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                        <Sparkles className="h-4 w-4" />
                        AI 问答
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {TRENDING_SEARCHES.map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => {
                              setQuery(`${item} 怎么使用`);
                              inputRef.current?.focus();
                            }}
                            className="inline-flex min-h-10 items-center rounded-full border border-primary/20 bg-[var(--bg-card)]/60 px-3 text-sm text-[var(--text-secondary)] transition-colors hover:bg-primary/15 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {showAskAnswer && (
                <div className="p-4 sm:p-5">
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/70 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                      <Sparkles className="h-4 w-4" />
                      <span>AI 回答</span>
                      {isAiLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    </div>

                    {aiError && (
                      <div className="flex items-center gap-2 text-sm text-amber-300">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        <span>{aiError}</span>
                      </div>
                    )}

                    {!aiError && isAiLoading && !aiAnswer?.answer && (
                      <div className="space-y-2">
                        <div className="h-4 rounded bg-[var(--bg-card)] animate-pulse" />
                        <div className="h-4 w-4/5 rounded bg-[var(--bg-card)] animate-pulse" />
                        <div className="h-4 w-2/3 rounded bg-[var(--bg-card)] animate-pulse" />
                      </div>
                    )}

                    {!aiError && (aiAnswer?.answer || aiAnswer?.authHint) && (
                      <>
                        {aiAnswer.answer && (
                          <p className="ai-stream whitespace-pre-wrap text-sm leading-7 text-[var(--text-secondary)]">
                            {aiAnswer.answer}
                            {isAiLoading && <span className="ink-cursor" aria-hidden="true" />}
                          </p>
                        )}
                        {aiAnswer.authHint && (
                          <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
                            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
                              <ShieldCheck className="h-4 w-4 flex-shrink-0" />
                              <span>登录态授权</span>
                            </div>
                            <p className="text-sm leading-6 text-[var(--text-muted)]">
                              {aiAnswer.authHint.message}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                router.push(aiAnswer.authHint?.loginUrl ?? '/agent/login?next=/agent/workspace');
                                onClose();
                              }}
                              className="mt-3 inline-flex min-h-10 max-w-full items-center gap-2 rounded-full bg-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                            >
                              <LogIn className="h-4 w-4 flex-shrink-0" />
                              <span className="truncate">{aiAnswer.authHint.label || '登录授权'}</span>
                            </button>
                          </div>
                        )}
                        {aiAnswer.sources && aiAnswer.sources.length > 0 && (
                          <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                            <div className="mb-2 text-xs font-medium text-[var(--text-muted)]">引用文章</div>
                            <ul className="space-y-1.5">
                              {aiAnswer.sources.map((source, idx) => (
                                <li key={`${source.slug}-${idx}`}>
                                  <a
                                    href={`/posts/${source.slug}`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      router.push(`/posts/${source.slug}`);
                                      onClose();
                                    }}
                                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card)] hover:text-primary"
                                  >
                                    <FileText className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-muted)]" />
                                    <span className="truncate">{source.title}</span>
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-xs text-[var(--text-muted)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  {activeMode === 'ask' ? <MessageCircle className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
                  {activeMode === 'ask'
                    ? features.aiQaEnabled ? 'AI 问答可用' : 'AI 问答未启用'
                    : modeStatusLabel(actualSearchMode, features)}
                </span>
                {activeMode === 'search' && (actualSearchMode === 'semantic' || actualSearchMode === 'hybrid') && (
                  <span className="inline-flex items-center gap-1.5 text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    语义已参与
                  </span>
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
