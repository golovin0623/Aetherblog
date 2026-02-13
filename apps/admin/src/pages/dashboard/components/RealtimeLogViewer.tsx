import { useState, useEffect, useRef, useCallback } from 'react';
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

type LogStatus = 'idle' | 'healthy' | 'no_data' | 'error';

export function RealtimeLogViewer({
  containerId,
  containerName,
  useAppLogs = true,
  refreshInterval = 3,
  className
}: RealtimeLogViewerProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [fontSize, setFontSize] = useState(12);
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const [logStatus, setLogStatus] = useState<LogStatus>('idle');
  const [logMessage, setLogMessage] = useState('');
  const [logErrorCategory, setLogErrorCategory] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const getTitle = useCallback(() => {
    if (useAppLogs) {
      return 'Backend (Java)';
    }
    return containerName || containerId?.slice(0, 12) || '日志查看器';
  }, [useAppLogs, containerName, containerId]);

  useEffect(() => {
    setLogs([]);
    setPaused(false);
    setAutoScroll(true);
    setLogStatus('idle');
    setLogMessage('');
    setLogErrorCategory(null);
  }, [filterLevel, containerId, useAppLogs]);

  useEffect(() => {
    if (paused) return;
    if (!useAppLogs && !containerId) return;

    const fetchLogs = async () => {
      setLoading(true);
      try {
        if (useAppLogs) {
          const result = await systemService.getLogs(filterLevel, 2000);
          setLogs(result.lines);

          if (result.status === 'ok') {
            setLogStatus('healthy');
            setLogMessage('');
            setLogErrorCategory(null);
            setLastSuccessAt(new Date());
          } else if (result.status === 'no_data') {
            setLogStatus('no_data');
            setLogMessage(result.message || '当前级别暂无日志');
            setLogErrorCategory(result.errorCategory || null);
          } else {
            setLogStatus('error');
            setLogMessage(result.message || '日志读取失败');
            setLogErrorCategory(result.errorCategory || null);
          }
        } else {
          const data = await systemService.getContainerLogs(containerId!);
          if (Array.isArray(data)) {
            setLogs(data);
            setLogStatus(data.length > 0 ? 'healthy' : 'no_data');
            setLogMessage(data.length > 0 ? '' : '容器当前无可显示日志');
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

        setLogStatus('error');
        setLogMessage(message || '日志请求失败');
        setLogErrorCategory(errorCategory || null);
        setLogs([]);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
    const timer = setInterval(fetchLogs, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [containerId, refreshInterval, paused, useAppLogs, filterLevel, refreshTick]);

  useEffect(() => {
    if (autoScroll && !paused && scrollRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      scrollRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, [logs, paused, autoScroll]);

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
    setPaused(false);
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

  const statusLabel =
    logStatus === 'healthy'
      ? '运行正常'
      : logStatus === 'no_data'
        ? '暂无日志'
        : logStatus === 'error'
          ? '降级中'
          : '初始化中';

  const statusClassName =
    logStatus === 'healthy'
      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
      : logStatus === 'no_data'
        ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
        : logStatus === 'error'
          ? 'bg-red-500/10 text-red-600 border-red-500/30'
          : 'bg-[var(--bg-card)] text-[var(--text-muted)] border-[var(--border-subtle)]';

  const renderContent = () => (
    <>
      <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] shrink-0 gap-2">
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] min-w-0">
          <Terminal className="w-4 h-4 text-primary shrink-0" />
          <span className="font-mono font-medium truncate">{getTitle()}</span>
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded border shrink-0', statusClassName)}>{statusLabel}</span>
          {paused && <span className="text-[10px] bg-yellow-500/10 text-yellow-500 px-1.5 py-0.5 rounded ml-1 shrink-0">已暂停</span>}
          {!autoScroll && !paused && <span className="text-[10px] bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded ml-1 shrink-0">滚动锁定解除</span>}
          {loading && <RefreshCw className="w-3 h-3 animate-spin text-[var(--text-muted)] ml-1" />}
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
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
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
              onClick={() => setPaused(!paused)}
              title={paused ? '继续滚动' : '暂停滚动'}
            >
              {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
            <button
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
              onClick={() => setLogs([])}
              title="清空屏幕"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
              onClick={() => setIsFullScreen(!isFullScreen)}
              title={isFullScreen ? '退出全屏' : '全屏显示'}
            >
              {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {(logStatus === 'error' || logStatus === 'no_data') && (
        <div className={cn(
          'mx-4 mt-3 rounded-md px-3 py-2 text-xs border',
          logStatus === 'error'
            ? 'bg-red-500/10 text-red-600 border-red-500/30'
            : 'bg-amber-500/10 text-amber-700 border-amber-500/30'
        )}>
          {logMessage || (logStatus === 'error' ? '日志服务异常' : '当前暂无日志')}
          {logErrorCategory && <span className="ml-2 opacity-80">({logErrorCategory})</span>}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 font-mono text-[var(--text-secondary)] leading-relaxed custom-scrollbar bg-[var(--bg-card)]"
        style={{ fontSize: `${fontSize}px` }}
      >
        {loading && logs.length === 0 && logStatus === 'idle' ? (
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
            {logStatus === 'error' ? '日志服务异常，点击右上角重试' : '当前无可展示日志'}
          </div>
        )}
      </div>
    </>
  );

  const fullscreenContent = isFullScreen && (
    <>
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9998]"
        onClick={() => setIsFullScreen(false)}
      />

      <div className={cn(
        'fixed inset-4 z-[9999] rounded-xl border border-[var(--border-subtle)] flex flex-col overflow-hidden shadow-2xl bg-[var(--bg-primary)]',
        className
      )}>
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
