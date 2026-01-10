'use client';

import React, { useState, useRef } from 'react';
import { Copy, Check, ChevronDown, ChevronUp, Terminal, Maximize2, Minimize2 } from 'lucide-react';
import { logger } from '../lib/logger';

// 语言图标映射
const LANGUAGE_ICONS: Record<string, string> = {
  javascript: '🟨',
  js: '🟨',
  typescript: '🔷',
  ts: '🔷',
  python: '🐍',
  java: '☕',
  go: '🔵',
  rust: '🦀',
  cpp: '⚡',
  c: '⚡',
  shell: '💻',
  bash: '💻',
  sql: '🗃️',
  json: '📋',
  yaml: '📝',
  dockerfile: '🐳',
  html: '🌐',
  css: '🎨',
};

// 语言显示名称
const LANGUAGE_NAMES: Record<string, string> = {
  javascript: 'JavaScript',
  js: 'JavaScript',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  python: 'Python',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  cpp: 'C++',
  c: 'C',
  shell: 'Shell',
  bash: 'Bash',
  sql: 'SQL',
  json: 'JSON',
  yaml: 'YAML',
  dockerfile: 'Dockerfile',
  html: 'HTML',
  css: 'CSS',
};

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  maxHeight?: number;
  highlightLines?: number[];
}

export const CodeBlockRenderer: React.FC<CodeBlockProps> = ({
  code,
  language = 'text',
  filename,
  showLineNumbers = true,
  maxHeight = 400,
  highlightLines = [],
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);

  const lines = code.split('\n');
  const needsCollapse = lines.length > 20;
  const displayedLines = isExpanded || !needsCollapse ? lines : lines.slice(0, 15);

  const langIcon = LANGUAGE_ICONS[language.toLowerCase()] || '📄';
  const langName = LANGUAGE_NAMES[language.toLowerCase()] || language.toUpperCase();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      logger.error('Failed to copy:', err);
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <div
      className={`group relative rounded-xl overflow-hidden border border-white/10 bg-[#1a1b26] ${
        isFullscreen
          ? 'fixed inset-4 z-50 flex flex-col'
          : ''
      }`}
    >
      {/* 全屏遮罩 */}
      {isFullscreen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm -z-10"
          onClick={toggleFullscreen}
        />
      )}

      {/* 头部工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10">
        <div className="flex items-center gap-2">
          {/* macOS 风格按钮 */}
          <div className="flex items-center gap-1.5 mr-2">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>

          {/* 语言标识 */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5">
            <span>{langIcon}</span>
            <span className="text-xs text-gray-400">{langName}</span>
          </div>

          {/* 文件名 */}
          {filename && (
            <span className="text-xs text-gray-500 font-mono">{filename}</span>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1">
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
            title={isFullscreen ? '退出全屏' : '全屏查看'}
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
          >
            {isCopied ? (
              <>
                <Check className="h-4 w-4 text-green-400" />
                <span className="text-xs text-green-400">已复制</span>
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                <span className="text-xs">复制</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 代码区域 */}
      <div
        className={`overflow-auto ${isFullscreen ? 'flex-1' : ''}`}
        style={{ maxHeight: isFullscreen ? undefined : isExpanded ? undefined : maxHeight }}
      >
        <pre
          ref={codeRef}
          className="p-4 text-sm font-mono leading-relaxed"
        >
          <code>
            {displayedLines.map((line, index) => {
              const lineNumber = index + 1;
              const isHighlighted = highlightLines.includes(lineNumber);

              return (
                <div
                  key={index}
                  className={`flex ${
                    isHighlighted ? 'bg-primary/10 -mx-4 px-4' : ''
                  }`}
                >
                  {showLineNumbers && (
                    <span className="select-none w-10 pr-4 text-right text-gray-600 flex-shrink-0">
                      {lineNumber}
                    </span>
                  )}
                  <span className={`flex-1 ${isHighlighted ? 'text-white' : 'text-gray-300'}`}>
                    {line || ' '}
                  </span>
                </div>
              );
            })}
          </code>
        </pre>
      </div>

      {/* 展开/折叠按钮 */}
      {needsCollapse && !isFullscreen && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-center gap-2 w-full py-2 bg-white/5 border-t border-white/10 text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-4 w-4" />
              收起代码
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              展开全部 ({lines.length} 行)
            </>
          )}
        </button>
      )}

      {/* 行数统计 */}
      <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded text-xs text-gray-600 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
        {lines.length} 行
      </div>
    </div>
  );
};

export default CodeBlockRenderer;
