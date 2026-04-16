'use client';

import Image from 'next/image';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import remarkAlertBlock from '../lib/remarkAlertBlock';
import rehypeKatex from 'rehype-katex';
import type { Components } from 'react-markdown';

// 引入 KaTeX CSS (与 MarkdownRenderer 共享)
import 'katex/dist/katex.min.css';

const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkDirective, remarkAlertBlock];
const REHYPE_PLUGINS = [rehypeKatex];
const GENERIC_IMAGE_ALT_PATTERN = /^(image|img|screenshot|snipaste|picture|photo)[-_ ]?\d*\\.(png|jpe?g|gif|webp|svg)$/i;
const FILE_NAME_ALT_PATTERN = /^[^\\/\n]+\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

// Alert 类型配置 —— 用 --signal-* 语义变量,暗/亮主题 + 用户主色族都能适配
const ALERT_CONFIG: Record<string, { label: string; varName: string }> = {
  info:    { label: '信息', varName: '--signal-info' },
  note:    { label: '注意', varName: '--ink-muted' },
  warning: { label: '警告', varName: '--signal-warn' },
  danger:  { label: '危险', varName: '--signal-danger' },
  tip:     { label: '提示', varName: '--signal-success' },
};

interface MiniPreviewProps {
  content: string;
  maxLength?: number;
}

function normalizeImageCaption(alt?: string): string | undefined {
  if (!alt) {
    return undefined;
  }

  const trimmed = alt.trim();
  if (!trimmed) {
    return undefined;
  }

  if (GENERIC_IMAGE_ALT_PATTERN.test(trimmed) || FILE_NAME_ALT_PATTERN.test(trimmed)) {
    return undefined;
  }

  return trimmed;
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
            <div className="my-2 p-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded text-center text-xs text-[var(--text-muted)]">
              📊 空流程图
            </div>
          );
        }
        return (
          <div className="my-2 p-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded text-center text-xs text-[var(--text-muted)]">
            📊 流程图 (点击查看)
          </div>
        );
      }
      
      // 其他代码块 - 简化显示
      if (language) {
        return (
          <div className="my-2 p-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded overflow-hidden">
            <div className="text-[10px] text-[var(--text-muted)] mb-1">{language}</div>
            <pre className="text-xs text-[var(--text-secondary)] overflow-hidden text-ellipsis whitespace-nowrap">
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
  
  // 图片 - 实际渲染图片 (修复移动端等比例缩放)
  img: ({ src, alt }) => {
    if (typeof src !== 'string' || !src) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          🖼️ <span className="text-primary/60">{alt || '图片'}</span>
        </span>
      );
    }
    const caption = normalizeImageCaption(alt || undefined);
    return (
      <span className="block my-2 w-full">
        <Image
          src={src} 
          alt={caption || alt || ''} 
          unoptimized
          width={1200}
          height={800}
          className="rounded-lg border border-white/10 block"
          loading="lazy"
          style={{ maxWidth: '100%', width: 'auto', height: 'auto', maxHeight: '300px', objectFit: 'contain' }}
        />
        {caption && (
          <span className="block text-center text-xs text-gray-500 mt-1" style={{ wordBreak: 'break-word' }}>{caption}</span>
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
    <th className="bg-[var(--bg-secondary)] px-2 py-1 text-left font-medium text-[var(--text-primary)] border border-[var(--border-subtle)]">
      {children}
    </th>
  ),
  
  td: ({ children }) => (
    <td className="px-2 py-1 text-[var(--text-muted)] border border-[var(--border-subtle)]">
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
  
  // 段落 - 添加换行支持
  p: ({ children }) => (
    <p className="my-1" style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>{children}</p>
  ),
  
  // 标题 - 统一样式
  h1: ({ children }) => <h3 className="text-sm font-semibold text-[var(--text-primary)] my-1">{children}</h3>,
  h2: ({ children }) => <h4 className="text-sm font-semibold text-[var(--text-primary)] my-1">{children}</h4>,
  h3: ({ children }) => <h5 className="text-xs font-semibold text-[var(--text-secondary)] my-1">{children}</h5>,
  h4: ({ children }) => <h6 className="text-xs font-medium text-[var(--text-secondary)] my-1">{children}</h6>,
  
  // 列表 - 修复小圆点和内容同行显示
  ul: ({ children }) => <ul className="mini-preview-list-ul">{children}</ul>,
  ol: ({ children }) => <ol className="mini-preview-list-ol">{children}</ol>,
  li: ({ children }) => <li className="mini-preview-list-li">{children}</li>,
  
  // 水平线
  hr: () => <hr className="my-2 border-t border-white/10" />,

  // 自定义高亮块 (Alert Block)
  // @ts-expect-error - 自定义元素不在标准 HTML 类型中
  'alert-block': ({ node, ...props }: any) => {
    const type = props['data-type'] || 'info';
    const title = props['data-title'];
    const cfg = ALERT_CONFIG[type] || ALERT_CONFIG.info;
    const displayTitle = title || cfg.label;
    const tokenVar = `var(${cfg.varName})`;
    return (
      <div
        className="my-2 px-3 py-2 rounded-md border-l-[3px]"
        style={{
          background: `color-mix(in oklch, ${tokenVar} 10%, transparent)`,
          borderLeftColor: `color-mix(in oklch, ${tokenVar} 55%, transparent)`,
        }}
      >
        <div className="text-xs font-bold mb-0.5" style={{ color: tokenVar }}>
          {displayTitle}
        </div>
        <div className="text-xs opacity-80">{props.children}</div>
      </div>
    );
  },
};

const MiniMarkdownPreviewBase = ({ content, maxLength = 2000 }: MiniPreviewProps) => {
  if (!content) return null;

  // 截断内容用于预览
  const truncatedContent = content.slice(0, maxLength);

  return (
    <div className="mini-preview text-sm leading-relaxed text-[var(--text-secondary)] w-full" style={{ maxWidth: '100%', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {truncatedContent}
      </ReactMarkdown>
    </div>
  );
};

export const MiniMarkdownPreview = React.memo(MiniMarkdownPreviewBase);
export default MiniMarkdownPreview;
