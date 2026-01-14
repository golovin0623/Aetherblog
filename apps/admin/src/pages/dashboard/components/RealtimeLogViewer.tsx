import { useState, useEffect, useRef } from 'react';
import { systemService } from '@/services/systemService';
import { Terminal, Pause, Play, Trash2, RefreshCw, Maximize2, Minimize2, Type, Filter, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RealtimeLogViewerProps {
  containerId: string | null;
  containerName?: string;
  refreshInterval?: number;
  className?: string;
}

export function RealtimeLogViewer({
  containerId,
  containerName,
  refreshInterval = 3,
  className
}: RealtimeLogViewerProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [fontSize, setFontSize] = useState(12);
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch Logs
  useEffect(() => {
    // Clear logs when container changes
    setLogs([]);
    setPaused(false);
    setAutoScroll(true);
  }, [containerId]);

  useEffect(() => {
    if (!containerId || paused) return;

    const fetchLogs = async () => {
      try {
        const data = await systemService.getContainerLogs(containerId);
        if (Array.isArray(data)) {
           setLogs(data);
        }
      } catch (err) {
        console.error("Failed to fetch logs", err);
      }
    };

    fetchLogs(); // Initial
    const timer = setInterval(fetchLogs, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [containerId, refreshInterval, paused]);

  // Auto scroll logic - Replaces scrollIntoView to prevent page jumping
  useEffect(() => {
    if (autoScroll && !paused && scrollRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      scrollRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, [logs, paused, autoScroll, filterLevel]);

  // Handle manual scroll to toggle auto-scroll
  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // If user is near bottom (within 50px), enable auto-scroll
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 50;
      if (isAtBottom !== autoScroll) {
        setAutoScroll(isAtBottom);
      }
    }
  };

  const filteredLogs = logs.filter(line => {
    if (filterLevel === 'ALL') return true;
    return line.toUpperCase().includes(filterLevel);
  });

  if (!containerId) {
    return (
      <div className={cn("rounded-xl bg-[#0f0f10] border border-white/10 flex flex-col items-center justify-center text-gray-500 h-full min-h-[400px]", className)}>
        <Terminal className="w-12 h-12 mb-4 opacity-20" />
        <p className="text-sm">请点击左侧容器列表查看日志</p>
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-xl bg-[#0f0f10] border border-white/10 flex flex-col overflow-hidden transition-all duration-300",
      isFullScreen ? "fixed inset-4 z-50 h-auto shadow-2xl" : "h-full min-h-[400px]",
      className
    )}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-white/5 border-b border-white/5 shrink-0 gap-2">
        <div className="flex items-center gap-2 text-sm text-gray-300 min-w-0">
          <Terminal className="w-4 h-4 text-primary shrink-0" />
          <span className="font-mono font-medium truncate">{containerName || containerId.slice(0, 12)}</span>
          {paused && <span className="text-[10px] bg-yellow-500/10 text-yellow-500 px-1.5 py-0.5 rounded ml-2 shrink-0">已暂停</span>}
          {!autoScroll && !paused && <span className="text-[10px] bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded ml-2 shrink-0">滚动锁定解除</span>}
        </div>

        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          {/* Font Size Slider */}
          <div className="flex items-center gap-2 group">
            <Type className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300" />
            <input
              type="range"
              min="10"
              max="20"
              step="1"
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value))}
              className="w-20 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary"
              title={`字体大小: ${fontSize}px`}
            />
          </div>

          {/* Log Level Filter */}
          <div className="flex items-center gap-1 bg-black/20 rounded p-0.5">
            <Filter className="w-3.5 h-3.5 text-gray-500 ml-1.5 mr-1" />
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="bg-transparent text-[10px] sm:text-xs text-gray-300 border-none focus:ring-0 cursor-pointer py-1 pr-6 pl-1"
            >
              <option value="ALL">全部级别</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
              <option value="DEBUG">DEBUG</option>
            </select>
          </div>

          <div className="w-px h-4 bg-white/10 mx-1" />

          {/* Controls */}
          <div className="flex items-center gap-1">
             <button
               className={cn("p-1.5 rounded transition-colors", autoScroll ? "text-primary bg-primary/10" : "text-gray-400 hover:text-white hover:bg-white/10")}
               onClick={() => setAutoScroll(!autoScroll)}
               title={autoScroll ? "自动滚动开启" : "自动滚动关闭"}
             >
               <ArrowDown className="w-3.5 h-3.5" />
             </button>
             <button
               className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-white/10 transition-colors"
               onClick={() => setPaused(!paused)}
               title={paused ? "继续滚动" : "暂停滚动"}
             >
               {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
             </button>
             <button
               className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-white/10 transition-colors"
               onClick={() => setLogs([])}
               title="清空屏幕"
             >
               <Trash2 className="w-3.5 h-3.5" />
             </button>
             <button
               className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-white/10 transition-colors"
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
        className="flex-1 overflow-y-auto p-4 font-mono text-gray-300 leading-relaxed custom-scrollbar bg-black/20"
        style={{ fontSize: `${fontSize}px` }}
      >
         {logs.length === 0 ? (
           <div className="flex items-center justify-center h-full text-gray-600">
             <RefreshCw className="w-4 h-4 animate-spin mr-2" />
             正在连接日志流...
           </div>
         ) : (
             filteredLogs.map((line, i) => (
               <div key={i} className="whitespace-pre-wrap break-all hover:bg-white/5 px-1 py-0.5 rounded transition-colors border-l-2 border-transparent hover:border-white/10">
                 {line}
               </div>
             ))
         )}
         {filteredLogs.length === 0 && logs.length > 0 && (
            <div className="text-center text-gray-600 mt-10">
              没有找到符合 "{filterLevel}" 级别的日志
            </div>
         )}
      </div>

      {/* Fullscreen Backdrop */}
      {isFullScreen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40" onClick={() => setIsFullScreen(false)} />
      )}
    </div>
  );
}
