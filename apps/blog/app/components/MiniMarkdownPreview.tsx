'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Components } from 'react-markdown';

// Import KaTeX CSS (shared with MarkdownRenderer)
import 'katex/dist/katex.min.css';

interface MiniPreviewProps {
  content: string;
  maxLength?: number;
}

// 递归提取 React 子节点的文本内容
function extractTextContent(children: React.ReactNode): string {
  if (typeof children === 'string') {
    return children;
  }
  if (typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(extractTextContent).join('');
  }
  if (React.isValidElement(children)) {
    const props = children.props as { children?: React.ReactNode };
    return extractTextContent(props.children);
  }
  return '';
}

// 轻量化组件 - 预览版本不需要完整功能
const components: Components = {
  // 处理 pre 标签 - 在这里处理代码块
  pre: ({ children }) => {
    const child = React.Children.toArray(children)[0];
    
    if (React.isValidElement(child)) {
      const childProps = child.props as { className?: string; children?: React.ReactNode };
      const className = childProps.className || '';
      const match = /language-(\w+)/.exec(className);
      const language = match?.[1] || '';
      const codeContent = extractTextContent(childProps.children).trim();
      
      // Mermaid 占位符
      if (language === 'mermaid') {
        // 空内容时显示不同的占位符
        if (!codeContent) {
          return (
            <div className="my-2 p-2 bg-slate-800/30 border border-white/5 rounded text-center text-xs text-gray-600">
              📊 空流程图
            </div>
          );
        }
        return (
          <div className="my-2 p-3 bg-slate-800/50 border border-white/5 rounded text-center text-xs text-gray-500">
            📊 流程图 (点击查看)
          </div>
        );
      }
      
      // 其他代码块 - 简化显示
      if (language) {
        return (
          <div className="my-2 p-2 bg-slate-900/50 border border-white/5 rounded overflow-hidden">
            <div className="text-[10px] text-gray-500 mb-1">{language}</div>
            <pre className="text-xs text-gray-400 overflow-hidden text-ellipsis whitespace-nowrap">
              {codeContent.slice(0, 100)}{codeContent.length > 100 ? '...' : ''}
            </pre>
          </div>
        );
      }
    }
    
    return <>{children}</>;
  },
  
  // 行内代码
  code: ({ className, children }) => {
    // 如果有 className 说明是代码块内的，已由 pre 处理
    if (className) {
      return <code className={className}>{children}</code>;
    }
    // 行内代码
    return (
      <code className="bg-primary/10 text-primary/80 px-1 py-0.5 rounded text-xs font-mono">
        {children}
      </code>
    );
  },
  
  // 图片 - 实际渲染图片
  img: ({ src, alt }) => {
    if (!src) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          🖼️ <span className="text-primary/60">{alt || '图片'}</span>
        </span>
      );
    }
    return (
      <span className="block my-2">
        <img 
          src={src} 
          alt={alt || ''} 
          className="max-w-full h-auto rounded-lg border border-white/10"
          loading="lazy"
          style={{ maxHeight: '300px', objectFit: 'contain' }}
        />
        {alt && (
          <span className="block text-center text-xs text-gray-500 mt-1">{alt}</span>
        )}
      </span>
    );
  },
  
  // 表格 - 紧凑版
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-xs border-collapse">
        {children}
      </table>
    </div>
  ),
  
  th: ({ children }) => (
    <th className="bg-white/5 px-2 py-1 text-left font-medium text-gray-300 border border-white/10">
      {children}
    </th>
  ),
  
  td: ({ children }) => (
    <td className="px-2 py-1 text-gray-400 border border-white/10">
      {children}
    </td>
  ),
  
  // 链接
  a: ({ children }) => (
    <span className="text-primary/70">{children}</span>
  ),
  
  // 引用 - 简化
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/30 pl-2 my-1 text-gray-500 italic text-xs">
      {children}
    </blockquote>
  ),
  
  // 段落
  p: ({ children }) => (
    <p className="my-1">{children}</p>
  ),
  
  // 标题 - 统一样式
  h1: ({ children }) => <h3 className="text-sm font-semibold text-gray-200 my-1">{children}</h3>,
  h2: ({ children }) => <h4 className="text-sm font-semibold text-gray-200 my-1">{children}</h4>,
  h3: ({ children }) => <h5 className="text-xs font-semibold text-gray-300 my-1">{children}</h5>,
  h4: ({ children }) => <h6 className="text-xs font-medium text-gray-300 my-1">{children}</h6>,
  
  // 列表
  ul: ({ children }) => <ul className="list-disc list-inside my-1 pl-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside my-1 pl-2">{children}</ol>,
  li: ({ children }) => <li className="text-gray-400 text-xs">{children}</li>,
  
  // 水平线
  hr: () => <hr className="my-2 border-t border-white/10" />,
};

export function MiniMarkdownPreview({ content, maxLength = 2000 }: MiniPreviewProps) {
  if (!content) return null;

  // 截断内容用于预览
  const truncatedContent = content.slice(0, maxLength);

  return (
    <div className="mini-preview text-sm leading-relaxed text-gray-400">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {truncatedContent}
      </ReactMarkdown>
    </div>
  );
}

export default MiniMarkdownPreview;
