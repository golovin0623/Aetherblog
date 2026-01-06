'use client';

import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import type { Components } from 'react-markdown';

// Import KaTeX CSS
import 'katex/dist/katex.min.css';

interface MarkdownRendererProps {
  content: string;
  className?: string;
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

// Mermaid 图表组件
const MermaidBlock: React.FC<{ code: string }> = ({ code }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!code || !code.trim()) {
      // 空内容不是错误，返回占位符
      setIsLoading(false);
      return;
    }

    const renderMermaid = async () => {
      try {
        setIsLoading(true);
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            primaryColor: '#6366f1',
            primaryTextColor: '#f1f5f9',
            primaryBorderColor: '#818cf8',
            lineColor: '#64748b',
            secondaryColor: '#1e1b4b',
            tertiaryColor: '#1e293b',
          },
        });
        
        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: renderedSvg } = await mermaid.render(id, code.trim());
        setSvg(renderedSvg);
        setError(null);
      } catch (e) {
        console.error('Mermaid render error:', e, 'Code:', code);
        setError('图表渲染失败');
      } finally {
        setIsLoading(false);
      }
    };
    
    renderMermaid();
  }, [code]);

  // 空内容时显示友好占位符
  if (!code || !code.trim()) {
    return (
      <div className="my-4 p-4 bg-slate-800/30 border border-white/5 rounded-lg text-center text-gray-600">
        📊 空流程图
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="my-4 flex justify-center bg-slate-900/50 rounded-lg p-8">
        <div className="text-gray-500 animate-pulse">加载流程图...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
        <div>{error}</div>
        <pre className="mt-2 text-xs text-gray-500 overflow-x-auto whitespace-pre-wrap">{code}</pre>
      </div>
    );
  }

  return (
    <div 
      className="my-4 flex justify-center bg-slate-900/50 rounded-lg p-4 overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

// 代码块包装组件
const CodeBlockWrapper: React.FC<{ language: string; code: string }> = ({ 
  language, 
  code
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-4">
      {language && (
        <div className="absolute top-0 left-4 px-2 py-0.5 text-[10px] font-mono text-gray-400 bg-slate-800 rounded-b z-10">
          {language}
        </div>
      )}
      
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 px-2 py-1 text-xs bg-white/5 hover:bg-white/10 rounded text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        {copied ? '已复制!' : '复制'}
      </button>
      
      <pre className="overflow-x-auto p-4 pt-8 bg-slate-900/80 border border-white/5 rounded-lg">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
};

// 自定义组件映射
const components: Components = {
  // 处理 pre 标签 - 在这里捕获所有代码块
  pre: ({ children, ...props }) => {
    // 获取第一个子元素（应该是 code）
    const child = React.Children.toArray(children)[0];
    
    if (React.isValidElement(child) && (child.type === 'code' || (child.props as any)?.className)) {
      const childProps = child.props as { className?: string; children?: React.ReactNode };
      const className = childProps.className || '';
      const match = /language-(\w+)/.exec(className);
      const language = match?.[1] || '';
      
      // 使用递归提取函数获取代码内容
      const codeContent = extractTextContent(childProps.children).replace(/\n$/, '');
      
      // Mermaid 图表
      if (language === 'mermaid') {
        return <MermaidBlock code={codeContent} />;
      }
      
      // 有语言标记的代码块
      if (language) {
        return <CodeBlockWrapper language={language} code={codeContent} />;
      }
    }
    
    // 默认 pre
    return <pre className="overflow-x-auto p-4 bg-slate-900/80 border border-white/5 rounded-lg my-4" {...props}>{children}</pre>;
  },
  
  // 行内代码
  code: ({ className, children, ...props }) => {
    // 如果有 className 说明是代码块内的 code，由 pre 处理
    if (className) {
      return <code className={className} {...props}>{children}</code>;
    }
    // 行内代码
    return (
      <code className="bg-primary/15 text-primary px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
        {children}
      </code>
    );
  },
  
  // 图片
  img: ({ src, alt, ...props }) => (
    <span className="block my-4">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="max-w-full rounded-lg border border-white/10 shadow-lg"
        {...props}
      />
      {alt && <span className="block text-center text-sm text-gray-500 mt-2">{alt}</span>}
    </span>
  ),
  
  // 表格
  table: ({ children }) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full border-collapse border border-white/10 rounded-lg overflow-hidden">
        {children}
      </table>
    </div>
  ),
  
  th: ({ children }) => (
    <th className="bg-white/5 px-4 py-2 text-left font-semibold text-gray-200 border border-white/10">
      {children}
    </th>
  ),
  
  td: ({ children }) => (
    <td className="px-4 py-2 text-gray-300 border border-white/10">
      {children}
    </td>
  ),
  
  // 引用
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-primary pl-4 my-4 text-gray-400 italic bg-primary/5 py-2 pr-4 rounded-r">
      {children}
    </blockquote>
  ),
  
  // 链接
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
      className="text-primary hover:text-primary/80 underline underline-offset-2"
      {...props}
    >
      {children}
    </a>
  ),
  
  // 水平线
  hr: () => <hr className="my-8 border-t border-white/10" />,
};

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  if (!content) return null;

  return (
    <div className={`markdown-body prose prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeRaw]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
