import { useState, useEffect, useRef, useCallback, useReducer, useMemo, useLayoutEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { systemService, type LogLevelStatus } from '@/services/systemService';
import { Terminal, Pause, Play, Trash2, RefreshCw, Maximize2, Minimize2, ArrowDown, Download, ChevronDown, X, Search as SearchIcon, Sliders, FileDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { Select } from '@aetherblog/ui';

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

/* =============================================================
 * 日志行结构化解析
 * -------------------------------------------------------------
 * 把一行裸日志解析成可分列渲染的字段。无法解析的部分原样降级到 message。
 * 关键判断：
 *   • 级别用 \b 边界匹配独立 token，避免 "WARNING" 被识别为 "WARN"
 *   • ISO 时间戳与 nginx 时间戳两套并行
 *   • HTTP 行结构识别后单独高亮 method/path/status
 * ============================================================= */

type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

interface ParsedLogLine {
  /** 原始行 */
  raw: string;
  /** 解析出的时间戳（HH:mm:ss / HH:mm:ss.SSS / 完整 ISO） */
  timestamp: string | null;
  /** 标准化级别（WARNING → WARN, PANIC → FATAL） */
  level: LogLevel | null;
  /** HTTP 方法（解析自 nginx access log） */
  method: string | null;
  /** HTTP 路径 */
  path: string | null;
  /** HTTP 状态码（数字） */
  status: number | null;
  /** 主消息 —— 去掉时间戳/级别后的剩余内容 */
  message: string;
}

const LEVEL_NORMALIZE: Record<string, LogLevel> = {
  TRACE: 'TRACE',
  DEBUG: 'DEBUG',
  INFO:  'INFO',
  WARN:  'WARN',
  WARNING: 'WARN',
  ERROR: 'ERROR',
  FATAL: 'FATAL',
  PANIC: 'FATAL',
};

// 时间戳 / 级别正则锚定到行首：日志行的时间戳 / 级别永远在前面，
// 不锚定会让消息正文里的 ISO 数字串或 "WARN" 词被误识别。
const ISO_TS_RE = /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:Z|[+-]\d{2}:?\d{2})?/;
const NGINX_TS_RE = /^\[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2})\s/;
const LEVEL_RE = /\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|PANIC)\b/;
const HTTP_RE = /"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+([^\s"]+)\s+HTTP\/[\d.]+"\s+(\d{3})/;

function parseLogLine(line: string): ParsedLogLine {
  const result: ParsedLogLine = {
    raw: line,
    timestamp: null,
    level: null,
    method: null,
    path: null,
    status: null,
    message: line,
  };

  let stripped = line;

  // 1. 时间戳 —— ISO 优先，nginx 兜底；命中后从 message 中剥离避免重复展示
  const isoMatch = line.match(ISO_TS_RE);
  if (isoMatch) {
    result.timestamp = isoMatch[2]; // 仅取 HH:mm:ss(.SSS) 部分，节省列宽
    stripped = stripped.replace(isoMatch[0], '').trim();
  } else {
    const ngMatch = line.match(NGINX_TS_RE);
    if (ngMatch) {
      result.timestamp = ngMatch[4];
      stripped = stripped.replace(ngMatch[0], '').trim();
    }
  }

  // 2. 级别 token
  const lvlMatch = stripped.match(LEVEL_RE);
  if (lvlMatch) {
    const upper = lvlMatch[1].toUpperCase();
    result.level = LEVEL_NORMALIZE[upper] ?? null;
    // 仅从 message 头部剥离单个紧贴空白/冒号的 level token
    stripped = stripped.replace(new RegExp(`^\\s*${lvlMatch[1]}\\s*[:|]?\\s*`, 'i'), '');
  }

  // 3. HTTP（nginx access log 主要场景）—— 命中后也从 message 剥离，
  //    渲染期不再需要二次 regex 匹配
  const httpMatch = line.match(HTTP_RE);
  if (httpMatch) {
    result.method = httpMatch[1];
    result.path = httpMatch[2];
    result.status = parseInt(httpMatch[3], 10);
    stripped = stripped.replace(httpMatch[0], '').trim();
  }

  result.message = stripped.trim();
  return result;
}

/* =============================================================
 * 视觉常量 —— 级别 / HTTP method / status 的色板
 * ============================================================= */

const LEVEL_STYLES: Record<LogLevel, { bg: string; text: string; border: string; label: string }> = {
  TRACE: {
    label: 'TRACE',
    bg: 'bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)]',
    text: 'text-[var(--ink-muted)]',
    border: 'border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)]',
  },
  DEBUG: {
    label: 'DEBUG',
    bg: 'bg-[color-mix(in_oklch,var(--signal-info)_10%,transparent)]',
    text: 'text-[var(--signal-info)]',
    border: 'border-[color-mix(in_oklch,var(--signal-info)_24%,transparent)]',
  },
  INFO: {
    label: 'INFO',
    bg: 'bg-[color-mix(in_oklch,var(--signal-info)_10%,transparent)]',
    text: 'text-[var(--signal-info)]',
    border: 'border-[color-mix(in_oklch,var(--signal-info)_24%,transparent)]',
  },
  WARN: {
    label: 'WARN',
    bg: 'bg-[color-mix(in_oklch,var(--signal-warn)_12%,transparent)]',
    text: 'text-[var(--signal-warn)]',
    border: 'border-[color-mix(in_oklch,var(--signal-warn)_28%,transparent)]',
  },
  ERROR: {
    label: 'ERROR',
    bg: 'bg-[color-mix(in_oklch,var(--signal-danger)_12%,transparent)]',
    text: 'text-[var(--signal-danger)]',
    border: 'border-[color-mix(in_oklch,var(--signal-danger)_28%,transparent)]',
  },
  FATAL: {
    label: 'FATAL',
    bg: 'bg-[color-mix(in_oklch,var(--signal-danger)_18%,transparent)]',
    text: 'text-[var(--signal-danger)]',
    border: 'border-[color-mix(in_oklch,var(--signal-danger)_42%,transparent)]',
  },
};

function statusToneClasses(status: number): string {
  if (status >= 500) return 'text-[var(--signal-danger)] bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)]';
  if (status >= 400) return 'text-[var(--signal-warn)] bg-[color-mix(in_oklch,var(--signal-warn)_10%,transparent)]';
  if (status >= 300) return 'text-[var(--signal-info)] bg-[color-mix(in_oklch,var(--signal-info)_10%,transparent)]';
  if (status >= 200) return 'text-[var(--signal-success)] bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)]';
  return 'text-[var(--ink-muted)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)]';
}

const METHOD_TONE: Record<string, string> = {
  GET:    'text-[var(--signal-info)]',
  POST:   'text-[var(--signal-success)]',
  PUT:    'text-[var(--signal-warn)]',
  PATCH:  'text-[var(--signal-warn)]',
  DELETE: 'text-[var(--signal-danger)]',
  HEAD:    'text-[var(--ink-muted)]',
  OPTIONS: 'text-[var(--ink-muted)]',
};

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
  const [keyword, setKeyword] = useState('');
  const [wrapLines, setWrapLines] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [showLineMeta, setShowLineMeta] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [manualPaused, setManualPaused] = useState(false);
  const [hiddenPaused, setHiddenPaused] = useState(
    typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false
  );
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const [exportMenuStyle, setExportMenuStyle] = useState<CSSProperties>({});
  const [viewState, dispatchViewState] = useReducer(reduceLogViewState, INITIAL_LOG_VIEW_STATE);

  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null);

  // 运行时日志级别 —— 与上面的 filterLevel(仅前端展示过滤)严格区分。
  // 这里改的是 backend(zerolog.SetGlobalLevel) 与 ai-service(root logger
  // setLevel)的实际"记录"门槛,改 INFO → DEBUG 后 docker logs 才会真的多出
  // 调试行;改 INFO → WARN 后业务 INFO 行连写都不写,显著降低 IO。
  const [runtimeLevel, setRuntimeLevel] = useState<LogLevelStatus | null>(null);
  const [runtimeLevelError, setRuntimeLevelError] = useState<string | null>(null);
  const [runtimeLevelApplying, setRuntimeLevelApplying] = useState<'backend' | 'aiService' | null>(null);

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

  useEffect(() => {
    if (!downloadFeedback) {
      return;
    }

    const feedbackTimer = window.setTimeout(() => {
      setDownloadFeedback(null);
    }, 4000);

    return () => {
      window.clearTimeout(feedbackTimer);
    };
  }, [downloadFeedback]);

  // 仅在使用应用日志(非容器视图)时加载运行时级别 —— 容器日志查看场景下
  // 这两个 select 没有意义。
  useEffect(() => {
    if (!useAppLogs) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await systemService.getLogLevel();
        if (cancelled) return;
        if (response?.code === 200 && response.data) {
          setRuntimeLevel(response.data);
          setRuntimeLevelError(response.data.aiServiceError || null);
        } else {
          setRuntimeLevelError(response?.message || '无法加载运行时日志级别');
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : '无法加载运行时日志级别';
        setRuntimeLevelError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useAppLogs]);

  const applyRuntimeLevel = useCallback(async (target: 'backend' | 'aiService', value: string) => {
    setRuntimeLevelApplying(target);
    setRuntimeLevelError(null);
    try {
      const payload = target === 'backend' ? { backend: value } : { aiService: value };
      const response = await systemService.setLogLevel(payload);
      if (response?.code === 200 && response.data) {
        setRuntimeLevel(response.data);
        if (response.data.aiServiceError) {
          setRuntimeLevelError(response.data.aiServiceError);
        }
      } else {
        setRuntimeLevelError(response?.message || '调整运行时日志级别失败');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '调整运行时日志级别失败';
      setRuntimeLevelError(message);
    } finally {
      setRuntimeLevelApplying(null);
    }
  }, []);

  // 选中某个容器时,容器视图优先于 backend 聚合日志 —— MonitorPage 只负责
  // 传 containerId,不显式翻转 useAppLogs,所以这里用 containerId 作为唯一
  // 来源开关,避免"点容器→刷新→仍显示 backend 日志"的体感 bug。
  const viewingContainer = Boolean(containerId);
  // 容器日志 API 不接收 level 参数,派生一个稳定值入依赖,避免容器视图
  // 下 level dropdown 触发无意义的 refetch。
  const effectiveFilterLevel = viewingContainer ? 'ALL' : filterLevel;

  const getTitle = useCallback(() => {
    if (viewingContainer) {
      return containerName || containerId?.slice(0, 12) || '日志查看器';
    }
    if (useAppLogs) {
      return 'Backend (Go)';
    }
    return '日志查看器';
  }, [viewingContainer, useAppLogs, containerName, containerId]);

  useEffect(() => {
    setLogs([]);
    setManualPaused(false);
    retryAttemptRef.current = 0;
    shouldMergeOnRecoveryRef.current = false;
    setAutoScroll(true);
    setExporting(false);
    setDownloadFeedback(null);
    dispatchViewState({ type: 'RESET_CONTEXT' });
  }, [containerId, useAppLogs]);

  useEffect(() => {
    if (isPaused) return;
    if (!useAppLogs && !containerId) return;

    const fetchLogs = async () => {
      dispatchViewState({ type: 'FETCH_START' });
      try {
        if (!viewingContainer) {
          const result = await systemService.getLogs(effectiveFilterLevel, MAX_LOG_LINES);

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
  }, [containerId, refreshInterval, isPaused, viewingContainer, useAppLogs, effectiveFilterLevel, refreshTick, MAX_LOG_LINES]);

  useEffect(() => {
    if (autoScroll && !isPaused && scrollRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      scrollRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, [logs, isPaused, autoScroll]);

  /* -------------------------------------------------------------
   * 导出菜单 portal 定位 + outside click dismiss
   * ------------------------------------------------------------- */
  useLayoutEffect(() => {
    if (!exportMenuOpen || !exportTriggerRef.current) return;
    const rect = exportTriggerRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const margin = 8;
    // 移动端窄屏：菜单宽度自适应，最大 280，最小留 16px 边距
    const menuW = Math.min(280, viewportW - margin * 2);
    // 优先右对齐到触发器，但若会被左侧裁切则回退到左对齐到视口 margin
    const idealLeft = rect.right - menuW;
    const left = Math.max(margin, Math.min(idealLeft, viewportW - menuW - margin));
    const next: CSSProperties = {
      position: 'fixed',
      top: rect.bottom + 6,
      left,
      width: menuW,
      zIndex: 10000,
    };
    setExportMenuStyle(next);
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        exportTriggerRef.current && !exportTriggerRef.current.contains(t) &&
        exportMenuRef.current && !exportMenuRef.current.contains(t)
      ) {
        setExportMenuOpen(false);
      }
    };
    const onScroll = (e: Event) => {
      if (exportMenuRef.current && exportMenuRef.current.contains(e.target as Node)) return;
      setExportMenuOpen(false);
    };
    // 必须用同一引用 add/remove，匿名箭头函数在 cleanup 时无法对应卸载，会泄漏。
    const onResize = () => setExportMenuOpen(false);
    document.addEventListener('mousedown', onClick);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [exportMenuOpen]);

  const normalizedKeyword = keyword.trim().toLowerCase();
  const visibleLogs = useMemo(() => {
    if (!normalizedKeyword) {
      return logs;
    }
    return logs.filter((line) => line.toLowerCase().includes(normalizedKeyword));
  }, [logs, normalizedKeyword]);

  // 提前解析日志行，避免每次 render 时 map 中重复跑 4 个 regex。
  // 跟着 visibleLogs 变化重算 —— 关键字过滤后子集变小，解析开销也随之缩减。
  const parsedVisibleLogs = useMemo(
    () => visibleLogs.map((line) => parseLogLine(line)),
    [visibleLogs],
  );

  const preserveScrollContext = (updater: () => void) => {
    const previousScrollTop = scrollRef.current?.scrollTop ?? null;
    updater();
    if (previousScrollTop === null) {
      return;
    }
    window.requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = previousScrollTop;
      }
    });
  };

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 50;
      if (isAtBottom !== autoScroll) {
        setAutoScroll(isAtBottom);
      }
    }
  };

  const buildExportFilename = (type: 'raw' | 'view' | 'recent') => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `aetherblog-${type}-${filterLevel.toLowerCase()}-${timestamp}.log`;
  };

  const triggerFileDownload = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleDownload = async () => {
    if (!useAppLogs) {
      return;
    }

    setExporting(true);
    setDownloadFeedback(null);

    try {
      const url = systemService.getLogDownloadUrl(filterLevel);
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error('日志文件下载失败');
      }

      const content = await response.text();
      if (!content.trim()) {
        throw new Error('日志文件为空，无法下载');
      }

      triggerFileDownload(content, buildExportFilename('raw'));
      setDownloadFeedback('原始日志下载完成');
    } catch (error) {
      const message = error instanceof Error ? error.message : '日志文件下载失败';
      setDownloadFeedback(message);
    } finally {
      setExporting(false);
    }
  };

  const handleExportCurrentView = () => {
    setDownloadFeedback(null);

    if (visibleLogs.length === 0) {
      setDownloadFeedback('当前筛选无日志可导出');
      return;
    }

    triggerFileDownload(`${visibleLogs.join('\n')}\n`, buildExportFilename('view'));
    setDownloadFeedback(`已导出当前筛选 ${visibleLogs.length} 行`);
  };

  const handleExportRecentLines = (lineCount: number) => {
    setDownloadFeedback(null);

    if (visibleLogs.length === 0) {
      setDownloadFeedback('当前筛选无日志可导出');
      return;
    }

    const recentLogs = visibleLogs.slice(-lineCount);
    triggerFileDownload(`${recentLogs.join('\n')}\n`, buildExportFilename('recent'));
    setDownloadFeedback(`已导出最近 ${recentLogs.length} 行`);
  };

  const handleManualRefresh = () => {
    setManualPaused(false);
    setRefreshTick(value => value + 1);
  };

  if (!useAppLogs && !containerId) {
    return (
      <div className={cn('surface-leaf surface-dashboard-card rounded-xl flex flex-col items-center justify-center text-[var(--text-muted)] h-full min-h-[400px]', className)}>
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
    healthy: 'bg-status-success-light text-status-success border-status-success-border',
    no_data: 'bg-status-warning-light text-status-warning border-status-warning-border',
    error: 'bg-status-danger-light text-status-danger border-status-danger-border',
    paused: 'bg-status-warning-light text-status-warning border-status-warning-border',
  };

  const statusLabel = statusLabelMap[viewState.lifecycle];
  const statusClassName = statusClassMap[viewState.lifecycle];
  const pauseReasonLabel = viewState.pauseReason === 'hidden' ? '页面隐藏自动暂停' : '手动暂停';
  const isRawDownloadDisabled = exporting || isLoading;
  const isViewExportDisabled = exporting || visibleLogs.length === 0;
  const downloadFeedbackTone =
    !downloadFeedback
      ? 'neutral'
      : downloadFeedback.includes('失败') || downloadFeedback.includes('为空')
        ? 'error'
        : downloadFeedback.includes('无日志')
          ? 'warn'
          : 'success';

  const handleScrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    setAutoScroll(true);
  };

  /* -------------------------------------------------------------
   * 主工具栏 —— 始终显示
   * ------------------------------------------------------------- */
  const LEVEL_SEGMENTS = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const;

  const renderMainToolbar = () => (
    <div className="px-4 py-2.5 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] flex items-center gap-3 flex-wrap">
      {/* 级别段控 —— 唯一的级别过滤入口（替代原"全部日志"下拉 + 段控的二选一困惑） */}
      <div className="inline-flex items-center p-0.5 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
        {LEVEL_SEGMENTS.map((lvl) => {
          const isSelected = filterLevel === lvl;
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => preserveScrollContext(() => setFilterLevel(lvl))}
              className={cn(
                'h-7 px-3 rounded-full text-[11px] font-mono uppercase tracking-[0.12em]',
                'transition-[background-color,color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                isSelected
                  ? 'bg-[var(--bg-leaf)] text-[var(--ink-primary)] shadow-[0_1px_2px_color-mix(in_oklch,var(--ink-primary)_8%,transparent)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
              )}
            >
              {lvl}
            </button>
          );
        })}
      </div>

      {/* 搜索 */}
      <div className="relative flex-1 min-w-[180px] max-w-[420px]">
        <SearchIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-muted)] pointer-events-none" />
        <input
          type="text"
          value={keyword}
          onChange={(e) => {
            const next = e.target.value;
            preserveScrollContext(() => setKeyword(next));
          }}
          placeholder="过滤关键字"
          className={cn(
            'w-full h-8 pl-8 pr-7 rounded-md text-xs',
            'bg-[var(--bg-leaf)] border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]',
            'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)]',
            'transition-[border-color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
            'hover:border-[color-mix(in_oklch,var(--aurora-1)_25%,transparent)]',
            'focus:outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_50%,transparent)]',
            'focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
          )}
        />
        {keyword && (
          <button
            type="button"
            onClick={() => setKeyword('')}
            aria-label="清空关键字"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded text-[var(--ink-muted)] hover:text-[var(--ink-primary)] transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* 高级展开 */}
      <button
        type="button"
        onClick={() => setToolbarExpanded(v => !v)}
        aria-expanded={toolbarExpanded}
        aria-controls="log-viewer-advanced-toolbar"
        className={cn(
          'h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[11px] font-mono uppercase tracking-[0.12em] border',
          'transition-[background-color,border-color,color] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
          toolbarExpanded
            ? 'border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] text-[var(--ink-primary)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
            : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
        )}
        title="显示设置 / 字号 / 运行时门槛"
      >
        <Sliders className="w-3.5 h-3.5" />
        <span>设置</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', toolbarExpanded && 'rotate-180')} />
      </button>

      {/* 导出菜单 */}
      <button
        ref={exportTriggerRef}
        type="button"
        onClick={() => setExportMenuOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={exportMenuOpen}
        aria-controls="log-viewer-export-menu"
        disabled={isViewExportDisabled && (!useAppLogs || isRawDownloadDisabled)}
        className={cn(
          'h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[11px] font-mono uppercase tracking-[0.12em] border',
          'transition-[background-color,border-color,color] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          exportMenuOpen
            ? 'border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] text-[var(--ink-primary)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
            : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
        )}
      >
        <FileDown className="w-3.5 h-3.5" />
        <span>导出</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', exportMenuOpen && 'rotate-180')} />
      </button>
    </div>
  );

  /* -------------------------------------------------------------
   * 高级折叠区 —— 显示 / 字号 / 运行时门槛
   * ------------------------------------------------------------- */
  const renderAdvancedToolbar = () => (
    <AnimatePresence initial={false}>
      {toolbarExpanded && (
        <motion.div
          id="log-viewer-advanced-toolbar"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <div className="px-4 py-3 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            {/* 显示开关 */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)] w-[70px] shrink-0">显示</span>
              {([
                { active: wrapLines,    label: '换行', onClick: () => preserveScrollContext(() => setWrapLines(v => !v)) },
                { active: compactMode,  label: '紧凑', onClick: () => preserveScrollContext(() => setCompactMode(v => !v)) },
                { active: showLineMeta, label: '行号', onClick: () => preserveScrollContext(() => setShowLineMeta(v => !v)) },
                { active: rawMode,      label: '原始', onClick: () => preserveScrollContext(() => setRawMode(v => !v)) },
              ] as const).map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={opt.onClick}
                  className={cn(
                    'h-7 px-3 rounded-full text-[11px] font-mono uppercase tracking-[0.12em] border',
                    'transition-[background-color,border-color,color] duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                    opt.active
                      ? 'border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] text-[var(--ink-primary)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]'
                      : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* 字号 */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)] w-[70px] shrink-0">字号</span>
              <input
                type="range"
                min="10"
                max="20"
                step="1"
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                className="flex-1 h-1 bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] rounded-lg appearance-none cursor-pointer accent-[var(--aurora-1)]"
                aria-label={`字号 ${fontSize}px`}
              />
              <span className="text-[11px] font-mono text-[var(--ink-muted)] tnum w-12 text-right">{fontSize}px</span>
            </div>

            {/* 运行时门槛 */}
            {useAppLogs && (
              <div className="md:col-span-2 flex items-center gap-3 flex-wrap">
                <span
                  className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)] w-[70px] shrink-0"
                  title="调整 backend / ai-service 实际记录的最低级别。不持久化，重启后回到环境变量。"
                >
                  门槛
                </span>
                <div className="inline-flex items-center gap-2">
                  <span className="text-[11px] font-mono text-[var(--ink-muted)]">backend</span>
                  <Select
                    size="sm"
                    fullWidth={false}
                    className="min-w-[120px]"
                    value={(runtimeLevel?.backend || 'info').toLowerCase()}
                    disabled={runtimeLevelApplying === 'backend'}
                    onValueChange={(v) => void applyRuntimeLevel('backend', v)}
                    options={[
                      { value: 'debug', label: 'DEBUG' },
                      { value: 'info',  label: 'INFO' },
                      { value: 'warn',  label: 'WARN' },
                      { value: 'error', label: 'ERROR' },
                    ]}
                    ariaLabel={`backend 当前级别: ${runtimeLevel?.backend ?? '加载中'}`}
                  />
                </div>
                <div className="inline-flex items-center gap-2">
                  <span className="text-[11px] font-mono text-[var(--ink-muted)]">ai-service</span>
                  <Select
                    size="sm"
                    fullWidth={false}
                    className="min-w-[120px]"
                    value={((runtimeLevel?.aiService) || 'info').toLowerCase()}
                    disabled={runtimeLevelApplying === 'aiService' || Boolean(runtimeLevel?.aiServiceError)}
                    onValueChange={(v) => void applyRuntimeLevel('aiService', v)}
                    options={[
                      { value: 'debug',   label: 'DEBUG' },
                      { value: 'info',    label: 'INFO' },
                      { value: 'warning', label: 'WARN' },
                      { value: 'error',   label: 'ERROR' },
                    ]}
                    ariaLabel={runtimeLevel?.aiServiceError ? `ai-service 不可达: ${runtimeLevel.aiServiceError}` : `ai-service 当前级别: ${runtimeLevel?.aiService ?? '加载中'}`}
                  />
                </div>
                {runtimeLevelError && (
                  <span
                    className="text-[11px] text-[var(--signal-warn)] truncate max-w-[200px] inline-flex items-center gap-1"
                    title={runtimeLevelError}
                  >
                    <span aria-hidden>⚠</span> {runtimeLevelError}
                  </span>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  /* -------------------------------------------------------------
   * 导出菜单 —— portal 弹层
   * ------------------------------------------------------------- */
  const renderExportMenuPortal = () => {
    if (typeof window === 'undefined') return null;
    return createPortal(
      <AnimatePresence>
        {exportMenuOpen && (
          <motion.div
            id="log-viewer-export-menu"
            ref={exportMenuRef}
            style={exportMenuStyle}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="surface-overlay rounded-xl p-1.5"
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              disabled={isViewExportDisabled}
              onClick={() => {
                handleExportCurrentView();
                setExportMenuOpen(false);
              }}
              className={cn(
                'w-full text-left px-3 py-2 rounded-lg text-sm flex items-start gap-2.5',
                'transition-[background-color,color] duration-[var(--dur-instant)]',
                isViewExportDisabled
                  ? 'opacity-40 cursor-not-allowed text-[var(--ink-muted)]'
                  : 'text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
              )}
            >
              <FileDown className="w-4 h-4 mt-0.5 text-[var(--aurora-1)] shrink-0" />
              <span className="flex-1">
                <span className="block">导出当前视图</span>
                <span className="block text-[11px] font-mono text-[var(--ink-muted)] mt-0.5">
                  按当前过滤导出 {visibleLogs.length} 行
                </span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={isViewExportDisabled}
              onClick={() => {
                handleExportRecentLines(500);
                setExportMenuOpen(false);
              }}
              className={cn(
                'w-full text-left px-3 py-2 rounded-lg text-sm flex items-start gap-2.5',
                'transition-[background-color,color] duration-[var(--dur-instant)]',
                isViewExportDisabled
                  ? 'opacity-40 cursor-not-allowed text-[var(--ink-muted)]'
                  : 'text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
              )}
            >
              <FileDown className="w-4 h-4 mt-0.5 text-[var(--aurora-1)] shrink-0" />
              <span className="flex-1">
                <span className="block">导出最近 500 行</span>
                <span className="block text-[11px] font-mono text-[var(--ink-muted)] mt-0.5">
                  快速截取尾部 500 条
                </span>
              </span>
            </button>
            {useAppLogs && (
              <>
                <div className="my-1 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={isRawDownloadDisabled}
                  onClick={() => {
                    void handleDownload();
                    setExportMenuOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-lg text-sm flex items-start gap-2.5',
                    'transition-[background-color,color] duration-[var(--dur-instant)]',
                    isRawDownloadDisabled
                      ? 'opacity-40 cursor-not-allowed text-[var(--ink-muted)]'
                      : 'text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
                  )}
                >
                  {exporting
                    ? <RefreshCw className="w-4 h-4 mt-0.5 text-[var(--aurora-1)] shrink-0 animate-spin" />
                    : <Download className="w-4 h-4 mt-0.5 text-[var(--aurora-1)] shrink-0" />}
                  <span className="flex-1">
                    <span className="block">下载完整原始日志</span>
                    <span className="block text-[11px] font-mono text-[var(--ink-muted)] mt-0.5">
                      从服务端按 {filterLevel} 级别拉取
                    </span>
                  </span>
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    );
  };

  const renderActionButtons = (showFullscreenToggle: boolean) => (
    <div className="flex items-center gap-1">
      <button
        className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
        onClick={handleManualRefresh}
        title="立即重试"
        aria-label="立即重试"
      >
        <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
      </button>
      <button
        className={cn('inline-flex items-center justify-center w-7 h-7 rounded transition-colors', autoScroll ? 'text-primary bg-primary/10' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]')}
        onClick={() => setAutoScroll(!autoScroll)}
        title={autoScroll ? '自动滚动开启' : '自动滚动关闭'}
        aria-label={autoScroll ? '自动滚动开启' : '自动滚动关闭'}
        aria-pressed={autoScroll}
      >
        <ArrowDown className="w-3.5 h-3.5" />
      </button>
      <button
        className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
        onClick={() => setManualPaused(previous => !previous)}
        title={manualPaused ? '继续滚动' : '暂停滚动'}
        aria-label={manualPaused ? '继续滚动' : '暂停滚动'}
      >
        {manualPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
      </button>
      <button
        className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
        onClick={() => setLogs([])}
        title="清空屏幕"
        aria-label="清空屏幕"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      {showFullscreenToggle && (
        <button
          ref={fullscreenTriggerRef}
          className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
          onClick={() => dispatchViewState({ type: isFullScreen ? 'EXIT_FULLSCREEN' : 'ENTER_FULLSCREEN' })}
          title={isFullScreen ? '退出全屏' : '全屏显示'}
          aria-label={isFullScreen ? '退出全屏' : '全屏显示'}
        >
          {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );

  const renderLogArea = () => (
    <>
      {downloadFeedback && (
        <div
          className={cn(
            'mx-4 mt-2 rounded-md border px-3 py-2 text-[11px]',
            downloadFeedbackTone === 'error'
              ? 'border-status-danger-border bg-status-danger-light text-status-danger'
              : downloadFeedbackTone === 'warn'
                ? 'border-status-warning-border bg-status-warning-light text-status-warning'
                : 'border-status-success-border bg-status-success-light text-status-success'
          )}
          role={downloadFeedbackTone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {downloadFeedback}
        </div>
      )}

      {(viewState.lifecycle === 'error' || viewState.lifecycle === 'no_data') && (
        <div className={cn(
          'mx-4 mt-3 rounded-md px-3 py-2 text-xs border',
          viewState.lifecycle === 'error'
            ? 'bg-status-danger-light text-status-danger border-status-danger-border'
            : 'bg-status-warning-light text-status-warning border-status-warning-border'
        )}>
          {viewState.message || (viewState.lifecycle === 'error' ? '日志服务异常' : '当前暂无日志')}
          {viewState.errorCategory && <span className="ml-2 opacity-80">({viewState.errorCategory})</span>}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-[var(--ink-secondary)] custom-scrollbar bg-[var(--bg-card)] relative"
        style={{ fontSize: `${fontSize}px` }}
      >
        {isLoading && logs.length === 0 && viewState.lastActiveLifecycle === 'idle' ? (
          <div className="flex items-center justify-center h-full text-[var(--ink-muted)] gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>正在加载日志…</span>
          </div>
        ) : visibleLogs.length > 0 ? rawMode ? (
          <div className={cn('px-2', compactMode ? 'py-1' : 'py-2')}>
            {visibleLogs.map((line, index) => (
              <div
                key={`raw-${index}-${line.slice(0, 24)}`}
                className={cn(
                  'leading-relaxed text-[var(--ink-secondary)]',
                  compactMode ? 'px-2 py-0.5' : 'px-2 py-1',
                  wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-x-auto'
                )}
              >
                {line || ' '}
              </div>
            ))}
          </div>
        ) : (
          <div className={cn('px-2', compactMode ? 'py-1' : 'py-2')}>
            {parsedVisibleLogs.map((parsed, index) => {
              const line = parsed.raw;
              const lvlStyle = parsed.level ? LEVEL_STYLES[parsed.level] : null;

              // 主行的左侧光带颜色（替代原 includes 误判）
              const stripeColor = parsed.level === 'ERROR' || parsed.level === 'FATAL'
                ? 'before:bg-[var(--signal-danger)]'
                : parsed.level === 'WARN'
                  ? 'before:bg-[var(--signal-warn)]'
                  : parsed.level === 'DEBUG' || parsed.level === 'TRACE'
                    ? 'before:bg-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]'
                    : '';

              return (
                <div
                  key={`${index}-${line.slice(0, 24)}`}
                  className={cn(
                    'group relative rounded-md flex items-start gap-2.5',
                    'transition-colors duration-[var(--dur-instant)]',
                    'hover:bg-[color-mix(in_oklch,var(--aurora-1)_4%,transparent)]',
                    compactMode ? 'px-2 py-0.5' : 'px-2 py-1',
                    // 左侧 2px 极光光带（仅有 level 的行）
                    stripeColor && cn(
                      'before:content-[""] before:absolute before:left-0 before:top-1.5 before:bottom-1.5',
                      'before:w-[2px] before:rounded-full before:opacity-70',
                      stripeColor
                    )
                  )}
                >
                  {/* 行号 / 时间戳 列 */}
                  {showLineMeta && (
                    <div className="shrink-0 w-[100px] text-[10px] font-mono text-[var(--ink-muted)] tnum leading-relaxed select-none pt-px">
                      <span className="opacity-60">#{(index + 1).toString().padStart(4, ' ')}</span>
                      {parsed.timestamp && (
                        <span className="ml-1.5">{parsed.timestamp}</span>
                      )}
                    </div>
                  )}
                  {!showLineMeta && parsed.timestamp && (
                    <span className="shrink-0 font-mono text-[var(--ink-muted)] tnum leading-relaxed pt-px text-[0.92em]">
                      {parsed.timestamp}
                    </span>
                  )}

                  {/* 级别徽章 */}
                  {lvlStyle && (
                    <span
                      className={cn(
                        'shrink-0 inline-flex items-center justify-center h-[18px] min-w-[44px] px-1.5 rounded text-[10px] font-mono font-semibold tracking-wider border mt-px',
                        lvlStyle.bg, lvlStyle.text, lvlStyle.border
                      )}
                    >
                      {lvlStyle.label}
                    </span>
                  )}

                  {/* 主体（HTTP / 普通文本） */}
                  <div className={cn(
                    'flex-1 min-w-0 leading-relaxed',
                    wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-x-auto'
                  )}>
                    {parsed.method && parsed.path && parsed.status !== null ? (
                      <span className="inline-flex items-center gap-2 flex-wrap">
                        <span className={cn('font-mono font-semibold text-[0.92em]', METHOD_TONE[parsed.method] ?? 'text-[var(--ink-secondary)]')}>
                          {parsed.method}
                        </span>
                        <span className="text-[var(--ink-primary)] truncate">{parsed.path}</span>
                        <span className={cn('inline-flex items-center px-1.5 rounded font-mono font-semibold text-[10px] tnum', statusToneClasses(parsed.status))}>
                          {parsed.status}
                        </span>
                        {parsed.message && (
                          <span className="text-[var(--ink-muted)] text-[0.92em]">
                            {parsed.message}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className={lvlStyle ? 'text-[var(--ink-secondary)]' : 'text-[var(--ink-secondary)]'}>
                        {parsed.message || parsed.raw}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--ink-muted)]">
            {normalizedKeyword && logs.length > 0
              ? '关键字无匹配日志'
              : (viewState.lifecycle === 'error' ? '日志服务异常，点击右上角重试' : '当前无可展示日志')}
          </div>
        )}
      </div>

      {/* 浮动「回到底部」按钮 —— 仅在脱离底部且有日志时出现 */}
      {!autoScroll && !isPaused && visibleLogs.length > 0 && (
        <button
          type="button"
          onClick={handleScrollToBottom}
          className={cn(
            'absolute bottom-4 right-4 z-[5] inline-flex items-center gap-1.5 h-8 px-3 rounded-full',
            'surface-raised text-[11px] font-mono uppercase tracking-[0.12em] text-[var(--ink-primary)]',
            'shadow-[0_4px_16px_-4px_color-mix(in_oklch,var(--aurora-1)_30%,transparent)]',
            'hover:shadow-[0_6px_20px_-4px_color-mix(in_oklch,var(--aurora-1)_40%,transparent)]',
            'transition-shadow duration-[var(--dur-quick)]'
          )}
        >
          <ArrowDown className="w-3.5 h-3.5 text-[var(--aurora-1)]" />
          <span>回到底部</span>
        </button>
      )}
    </>
  );

  /**
   * 状态指示点 —— 比 chip 更克制，给 healthy 注入呼吸感
   */
  const renderStatusDot = () => {
    const dotColor =
      viewState.lifecycle === 'healthy' ? 'bg-[var(--signal-success)]' :
      viewState.lifecycle === 'error' ? 'bg-[var(--signal-danger)]' :
      viewState.lifecycle === 'no_data' ? 'bg-[var(--signal-warn)]' :
      viewState.lifecycle === 'paused' ? 'bg-[var(--signal-warn)]' :
      'bg-[var(--ink-muted)]';
    return (
      <span className="relative inline-flex items-center justify-center w-2 h-2 shrink-0" aria-hidden>
        <span className={cn('absolute inset-0 rounded-full opacity-40', dotColor, viewState.lifecycle === 'healthy' && 'animate-ping')} />
        <span className={cn('relative w-1.5 h-1.5 rounded-full', dotColor)} />
      </span>
    );
  };

  /**
   * 状态行 —— 顶部紧凑信息条
   */
  const renderStatusBar = () => (
    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-sm text-[var(--ink-secondary)] min-w-0">
      <Terminal className="w-4 h-4 text-[var(--aurora-1)] shrink-0" />
      <span className="font-mono font-medium text-[var(--ink-primary)] truncate min-w-0 max-w-full">{getTitle()}</span>
      <span className="inline-flex items-center gap-1.5 shrink-0 text-[11px] font-mono uppercase tracking-[0.12em] text-[var(--ink-muted)]">
        {renderStatusDot()}
        <span>{statusLabel}</span>
      </span>
      {isPaused && (
        <span className="inline-flex items-center gap-1 shrink-0 text-[10px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-full bg-[color-mix(in_oklch,var(--signal-warn)_10%,transparent)] text-[var(--signal-warn)] border border-[color-mix(in_oklch,var(--signal-warn)_22%,transparent)]">
          <Pause className="w-2.5 h-2.5" />
          {pauseReasonLabel}
        </span>
      )}
      {!autoScroll && !isPaused && (
        <button
          type="button"
          onClick={handleScrollToBottom}
          className="inline-flex items-center gap-1 shrink-0 text-[10px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] text-[var(--aurora-1)] border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] transition-colors cursor-pointer"
          title="点击回到底部并恢复自动跟随"
        >
          <ArrowDown className="w-2.5 h-2.5" />
          已暂停跟随
        </button>
      )}
      {isLoading && <RefreshCw className="w-3 h-3 animate-spin text-[var(--ink-muted)] shrink-0" />}
    </div>
  );

  const renderEmbeddedContent = () => (
    <>
      <div className="sticky top-0 z-10 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] shrink-0">
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          {renderStatusBar()}
          <div className="flex items-center gap-3">
            <div className="text-[10px] font-mono text-[var(--ink-muted)] tnum">
              最近成功 · {lastSuccessAt ? lastSuccessAt.toLocaleTimeString() : '尚无'}
            </div>
            {renderActionButtons(true)}
          </div>
        </div>
        {renderMainToolbar()}
        {renderAdvancedToolbar()}
      </div>
      {renderLogArea()}
    </>
  );

  return (
    <>
      <AnimatePresence>
        {isFullScreen && (
          <>
            <motion.div
              key="fullscreen-backdrop"
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9998]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => dispatchViewState({ type: 'EXIT_FULLSCREEN' })}
            />

            <motion.div
              key="fullscreen-panel"
              className="fixed inset-0 z-[9999] flex flex-col overflow-hidden bg-[var(--bg-primary)]"
              ref={fullscreenPanelRef}
              role="dialog"
              aria-modal="true"
              aria-label="日志全屏预览"
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* 全屏工具栏 —— 与嵌入式同样的三段结构（更宽松的间距） */}
              <div className="shrink-0 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)]">
                <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0 flex-1">
                    {renderStatusBar()}
                    <span className="hidden sm:inline text-[10px] font-mono text-[var(--ink-muted)] tnum ml-2 shrink-0">
                      {visibleLogs.length} 行 · {lastSuccessAt ? lastSuccessAt.toLocaleTimeString() : '尚无更新'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {renderActionButtons(false)}
                    <button
                      className="inline-flex items-center justify-center w-7 h-7 text-[var(--ink-muted)] hover:text-[var(--ink-primary)] rounded-md hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] transition-colors"
                      onClick={() => dispatchViewState({ type: 'EXIT_FULLSCREEN' })}
                      title="退出全屏 (Esc)"
                      aria-label="退出全屏"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {renderMainToolbar()}
                {renderAdvancedToolbar()}
              </div>
              {renderLogArea()}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {!isFullScreen && (
        <div className={cn(
          'surface-leaf surface-dashboard-card rounded-xl flex flex-col overflow-hidden transition-all duration-300 h-full min-h-[400px] relative',
          className
        )}>
          {renderEmbeddedContent()}
        </div>
      )}
      {renderExportMenuPortal()}
    </>
  );
}
