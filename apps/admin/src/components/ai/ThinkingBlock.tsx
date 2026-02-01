import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Brain, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface ThinkingBlockProps {
  content: string;
  isActive?: boolean; // Currently receiving think content
  className?: string;
}

/**
 * Collapsible thinking block component for AI reasoning display.
 * Similar to DeepSeek/Claude thinking display.
 */
export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  content,
  isActive = false,
  className,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!content && !isActive) return null;

  return (
    <div className={cn(
      "rounded-xl overflow-hidden border transition-all duration-300",
      isActive
        ? "border-violet-500/30 bg-violet-500/5"
        : "border-[var(--border-subtle)] bg-[var(--bg-secondary)]",
      className
    )}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center gap-2 px-4 py-3 text-left transition-colors",
          "hover:bg-white/5"
        )}
      >
        <div className={cn(
          "p-1.5 rounded-lg transition-colors",
          isActive ? "bg-violet-500/20 text-violet-500" : "bg-[var(--bg-card)] text-[var(--text-muted)]"
        )}>
          {isActive ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Brain className="w-4 h-4" />
          )}
        </div>
        
        <span className={cn(
          "flex-1 text-sm font-medium",
          isActive ? "text-violet-400" : "text-[var(--text-muted)]"
        )}>
          {isActive ? "思考中..." : "思考过程"}
        </span>
        
        <span className="text-[10px] font-mono text-[var(--text-muted)] opacity-60">
          {content.length} chars
        </span>
        
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
        ) : (
          <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
        )}
      </button>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              <div className={cn(
                "p-4 rounded-lg text-sm leading-relaxed whitespace-pre-wrap",
                "bg-black/5 dark:bg-black/20",
                "text-[var(--text-secondary)] font-light",
                "max-h-[300px] overflow-y-auto scrollbar-thin"
              )}>
                {content || (
                  <span className="text-[var(--text-muted)] italic">思考内容为空</span>
                )}
                {isActive && (
                  <span className="inline-block w-2 h-4 bg-violet-500 ml-0.5 animate-pulse" />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ThinkingBlock;
