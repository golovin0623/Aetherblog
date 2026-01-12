/**
 * @file RealtimeLogViewer.tsx
 * @description 实时日志查看器组件
 */
import { useState, useEffect, useRef } from 'react';
import { systemService } from '@/services/systemService';
import { Terminal, Pause, Play, Trash2, RefreshCw } from 'lucide-react';
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
  const endRef = useRef<HTMLDivElement>(null);
  
  // Fetch Logs
  useEffect(() => {
    // Clear logs when container changes
    setLogs([]);
    setPaused(false);
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

  // Auto scroll
  useEffect(() => {
    if (!paused && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, paused]);

  if (!containerId) {
    return (
      <div className={cn("rounded-xl bg-[#0f0f10] border border-white/10 flex flex-col items-center justify-center text-gray-500 h-full min-h-[400px]", className)}>
        <Terminal className="w-12 h-12 mb-4 opacity-20" />
        <p className="text-sm">请点击左侧容器列表查看日志</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl bg-[#0f0f10] border border-white/10 flex flex-col overflow-hidden h-full min-h-[400px]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white/5 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <Terminal className="w-4 h-4 text-primary" />
          <span className="font-mono font-medium">{containerName || containerId.slice(0, 12)}</span>
          {paused && <span className="text-[10px] bg-yellow-500/10 text-yellow-500 px-1.5 py-0.5 rounded ml-2">已暂停</span>}
        </div>
        <div className="flex items-center gap-1">
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
        </div>
      </div>
      
      {/* Log Content */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] sm:text-xs text-gray-300 leading-relaxed custom-scrollbar bg-black/20">
         {logs.length === 0 ? (
           <div className="flex items-center justify-center h-full text-gray-600">
             <RefreshCw className="w-4 h-4 animate-spin mr-2" />
             正在连接日志流...
           </div>
         ) : (
             logs.map((line, i) => (
               <div key={i} className="whitespace-pre-wrap break-all hover:bg-white/5 px-1 py-0.5 rounded transition-colors border-l-2 border-transparent hover:border-white/10">
                 {line}
               </div>
             ))
         )}
         <div ref={endRef} />
      </div>
    </div>
  );
}
