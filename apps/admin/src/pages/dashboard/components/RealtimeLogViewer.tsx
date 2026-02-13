import { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import { systemService } from '@/services/systemService';
import { Terminal, Pause, Play, Trash2, RefreshCw, Maximize2, Minimize2, Type, Filter, ArrowDown, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

interface RealtimeLogViewerProps {
  containerId?: string | null;
  containerName?: string;
  useAppLogs?: boolean;
  refreshInterval?: number;
  className?: string;
}

type LogLifecycleState = 'idle' | 'loading' | 'healthy' | 'no_data' | 'error' | 'paused';
type LogViewMode = 'embedded' | 'fullscreen';
type ActiveLogLifecycle = Exclude<LogLifecycleState, 'paused'>;
type LogPauseReason = 'manual' | 'hidden';

interface LogViewState {
  lifecycle: LogLifecycleState;
  mode: LogViewMode;
  lastActiveLifecycle: ActiveLogLifecycle;
  message: string;
  errorCategory: string | null;
  pauseReason: LogPauseReason | null;
  transitionTrace: string;
}

type LogViewAction =
  | { type: 'RESET_CONTEXT' }
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; hasData: boolean }
  | { type: 'FETCH_NO_DATA'; message: string; errorCategory?: string | null }
  | { type: 'FETCH_ERROR'; message: string; errorCategory?: string | null }
  | { type: 'SET_PAUSED'; paused: boolean; reason?: LogPauseReason | null }
  | { type: 'ENTER_FULLSCREEN' }
  | { type: 'EXIT_FULLSCREEN' };

const INITIAL_LOG_VIEW_STATE: LogViewState = {
  lifecycle: 'idle',
  mode: 'embedded',
  lastActiveLifecycle: 'idle',
  message: '',
  errorCategory: null,
  pauseReason: null,
  transitionTrace: 'init',
};

function reduceLogViewState(state: LogViewState, action: LogViewAction): LogViewState {
  switch (action.type) {
    case 'RESET_CONTEXT':
      return {
        ...state,
        lifecycle: 'idle',
        lastActiveLifecycle: 'idle',
        message: '',
        errorCategory: null,
        pauseReason: null,
        transitionTrace: 'reset_context',
      };
    case 'FETCH_START':
      if (state.lifecycle === 'paused') {
        return {
          ...state,
          transitionTrace: 'blocked:fetch_start_when_paused',
        };
      }
      return {
        ...state,
        lifecycle: 'loading',
        message: '',
        errorCategory: null,
        pauseReason: null,
        transitionTrace: `fetch_start_from_${state.lifecycle}`,
      };
    case 'FETCH_SUCCESS': {
      const nextLifecycle: ActiveLogLifecycle = action.hasData ? 'healthy' : 'no_data';
      return {
        ...state,
        lifecycle: nextLifecycle,
        lastActiveLifecycle: nextLifecycle,
        message: action.hasData ? '' : '当前无可展示日志',
        errorCategory: null,
        pauseReason: null,
        transitionTrace: `fetch_success_to_${nextLifecycle}`,
      };
    }
    case 'FETCH_NO_DATA':
      return {
        ...state,
        lifecycle: 'no_data',
        lastActiveLifecycle: 'no_data',
        message: action.message,
        errorCategory: action.errorCategory || null,
        pauseReason: null,
        transitionTrace: 'fetch_no_data',
      };
    case 'FETCH_ERROR':
      return {
        ...state,
        lifecycle: 'error',
        lastActiveLifecycle: 'error',
        message: action.message,
        errorCategory: action.errorCategory || null,
        pauseReason: null,
        transitionTrace: 'fetch_error',
      };
    case 'SET_PAUSED':
      if (!action.paused && state.lifecycle === 'paused') {
        return {
          ...state,
          lifecycle: state.lastActiveLifecycle,
          pauseReason: null,
          message: state.lastActiveLifecycle === 'healthy' ? '' : state.message,
          transitionTrace: `resume_to_${state.lastActiveLifecycle}`,
        };
      }
      if (!action.paused) {
        return {
          ...state,
          transitionTrace: 'blocked:resume_when_not_paused',
        };
      }
      if (state.lifecycle === 'paused' && state.pauseReason === action.reason) {
        return {
          ...state,
          transitionTrace: `blocked:already_paused_${action.reason || 'unknown'}`,
        };
      }
      return {
        ...state,
        lifecycle: 'paused',
        lastActiveLifecycle: state.lifecycle === 'paused' ? state.lastActiveLifecycle : state.lifecycle,
        pauseReason: action.reason || state.pauseReason || 'manual',
        transitionTrace: `pause_from_${state.lifecycle}_${action.reason || 'manual'}`,
      };
    case 'ENTER_FULLSCREEN':
      if (state.mode === 'fullscreen') {
        return {
          ...state,
          transitionTrace: 'blocked:enter_fullscreen_when_fullscreen',
        };
      }
      return {
        ...state,
        mode: 'fullscreen',
        transitionTrace: 'enter_fullscreen',
      };
    case 'EXIT_FULLSCREEN':
      if (state.mode === 'embedded') {
        return {
          ...state,
          transitionTrace: 'blocked:exit_fullscreen_when_embedded',
        };
      }
      return {
        ...state,
        mode: 'embedded',
        transitionTrace: 'exit_fullscreen',
      };
    default:
      return state;
  }
}

function mergeLogsIncrementally(previous: string[], incoming: string[], maxLines: number): string[] {
  if (previous.length === 0) {
    return incoming.slice(-maxLines);
  }
  if (incoming.length === 0) {
    return previous.slice(-maxLines);
  }

  const maxOverlap = Math.min(previous.length, incoming.length, 300);
  let overlapSize = 0;

  for (let size = maxOverlap; size > 0; size--) {
    const previousTail = previous.slice(previous.length - size).join('\n');
    const incomingHead = incoming.slice(0, size).join('\n');
    if (previousTail === incomingHead) {
      overlapSize = size;
      break;
    }
  }

  return [...previous, ...incoming.slice(overlapSize)].slice(-maxLines);
}

export function RealtimeLogViewer({
  containerId,
  containerName,
  useAppLogs = true,
  refreshInterval = 3,
  className
}: RealtimeLogViewerProps) {
  const MAX_LOG_LINES = 2000;
  const [logs, setLogs] = useState<string[]>([]);
  const [fontSize, setFontSize] = useState(12);
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [manualPaused, setManualPaused] = useState(false);
  const [hiddenPaused, setHiddenPaused] = useState(
    typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false
  );
  const [viewState, dispatchViewState] = useReducer(reduceLogViewState, INITIAL_LOG_VIEW_STATE);

  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fullscreenPanelRef = useRef<HTMLDivElement>(null);
  const fullscreenTriggerRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const retryAttemptRef = useRef(0);
  const shouldMergeOnRecoveryRef = useRef(false);

  const effectivePauseReason: LogPauseReason | null = manualPaused ? 'manual' : hiddenPaused ? 'hidden' : null;
  const isPaused = viewState.lifecycle === 'paused';
  const isLoading = viewState.lifecycle === 'loading';
  const isFullScreen = viewState.mode === 'fullscreen';

  useEffect(() => {
    const handleVisibilityChange = () => {
      setHiddenPaused(document.visibilityState === 'hidden');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (effectivePauseReason) {
      shouldMergeOnRecoveryRef.current = true;
      if (viewState.lifecycle !== 'paused' || viewState.pauseReason !== effectivePauseReason) {
        dispatchViewState({ type: 'SET_PAUSED', paused: true, reason: effectivePauseReason });
      }
      return;
    }

    if (viewState.lifecycle === 'paused') {
      dispatchViewState({ type: 'SET_PAUSED', paused: false });
    }
  }, [effectivePauseReason, viewState.lifecycle, viewState.pauseReason]);

  useEffect(() => {
    if (viewState.transitionTrace.startsWith('blocked:')) {
      logger.warn('Log viewer transition blocked', {
        trace: viewState.transitionTrace,
        lifecycle: viewState.lifecycle,
        mode: viewState.mode,
        pauseReason: viewState.pauseReason,
      });
    }
  }, [viewState.transitionTrace, viewState.lifecycle, viewState.mode, viewState.pauseReason]);

  useEffect(() => {
    if (!isFullScreen) {
      return;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dispatchViewState({ type: 'EXIT_FULLSCREEN' });
      }
    };

    document.addEventListener('keydown', handleEscape);

    const focusTimer = window.setTimeout(() => {
      fullscreenPanelRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = originalBodyOverflow;
      const fallbackTarget = previousFocusRef.current ?? fullscreenTriggerRef.current;
      fallbackTarget?.focus();
    };
  }, [isFullScreen]);

  const getTitle = useCallback(() => {
    if (useAppLogs) {
      return 'Backend (Java)';
    }
    return containerName || containerId?.slice(0, 12) || '日志查看器';
  }, [useAppLogs, containerName, containerId]);

  useEffect(() => {
    setLogs([]);
    setManualPaused(false);
    retryAttemptRef.current = 0;
    shouldMergeOnRecoveryRef.current = false;
    setAutoScroll(true);
    dispatchViewState({ type: 'RESET_CONTEXT' });
  }, [filterLevel, containerId, useAppLogs]);

  useEffect(() => {
    if (isPaused) return;
    if (!useAppLogs && !containerId) return;

    const fetchLogs = async () => {
      dispatchViewState({ type: 'FETCH_START' });
      try {
        if (useAppLogs) {
          const result = await systemService.getLogs(filterLevel, MAX_LOG_LINES);

          if (result.status === 'ok') {
            const nextLines = Array.isArray(result.lines) ? result.lines : [];
            setLogs((previous) => {
              if (!shouldMergeOnRecoveryRef.current) {
                return nextLines.slice(-MAX_LOG_LINES);
              }
              return mergeLogsIncrementally(previous, nextLines, MAX_LOG_LINES);
            });
            dispatchViewState({ type: 'FETCH_SUCCESS', hasData: result.lines.length > 0 });
            setLastSuccessAt(new Date());
            retryAttemptRef.current = 0;
            shouldMergeOnRecoveryRef.current = false;
          } else if (result.status === 'no_data') {
            setLogs([]);
            dispatchViewState({
              type: 'FETCH_NO_DATA',
              message: result.message || '当前级别暂无日志',
              errorCategory: result.errorCategory || null,
            });
            retryAttemptRef.current = 0;
            shouldMergeOnRecoveryRef.current = false;
          } else {
            dispatchViewState({
              type: 'FETCH_ERROR',
              message: result.message || '日志读取失败',
              errorCategory: result.errorCategory || null,
            });
            retryAttemptRef.current = Math.min(retryAttemptRef.current + 1, 5);
            shouldMergeOnRecoveryRef.current = true;
          }
        } else {
          const data = await systemService.getContainerLogs(containerId!);
          if (Array.isArray(data)) {
            const nextLines = data.slice(-MAX_LOG_LINES);
            setLogs((previous) => {
              if (!shouldMergeOnRecoveryRef.current) {
                return nextLines;
              }
              return mergeLogsIncrementally(previous, nextLines, MAX_LOG_LINES);
            });
            if (data.length > 0) {
              dispatchViewState({ type: 'FETCH_SUCCESS', hasData: true });
              retryAttemptRef.current = 0;
              shouldMergeOnRecoveryRef.current = false;
            } else {
              dispatchViewState({
                type: 'FETCH_NO_DATA',
                message: '容器当前无可显示日志',
                errorCategory: null,
              });
              retryAttemptRef.current = 0;
              shouldMergeOnRecoveryRef.current = false;
            }
            if (data.length > 0) {
              setLastSuccessAt(new Date());
            }
          }
        }
      } catch (err: unknown) {
        logger.error('Failed to fetch logs', err);
        const message = typeof err === 'object' && err && 'message' in err
          ? String((err as { message?: unknown }).message || '日志请求失败')
          : '日志请求失败';
        const errorCategory = typeof err === 'object' && err && 'errorCategory' in err
          ? String((err as { errorCategory?: unknown }).errorCategory || '')
          : '';

        dispatchViewState({
          type: 'FETCH_ERROR',
          message: message || '日志请求失败',
          errorCategory: errorCategory || null,
        });
        retryAttemptRef.current = Math.min(retryAttemptRef.current + 1, 5);
        shouldMergeOnRecoveryRef.current = true;
      }
    };

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      if (stopped) {
        return;
      }
      const delaySeconds = retryAttemptRef.current > 0
        ? Math.min(refreshInterval * Math.pow(2, retryAttemptRef.current), 60)
        : refreshInterval;
      timer = setTimeout(() => {
        void runCycle();
      }, delaySeconds * 1000);
    };

    const runCycle = async () => {
      if (stopped) {
        return;
      }
      await fetchLogs();
      scheduleNext();
    };

    void runCycle();

    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [containerId, refreshInterval, isPaused, useAppLogs, filterLevel, refreshTick, MAX_LOG_LINES]);

  useEffect(() => {
    if (autoScroll && !isPaused && scrollRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      scrollRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, [logs, isPaused, autoScroll]);

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 50;
      if (isAtBottom !== autoScroll) {
        setAutoScroll(isAtBottom);
      }
    }
  };

  const handleDownload = () => {
    if (useAppLogs) {
      const url = systemService.getLogDownloadUrl(filterLevel);
      window.open(url, '_blank');
    }
  };

  const handleManualRefresh = () => {
    setManualPaused(false);
    setRefreshTick(value => value + 1);
  };

  if (!useAppLogs && !containerId) {
    return (
      <div className={cn('rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col items-center justify-center text-[var(--text-muted)] h-full min-h-[400px]', className)}>
        <Terminal className="w-12 h-12 mb-4 opacity-20" />
        <p className="text-sm">请点击左侧容器列表查看日志</p>
      </div>
    );
  }

  const statusLabelMap: Record<LogLifecycleState, string> = {
    idle: '初始化中',
    loading: '加载中',
    healthy: '运行正常',
    no_data: '暂无日志',
    error: '降级中',
    paused: '已暂停',
  };

  const statusClassMap: Record<LogLifecycleState, string> = {
    idle: 'bg-[var(--bg-card)] text-[var(--text-muted)] border-[var(--border-subtle)]',
    loading: 'bg-[var(--bg-card)] text-[var(--text-muted)] border-[var(--border-subtle)]',
    healthy: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    no_data: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    error: 'bg-red-500/10 text-red-600 border-red-500/30',
    paused: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  };

  const statusLabel = statusLabelMap[viewState.lifecycle];
  const statusClassName = statusClassMap[viewState.lifecycle];
  const pauseReasonLabel = viewState.pauseReason === 'hidden' ? '页面隐藏自动暂停' : '手动暂停';

  const renderContent = () => (
    <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] shrink-0 gap-2">
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] min-w-0">
          <Terminal className="w-4 h-4 text-primary shrink-0" />
          <span className="font-mono font-medium truncate">{getTitle()}</span>
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded border shrink-0', statusClassName)}>{statusLabel}</span>
          {isPaused && <span className="text-[10px] bg-yellow-500/10 text-yellow-500 px-1.5 py-0.5 rounded ml-1 shrink-0">{pauseReasonLabel}</span>}
          {isFullScreen && <span className="text-[10px] bg-indigo-500/10 text-indigo-500 px-1.5 py-0.5 rounded ml-1 shrink-0">全屏</span>}
          {!autoScroll && !isPaused && <span className="text-[10px] bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded ml-1 shrink-0">滚动锁定解除</span>}
          {isLoading && <RefreshCw className="w-3 h-3 animate-spin text-[var(--text-muted)] ml-1" />}
        </div>

        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <div className="text-[10px] text-[var(--text-muted)]">
            最近成功: {lastSuccessAt ? lastSuccessAt.toLocaleTimeString() : '尚无'}
          </div>

          <div className="flex items-center gap-2 group">
            <Type className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-primary)]" />
            <input
              type="range"
              min="10"
              max="20"
              step="1"
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
              className="w-20 h-1 bg-[var(--bg-secondary)] rounded-lg appearance-none cursor-pointer accent-primary"
              title={`字体大小: ${fontSize}px`}
            />
          </div>

          <div className="flex items-center gap-1 bg-[var(--bg-card)] rounded p-0.5 border border-[var(--border-subtle)]">
            <Filter className="w-3.5 h-3.5 text-[var(--text-muted)] ml-1.5 mr-1" />
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="bg-transparent text-[10px] sm:text-xs text-[var(--text-secondary)] border-none focus:ring-0 cursor-pointer py-1 pr-6 pl-1"
            >
              <option value="ALL">全部日志</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
              <option value="DEBUG">DEBUG</option>
            </select>
          </div>

          <div className="w-px h-4 bg-[var(--border-subtle)] mx-1" />

          <div className="flex items-center gap-1">
            {useAppLogs && (
              <button
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
                onClick={handleDownload}
                title="下载日志文件"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
              onClick={handleManualRefresh}
              title="立即重试"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            </button>
            <button
              className={cn('p-1.5 rounded transition-colors', autoScroll ? 'text-primary bg-primary/10' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]')}
              onClick={() => setAutoScroll(!autoScroll)}
              title={autoScroll ? '自动滚动开启' : '自动滚动关闭'}
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
              onClick={() => setManualPaused(previous => !previous)}
              title={manualPaused ? '继续滚动' : '暂停滚动'}
            >
              {manualPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
            <button
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
              onClick={() => setLogs([])}
              title="清空屏幕"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              ref={fullscreenTriggerRef}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
              onClick={() => dispatchViewState({ type: isFullScreen ? 'EXIT_FULLSCREEN' : 'ENTER_FULLSCREEN' })}
              title={isFullScreen ? '退出全屏' : '全屏显示'}
            >
              {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {(viewState.lifecycle === 'error' || viewState.lifecycle === 'no_data') && (
        <div className={cn(
          'mx-4 mt-3 rounded-md px-3 py-2 text-xs border',
          viewState.lifecycle === 'error'
            ? 'bg-red-500/10 text-red-600 border-red-500/30'
            : 'bg-amber-500/10 text-amber-700 border-amber-500/30'
        )}>
          {viewState.message || (viewState.lifecycle === 'error' ? '日志服务异常' : '当前暂无日志')}
          {viewState.errorCategory && <span className="ml-2 opacity-80">({viewState.errorCategory})</span>}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 font-mono text-[var(--text-secondary)] leading-relaxed custom-scrollbar bg-[var(--bg-card)]"
        style={{ fontSize: `${fontSize}px` }}
      >
        {isLoading && logs.length === 0 && viewState.lastActiveLifecycle === 'idle' ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            正在加载日志...
          </div>
        ) : logs.length > 0 ? (
          logs.map((line, i) => (
            <div key={i} className={cn(
              'whitespace-pre-wrap break-all hover:bg-[var(--bg-card-hover)] px-1 py-0.5 rounded transition-colors border-l-2',
              line.includes('ERROR') ? 'border-red-500/50 bg-red-500/5 dark:bg-red-500/10' :
              line.includes('WARN') ? 'border-yellow-500/50 bg-yellow-500/5 dark:bg-yellow-500/10' :
              line.includes('DEBUG') ? 'border-blue-500/50' :
              'border-transparent hover:border-[var(--border-subtle)]'
            )}>
              {line}
            </div>
          ))
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            {viewState.lifecycle === 'error' ? '日志服务异常，点击右上角重试' : '当前无可展示日志'}
          </div>
        )}
      </div>
    </>
  );

  const fullscreenContent = isFullScreen && (
    <>
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9998]"
        onClick={() => dispatchViewState({ type: 'EXIT_FULLSCREEN' })}
      />

      <div className={cn(
        'fixed inset-4 z-[9999] rounded-xl border border-[var(--border-subtle)] flex flex-col overflow-hidden shadow-2xl bg-[var(--bg-primary)]',
        className
      )}
        ref={fullscreenPanelRef}
        role="dialog"
        aria-modal="true"
        aria-label="日志全屏预览"
        tabIndex={-1}
      >
        {renderContent()}
      </div>
    </>
  );

  return (
    <>
      {fullscreenContent}

      {!isFullScreen && (
        <div className={cn(
          'rounded-xl border border-[var(--border-subtle)] flex flex-col overflow-hidden transition-all duration-300 bg-[var(--bg-card)] h-full min-h-[400px]',
          className
        )}>
          {renderContent()}
        </div>
      )}
    </>
  );
}
