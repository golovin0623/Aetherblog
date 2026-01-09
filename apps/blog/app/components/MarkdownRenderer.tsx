'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import type { Components } from 'react-markdown';
import { createHighlighter, type Highlighter, type BundledLanguage } from 'shiki';

// KaTeX CSS - 懒加载（仅在有数学公式时加载）
let katexCssLoaded = false;
function loadKatexCss() {
  if (katexCssLoaded || typeof document === 'undefined') return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
  document.head.appendChild(link);
  katexCssLoaded = true;
  console.log('[KaTeX] CSS 懒加载完成');
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// ============================================================================
// 语言配置 - 按需加载优化
// ============================================================================

// 核心语言 - 初始加载 (最常用的 8 种，约 50kB)
const CORE_LANGUAGES: BundledLanguage[] = [
  'javascript', 'typescript', 'jsx', 'tsx',
  'json', 'html', 'css', 'bash'
];

// 扩展语言 - 按需动态加载
const EXTENDED_LANGUAGES: BundledLanguage[] = [
  'python', 'java', 'go', 'rust', 'c', 'cpp',
  'scss', 'yaml', 'xml', 'sql', 'shell', 'powershell',
  'markdown', 'dockerfile', 'nginx',
  'php', 'ruby', 'swift', 'kotlin',
  'vue', 'svelte', 'astro'
];

// 所有支持的语言 (用于判断是否可加载)
const ALL_SUPPORTED_LANGUAGES = [...CORE_LANGUAGES, ...EXTENDED_LANGUAGES];

// Language alias mapping
const LANGUAGE_ALIASES: Record<string, BundledLanguage> = {
  'js': 'javascript',
  'ts': 'typescript',
  'py': 'python',
  'rb': 'ruby',
  'yml': 'yaml',
  'sh': 'bash',
  'zsh': 'bash',
  'docker': 'dockerfile',
};

// Global highlighter instance (singleton)
let highlighterPromise: Promise<Highlighter> | null = null;
let highlighterInstance: Highlighter | null = null;
// 已加载的语言集合
const loadedLanguages = new Set<string>(CORE_LANGUAGES);

async function getHighlighter(): Promise<Highlighter> {
  if (highlighterInstance) return highlighterInstance;
  
  if (!highlighterPromise) {
    // 仅初始加载核心语言，减少 bundle 体积
    highlighterPromise = createHighlighter({
      themes: ['github-dark'],  // 只加载一个主题
      langs: CORE_LANGUAGES,
    });
  }
  
  highlighterInstance = await highlighterPromise;
  return highlighterInstance;
}

/**
 * 动态加载语言 - 遇到未加载的语言时按需加载
 * 使用 Shiki 的 bundledLanguages 实现真正的懒加载
 */
async function ensureLanguageLoaded(highlighter: Highlighter, lang: BundledLanguage): Promise<boolean> {
  // 已加载
  if (loadedLanguages.has(lang)) return true;
  
  // 不在支持列表中
  if (!ALL_SUPPORTED_LANGUAGES.includes(lang)) return false;
  
  try {
    // 使用动态 import 加载语言定义（真正的代码分割）
    const { bundledLanguages } = await import('shiki/bundle/web');
    const langModule = bundledLanguages[lang as keyof typeof bundledLanguages];
    
    if (langModule) {
      await highlighter.loadLanguage(langModule);
      loadedLanguages.add(lang);
      console.log(`[Shiki] 动态加载语言: ${lang}`);
      return true;
    }
    return false;
  } catch (e) {
    console.warn(`[Shiki] 无法加载语言 ${lang}:`, e);
    return false;
  }
}

// Normalize language name
function normalizeLanguage(lang: string): BundledLanguage | 'text' {
  const normalized = lang.toLowerCase().trim();
  if (LANGUAGE_ALIASES[normalized]) {
    return LANGUAGE_ALIASES[normalized];
  }
  if (ALL_SUPPORTED_LANGUAGES.includes(normalized as BundledLanguage)) {
    return normalized as BundledLanguage;
  }
  return 'text';
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

// Shiki 代码块组件 - 带语法高亮
const ShikiCodeBlock: React.FC<{ language: string; code: string; highlighter: Highlighter | null }> = ({ 
  language, 
  code,
  highlighter
}) => {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!highlighter || !code) return;
    
    const highlight = async () => {
      try {
        const lang = normalizeLanguage(language);
        
        // 动态加载语言（如果未加载）
        if (lang !== 'text') {
          await ensureLanguageLoaded(highlighter, lang);
        }
        
        const html = highlighter.codeToHtml(code, {
          lang: lang === 'text' ? 'text' : lang,
          theme: 'github-dark',
        });
        setHighlightedHtml(html);
      } catch (e) {
        console.error('Shiki highlight error:', e);
        setHighlightedHtml(null);
      }
    };
    
    highlight();
  }, [highlighter, code, language]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const langDisplay = language?.toUpperCase() || 'TEXT';

  return (
    <div className="code-block-wrapper relative group my-4 rounded-xl overflow-hidden border border-white/10 bg-[#1a1b26]">
      {/* Header */}
      <div className="code-block-header flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10">
        <span className="text-xs font-mono text-gray-400 uppercase tracking-wider">
          {langDisplay}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-transparent hover:bg-white/10 rounded text-gray-400 hover:text-gray-200 transition-all"
        >
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              已复制
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              复制
            </>
          )}
        </button>
      </div>
      
      {/* Code content */}
      <div className="code-block-content overflow-x-auto">
        {highlightedHtml ? (
          <div 
            className="shiki-wrapper"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <pre className="p-4 m-0 bg-transparent">
            <code className={`language-${language}`}>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
};

// 创建自定义组件映射
function createComponents(highlighter: Highlighter | null): Components {
  return {
    // 处理 pre 标签 - 捕获所有代码块
    pre: ({ children, ...props }) => {
      const child = React.Children.toArray(children)[0];
      
      if (React.isValidElement(child) && (child.type === 'code' || (child.props as { className?: string })?.className)) {
        const childProps = child.props as { className?: string; children?: React.ReactNode };
        const className = childProps.className || '';
        const match = /language-(\w+)/.exec(className);
        const language = match?.[1] || '';
        
        const codeContent = extractTextContent(childProps.children).replace(/\n$/, '');
        
        // Mermaid 图表
        if (language === 'mermaid') {
          return <MermaidBlock code={codeContent} />;
        }
        
        // 使用 Shiki 高亮的代码块
        if (language) {
          return <ShikiCodeBlock language={language} code={codeContent} highlighter={highlighter} />;
        }
      }
      
      // 默认 pre
      return <pre className="overflow-x-auto p-4 bg-slate-900/80 border border-white/5 rounded-lg my-4" {...props}>{children}</pre>;
    },
    
    // 行内代码
    code: ({ className, children, ...props }) => {
      if (className) {
        return <code className={className} {...props}>{children}</code>;
      }
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
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);

  // 加载 Shiki highlighter
  useEffect(() => {
    getHighlighter().then(setHighlighter).catch(console.error);
  }, []);

  // 检测数学公式，按需加载 KaTeX CSS
  useEffect(() => {
    // 检测是否包含数学公式 ($...$ 或 $$...$$)
    if (content && /\$\$?[^$]+\$\$?/.test(content)) {
      loadKatexCss();
    }
  }, [content]);

  // 基于 highlighter 状态创建组件
  const components = useMemo(() => createComponents(highlighter), [highlighter]);

  if (!content) return null;

  return (
    <>
      {/* Shiki 代码块样式 */}
      <style jsx global>{`
        /* Shiki code styling */
        .shiki-wrapper .shiki {
          background: transparent !important;
          padding: 1em;
          margin: 0;
        }
        .shiki-wrapper .shiki code {
          background: transparent !important;
          padding: 0;
          font-size: 0.875em;
          line-height: 1.7;
          tab-size: 2;
        }
        .shiki-wrapper .shiki .line {
          display: block;
        }
      `}</style>
      <div className={`markdown-body prose prose-invert max-w-none ${className}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypeRaw]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </>
  );
}

export default MarkdownRenderer;
