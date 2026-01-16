import { useState, useEffect, useRef, useCallback } from 'react';
import { systemService } from '@/services/systemService';
import { Terminal, Pause, Play, Trash2, RefreshCw, Maximize2, Minimize2, Type, Filter, ArrowDown, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

interface RealtimeLogViewerProps {
  // 可选：容器 ID（向后兼容，新版本使用应用日志）
  containerId?: string | null;
  containerName?: string;
  // 使用应用日志模式（推荐）
  useAppLogs?: boolean;
  refreshInterval?: number;
  className?: string;
}

export function RealtimeLogViewer({
  containerId,
  containerName,
  useAppLogs = true,  // 默认使用应用日志
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

  const scrollRef = useRef<HTMLDivElement>(null);

  // 获取日志标题
  const getTitle = useCallback(() => {
    if (useAppLogs) {
      return 'Backend (Java)';
    }
    return containerName || containerId?.slice(0, 12) || '日志查看器';
  }, [useAppLogs, containerName, containerId]);

  // 当日志级别改变时重新获取日志
  useEffect(() => {
    setLogs([]);
    setPaused(false);
    setAutoScroll(true);
  }, [filterLevel, containerId, useAppLogs]);

  // Fetch Logs
  useEffect(() => {
    if (paused) return;
    if (!useAppLogs && !containerId) return;

    const fetchLogs = async () => {
      setLoading(true);
      try {
        let data: string[];
        if (useAppLogs) {
          // 使用新的应用日志 API
          data = await systemService.getLogs(filterLevel, 2000);
        } else {
          // 向后兼容：使用容器日志
          data = await systemService.getContainerLogs(containerId!);
        }
        
        if (Array.isArray(data)) {
          setLogs(data);
        }
      } catch (err) {
        logger.error("Failed to fetch logs", err);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs(); // Initial
    const timer = setInterval(fetchLogs, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [containerId, refreshInterval, paused, useAppLogs, filterLevel]);

  // Auto scroll logic
  useEffect(() => {
    if (autoScroll && !paused && scrollRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      scrollRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, [logs, paused, autoScroll]);

  // Handle manual scroll to toggle auto-scroll
  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 50;
      if (isAtBottom !== autoScroll) {
        setAutoScroll(isAtBottom);
      }
    }
  };

  // 下载日志
  const handleDownload = () => {
    if (useAppLogs) {
      const url = systemService.getLogDownloadUrl(filterLevel);
      window.open(url, '_blank');
    }
  };

  // 如果不使用应用日志且没有容器 ID，显示占位
  if (!useAppLogs && !containerId) {
    return (
      <div className={cn("rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col items-center justify-center text-[var(--text-muted)] h-full min-h-[400px]", className)}>
        <Terminal className="w-12 h-12 mb-4 opacity-20" />
        <p className="text-sm">请点击左侧容器列表查看日志</p>
      </div>
    );
  }

  // 如果使用应用日志，根据过滤级别过滤显示
  // 注意：新版本后端已按级别返回日志，无需前端过滤
  const displayLogs = logs;

  // Extract content rendering to reusable function
  const renderContent = () => (
    <>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] shrink-0 gap-2">
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] min-w-0">
          <Terminal className="w-4 h-4 text-primary shrink-0" />
          <span className="font-mono font-medium truncate">{getTitle()}</span>
          {paused && <span className="text-[10px] bg-yellow-500/10 text-yellow-500 px-1.5 py-0.5 rounded ml-2 shrink-0">已暂停</span>}
          {!autoScroll && !paused && <span className="text-[10px] bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded ml-2 shrink-0">滚动锁定解除</span>}
          {loading && <RefreshCw className="w-3 h-3 animate-spin text-[var(--text-muted)] ml-2" />}
        </div>

        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          {/* Font Size Slider */}
          <div className="flex items-center gap-2 group">
            <Type className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-primary)]" />
            <input
              type="range"
              min="10"
              max="20"
              step="1"
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value))}
              className="w-20 h-1 bg-[var(--bg-secondary)] rounded-lg appearance-none cursor-pointer accent-primary"
              title={`字体大小: ${fontSize}px`}
            />
          </div>

          {/* Log Level Filter */}
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

          {/* Controls */}
          <div className="flex items-center gap-1">
             {/* Download Button */}
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
               className={cn("p-1.5 rounded transition-colors", autoScroll ? "text-primary bg-primary/10" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]")}
               onClick={() => setAutoScroll(!autoScroll)}
               title={autoScroll ? "自动滚动开启" : "自动滚动关闭"}
             >
               <ArrowDown className="w-3.5 h-3.5" />
             </button>
             <button
               className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-card-hover)] transition-colors"
               onClick={() => setPaused(!paused)}
               title={paused ? "继续滚动" : "暂停滚动"}
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
               title={isFullScreen ? "退出全屏" : "全屏显示"}
             >
               {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
             </button>
          </div>
        </div>
      </div>

      {/* Log Content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 font-mono text-[var(--text-secondary)] leading-relaxed custom-scrollbar bg-[var(--bg-card)]"
        style={{ fontSize: `${fontSize}px` }}
      >
         {logs.length === 0 ? (
           <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
             <RefreshCw className="w-4 h-4 animate-spin mr-2" />
             正在加载日志...
           </div>
         ) : (
             displayLogs.map((line, i) => (
               <div key={i} className={cn(
                 "whitespace-pre-wrap break-all hover:bg-[var(--bg-card-hover)] px-1 py-0.5 rounded transition-colors border-l-2",
                 line.includes('ERROR') ? "border-red-500/50 bg-red-500/5 dark:bg-red-500/10" :
                 line.includes('WARN') ? "border-yellow-500/50 bg-yellow-500/5 dark:bg-yellow-500/10" :
                 line.includes('DEBUG') ? "border-blue-500/50" :
                 "border-transparent hover:border-[var(--border-subtle)]"
               )}>
                 {line}
               </div>
             ))
         )}
         {displayLogs.length === 0 && logs.length > 0 && (
            <div className="text-center text-[var(--text-muted)] mt-10">
              没有找到符合 "{filterLevel}" 级别的日志
            </div>
         )}
      </div>
    </>
  );

  // Fullscreen content (uses renderContent defined above)
  const fullscreenContent = isFullScreen && (
    <>
      {/* Fullscreen Backdrop */}
      <div 
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9998]" 
        onClick={() => setIsFullScreen(false)} 
      />
      
      {/* Fullscreen Panel */}
      <div className={cn(
        "fixed inset-4 z-[9999] rounded-xl border border-[var(--border-subtle)] flex flex-col overflow-hidden shadow-2xl bg-[var(--bg-primary)]",
        className
      )}>
        {renderContent()}
      </div>
    </>
  );

  return (
    <>
      {/* Fullscreen mode - rendered with very high z-index */}
      {fullscreenContent}
      
      {/* Normal (non-fullscreen) mode */}
      {!isFullScreen && (
        <div className={cn(
          "rounded-xl border border-[var(--border-subtle)] flex flex-col overflow-hidden transition-all duration-300 bg-[var(--bg-card)] h-full min-h-[400px]",
          className
        )}>
          {renderContent()}
        </div>
      )}
    </>
  );
}
