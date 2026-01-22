'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import type { Components } from 'react-markdown';
import { createHighlighter, type Highlighter, type BundledLanguage } from 'shiki';
import { useTheme } from '@aetherblog/hooks';
import { logger } from '../lib/logger';

// KaTeX CSS - 懒加载（仅在有数学公式时加载）
let katexCssLoaded = false;
function loadKatexCss() {
  if (katexCssLoaded || typeof document === 'undefined') return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
  document.head.appendChild(link);
  katexCssLoaded = true;
  logger.info('[KaTeX] CSS 懒加载完成');
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

// 语言别名映射
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

// 全局高亮实例 (单例)
let highlighterPromise: Promise<Highlighter> | null = null;
let highlighterInstance: Highlighter | null = null;
// 已加载的语言集合
const loadedLanguages = new Set<string>(CORE_LANGUAGES);

async function getHighlighter(): Promise<Highlighter> {
  if (highlighterInstance) return highlighterInstance;
  
  if (!highlighterPromise) {
    // 仅初始加载核心语言，减少 bundle 体积
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-light'],
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
      logger.info(`[Shiki] 动态加载语言: ${lang}`);
      return true;
    }
    return false;
  } catch (e) {
    logger.warn(`[Shiki] 无法加载语言 ${lang}:`, e);
    return false;
  }
}

// 标准化语言名称
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

// mermaid 主题类型
type MermaidTheme = 'dark' | 'default';

// Mermaid 图表组件
const MermaidBlock: React.FC<{ code: string; theme: string }> = ({ code, theme }) => {
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
        // 清理之前的 svg 以强制视觉重绘 (可选)
        setSvg(''); 
        
        const mermaid = (await import('mermaid')).default;
        const mermaidTheme = theme === 'dark' ? 'dark' : 'default';
        
        mermaid.initialize({
          startOnLoad: false,
          theme: mermaidTheme as any,
          // Adjust variables only for dark mode or specific needs
          themeVariables: theme === 'dark' ? {
            primaryColor: '#6366f1',
            primaryTextColor: '#f1f5f9',
            primaryBorderColor: '#818cf8',
            lineColor: '#64748b',
            secondaryColor: '#1e1b4b',
            tertiaryColor: '#1e293b',
          } : undefined,
          securityLevel: 'loose',
        });
        
        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: renderedSvg } = await mermaid.render(id, code.trim());
        setSvg(renderedSvg);
        setError(null);
      } catch (e) {
        logger.error('Mermaid render error:', e, 'Code:', code);
        setError('图表渲染失败');
      } finally {
        setIsLoading(false);
      }
    };
    
    renderMermaid();
  }, [code, theme]); // 主题变更时重新渲染

  if (!code || !code.trim()) {
    return (
      <div className="my-4 p-4 bg-[var(--markdown-bg-code)] border border-[var(--markdown-border-code)] rounded-lg text-center text-[var(--text-muted)]">
        📊 空流程图
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="my-4 flex justify-center bg-[var(--markdown-bg-code)] rounded-lg p-8">
        <div className="text-[var(--text-muted)] animate-pulse">加载流程图...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
        <div>{error}</div>
        <pre className="mt-2 text-xs text-[var(--text-muted)] overflow-x-auto whitespace-pre-wrap">{code}</pre>
      </div>
    );
  }

  return (
    <div
      className="my-4 flex justify-center bg-[var(--markdown-bg-code)] rounded-lg p-4 overflow-x-auto border border-[var(--markdown-border-code)]"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

// Shiki 代码块组件 - 带语法高亮和折叠功能
const ShikiCodeBlock: React.FC<{ language: string; code: string; highlighter: Highlighter | null; theme: string }> = ({
  language,
  code,
  highlighter,
  theme
}) => {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // 计算代码行数
  const lineCount = code.split('\n').length;
  const shouldShowToggle = lineCount > 15; // 超过15行显示折叠按钮

  // 初始状态：超过15行自动折叠
  useEffect(() => {
    if (shouldShowToggle) {
      setIsCollapsed(true);
    }
  }, [shouldShowToggle]);

  useEffect(() => {
    if (!highlighter || !code) return;

    const highlight = async () => {
      try {
        const lang = normalizeLanguage(language);

        // 动态加载语言（如果未加载）
        if (lang !== 'text') {
          await ensureLanguageLoaded(highlighter, lang);
        }

        const shikiTheme = theme === 'dark' ? 'github-dark' : 'github-light';

        // 使用 Shiki 的 transformers API 优雅地自定义输出
        const html = highlighter.codeToHtml(code, {
          lang: lang === 'text' ? 'text' : lang,
          theme: shikiTheme,
          transformers: [
            {
              name: 'compact-line-spacing',
              // postprocess 在 HTML 生成后处理
              postprocess(html) {
                // 移除所有 line-height 和 height 相关的内联样式
                return html
                  .replace(/\s*line-height:\s*[^;]+;?/gi, '')
                  .replace(/\s*height:\s*[^;]+;?/gi, '')
                  // 移除 pre 和 code 标签上的 style 属性（如果只剩下空白）
                  .replace(/\s*style=""\s*/g, ' ')
                  .replace(/\s*style="\s*"\s*/g, ' ');
              },
            },
          ],
        });

        setHighlightedHtml(html);
      } catch (e) {
        logger.error('Shiki highlight error:', e);
        setHighlightedHtml(null);
      }
    };

    highlight();
  }, [highlighter, code, language, theme]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const langDisplay = language?.toUpperCase() || 'TEXT';

  return (
    <div className={`code-block-wrapper relative group my-4 rounded-xl overflow-hidden border border-[var(--markdown-border-code)] bg-[var(--markdown-bg-code)] ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Header */}
      <div className="code-block-header flex items-center justify-between px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--markdown-border-code)]">
        <span className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider">
          {langDisplay}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-transparent hover:bg-[var(--bg-card-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
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
          <div className="shiki-wrapper">
            <pre className="shiki" style={{ background: 'transparent', padding: '1em', margin: 0 }}>
              <code style={{ background: 'transparent', padding: 0, fontSize: '0.875em', lineHeight: 0.9, display: 'block' }}>
                {code}
              </code>
            </pre>
          </div>
        )}
      </div>

      {/* 折叠/展开按钮 */}
      {shouldShowToggle && (
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="code-block-toggle"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
          {isCollapsed ? `展开全部 (${lineCount} 行)` : '收起代码'}
        </button>
      )}
    </div>
  );
};

// 创建自定义组件映射
function createComponents(highlighter: Highlighter | null, theme: string): Components {
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
          return <MermaidBlock code={codeContent} theme={theme} />;
        }
        
        // 使用 Shiki 高亮的代码块
        if (language) {
          return <ShikiCodeBlock language={language} code={codeContent} highlighter={highlighter} theme={theme} />;
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
        <code className="bg-[var(--markdown-bg-code-inline)] text-[var(--markdown-text-code)] px-[0.25em] py-[0.5em] rounded text-sm font-mono" {...props}>
          {children}
        </code>
      );
    },
    
    // 图片
    img: ({ src, alt, ...props }) => {
      // 解析 alt 文本中的大小设置 ![alt|size](url)
      // 支持多种 CSS 单位: px, %, vw, vh, em, rem
      let width: string | undefined = undefined;
      let displayAlt = alt;

      if (alt && alt.includes('|')) {
        const parts = alt.split('|');
        // 取最后一部分作为大小，其余部分合并作为 alt
        const sizePart = parts.pop();

        // 支持: 纯数字(默认px)、数字+单位(px/%/vw/vh/em/rem)
        if (sizePart && /^\d+(px|%|vw|vh|em|rem)?$/i.test(sizePart)) {
          // 纯数字默认添加 px
          width = /^\d+$/.test(sizePart) ? `${sizePart}px` : sizePart;
          displayAlt = parts.join('|');
        } else {
          // 如果最后一部分不是有效的大小格式，则不进行分割
          displayAlt = alt;
        }
      }

      return (
        <span className="block my-4 text-center">
          <img
            src={src}
            alt={displayAlt}
            loading="lazy"
            className="max-w-full rounded-lg border border-[var(--border-subtle)] inline-block transition-all duration-300"
            style={{
              width: width,
              boxShadow: 'var(--shadow-md)'
            }}
            {...props}
          />
          {displayAlt && <span className="block text-center text-sm text-[var(--text-muted)] mt-2">{displayAlt}</span>}
        </span>
      );
    },
    
    // 表格
    table: ({ children }) => (
      <div className="overflow-x-auto my-4">
        <table className="w-full border-collapse border border-[var(--border-subtle)] rounded-lg overflow-hidden">
          {children}
        </table>
      </div>
    ),
    
    th: ({ children }) => (
      <th className="bg-[var(--bg-secondary)] px-4 py-2 text-left font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)]">
        {children}
      </th>
    ),
    
    td: ({ children }) => (
      <td className="px-4 py-2 text-[var(--text-secondary)] border border-[var(--border-subtle)]">
        {children}
      </td>
    ),
    
    // 引用
    blockquote: ({ children }) => (
      <blockquote className="border-l-[3px] border-[var(--markdown-border-quote)] pl-4 my-4 text-[var(--text-secondary)] bg-[var(--markdown-bg-quote)] py-2 pr-4 rounded-r">
        {children}
      </blockquote>
    ),
    
    // 链接
    a: ({ href, children, ...props }) => (
      <a
        href={href}
        target={href?.startsWith('http') ? '_blank' : undefined}
        rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
        className="text-primary hover:text-primary/80 no-underline border-b border-transparent hover:border-primary transition-colors"
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
    getHighlighter().then(setHighlighter).catch(logger.error);
  }, []);

  // 检测数学公式，按需加载 KaTeX CSS
  useEffect(() => {
    // 检测是否包含数学公式 ($...$ 或 $$...$$)
    if (content && /\$\$?[^$]+\$\$?/.test(content)) {
      loadKatexCss();
    }
  }, [content]);

  const { resolvedTheme } = useTheme();

  // 基于 highlighter 状态和主题创建组件
  const components = useMemo(() => createComponents(highlighter, resolvedTheme || 'dark'), [highlighter, resolvedTheme]);

  if (!content) return null;

  return (
    <div className={`markdown-body prose dark:prose-invert max-w-none ${className}`}>
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
