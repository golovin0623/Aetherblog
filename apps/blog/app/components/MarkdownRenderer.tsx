'use client';

import Image from 'next/image';
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Components } from 'react-markdown';
import type { PluggableList } from 'unified';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import type { BundledLanguage } from 'shiki';
import { useTheme } from '@aetherblog/hooks';
import { logger } from '../lib/logger';
import { buildHeadingIdMap } from '../lib/headingId';
import remarkDirective from 'remark-directive';
import remarkAlertBlock from '../lib/remarkAlertBlock';
import { AlertBlock } from './AlertBlock';

// DOMPurify 配置 — 用于消毒 mermaid SVG 和 shiki HTML 输出
const SVG_SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
} as const;
const SHIKI_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['class', 'style'],
} as const;

// SSR-safe DOMPurify：仅在浏览器环境中加载，Node.js 端为 null
const DOMPurifyModule = typeof window !== 'undefined'
  ? (await import('dompurify')).default
  : null;

/**
 * SSR-safe DOMPurify 消毒封装：浏览器环境执行消毒，
 * 服务端直接返回空字符串（SSR 时组件状态为初始值，不会到达此路径）。
 */
function sanitizeHtml(dirty: string, config: Record<string, unknown>): string {
  if (!DOMPurifyModule) return '';
  return DOMPurifyModule.sanitize(dirty, config);
}

// ============================================================================
// rehype-sanitize 白名单 — 允许博客常用 HTML 属性，阻止 XSS
// ============================================================================
// SECURITY (VULN-116): rehype-sanitize already blocks iframe/object/embed/form
// in the default schema, but we re-assert the allowlist approach (don't
// spread raw tag lists from user input). Keep tagNames explicit.
//
// SECURITY (VULN-170): rehype-sanitize's default allows `data:` URIs on img
// src. SVG in a data: URL executes inline <script>, so we narrow the protocols
// list to drop `data:` from `img@src` specifically. This also defends against
// the old VULN-021 class of payloads that disguise scripts as images.
const sanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    // 扩展多媒体与语意化标签
    'center', 'figure', 'figcaption', 'mark', 'u', 'abbr', 'details', 'summary',
    'video', 'audio', 'source', 'track', 'picture', 'kbd', 'sup', 'sub', 'del'
  ],
  attributes: {
    ...defaultSchema.attributes,
    // 全局放行核心排版属性（移除 style 以防止 CSS 注入）
    '*': [
      ...(defaultSchema.attributes?.['*'] || []),
      'className', 'id', 'align', 'valign', 'width', 'height'
    ],
    // 专用属性支持
    video: ['src', 'controls', 'autoplay', 'loop', 'muted', 'poster', 'preload'],
    audio: ['src', 'controls', 'autoplay', 'loop', 'muted', 'preload'],
    source: ['src', 'type', 'srcSet', 'media'],
    a: [
      ...(defaultSchema.attributes?.a || []),
      'target', 'rel', 'download'
    ],
    // alert-block 自定义元素
    'alert-block': ['data-type', 'data-title'],
  },
  // VULN-170: `data:` removed from img protocols; only http(s) & blob allowed.
  protocols: {
    ...(defaultSchema.protocols || {}),
    src: ['http', 'https', 'blob'],
  },
};

const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath, remarkDirective, remarkAlertBlock];
const REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: 'ignore' }],
];


// KaTeX CSS - 懒加载（仅在有数学公式时加载）
let katexCssLoaded = false;
function loadKatexCss() {
  if (katexCssLoaded || typeof document === 'undefined') return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.27/dist/katex.min.css';
  link.crossOrigin = 'anonymous';
  // TODO: Add link.integrity = 'sha384-...' for Subresource Integrity (SRI)
  document.head.appendChild(link);
  katexCssLoaded = true;
  logger.info('[KaTeX] CSS 懒加载完成');
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
const ALERT_DIRECTIVE_NAMES = ['info', 'note', 'warning', 'danger', 'tip'] as const;
const GENERIC_IMAGE_ALT_PATTERN = /^(image|img|screenshot|snipaste|picture|photo)[-_ ]?\d*\\.(png|jpe?g|gif|webp|svg)$/i;
const FILE_NAME_ALT_PATTERN = /^[^\\/\n]+\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

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
  'ps1': 'bash',
  'pwsh': 'bash',
  'powershell': 'bash',
  'docker': 'dockerfile',
};

// 全局高亮实例 (单例) — 使用 shiki/core 避免打包全部 150+ 语言
let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighterInstance: HighlighterCore | null = null;
// 已加载的语言集合
const loadedLanguages = new Set<string>(CORE_LANGUAGES);

async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterInstance) return highlighterInstance;

  if (!highlighterPromise) {
    // 使用 shiki/core + 动态导入核心语言，显著减少构建时 bundle 体积
    highlighterPromise = createHighlighterCore({
      themes: [
        import('shiki/themes/github-dark.mjs'),
        import('shiki/themes/github-light.mjs'),
      ],
      langs: [
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/typescript.mjs'),
        import('shiki/langs/jsx.mjs'),
        import('shiki/langs/tsx.mjs'),
        import('shiki/langs/json.mjs'),
        import('shiki/langs/html.mjs'),
        import('shiki/langs/css.mjs'),
        import('shiki/langs/bash.mjs'),
      ],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    });
  }

  highlighterInstance = await highlighterPromise;
  return highlighterInstance;
}

/**
 * 动态加载语言 - 遇到未加载的语言时按需加载
 * 使用 Shiki 的 bundledLanguages 实现真正的懒加载
 */
async function ensureLanguageLoaded(highlighter: HighlighterCore, lang: BundledLanguage): Promise<boolean> {
  // 已加载
  if (loadedLanguages.has(lang)) return true;

  // 不在支持列表中
  if (!ALL_SUPPORTED_LANGUAGES.includes(lang)) return false;

  try {
    // 通过 bundledLanguagesInfo 按需加载（每个语言通过 @shikijs/langs 独立 chunk）
    const { bundledLanguagesInfo } = await import('shiki/langs');
    const langInfo = bundledLanguagesInfo.find((l: { id: string }) => l.id === lang);
    if (langInfo) {
      const langModule = await langInfo.import();
      await highlighter.loadLanguage(langModule.default ?? langModule);
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

function preprocessMarkdown(content: string): string {
  if (!content) {
    return content;
  }

  const alertNamePattern = ALERT_DIRECTIVE_NAMES.join('|');

  return content.replace(
    new RegExp(`(^:::(?:${alertNamePattern})(?:\\{[^\\n]*\\})?[ \\t]*\\r?\\n)(:::[ \\t]*$)`, 'gm'),
    '$1\u200B\n$2',
  );
}

function paragraphContainsBlockImage(node: unknown): boolean {
  if (!node || typeof node !== 'object' || !('children' in node)) {
    return false;
  }

  const children = (node as { children?: unknown[] }).children;
  if (!Array.isArray(children)) {
    return false;
  }

  return children.some((child) => {
    if (!child || typeof child !== 'object') {
      return false;
    }

    const childNode = child as { type?: string; tagName?: string; children?: unknown[] };
    // mdast 图片节点
    if (childNode.type === 'image') {
      return true;
    }
    // rehype HTML <img> 元素（markdown 中的原始 HTML）
    if (childNode.type === 'element' && childNode.tagName === 'img') {
      return true;
    }

    if ((childNode.type === 'link' || childNode.type === 'emphasis' || childNode.type === 'strong' || childNode.type === 'element') && Array.isArray(childNode.children)) {
      return paragraphContainsBlockImage(childNode);
    }

    return false;
  });
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

function createHeadingRenderer(tag: HeadingTag, headingIdMap: Map<number, string>): Components[HeadingTag] {
  const HeadingRenderer: Components[HeadingTag] = ({ children, id, className, node, ...props }) => {
    const headingText = extractTextContent(children).trim();
    // 通过 AST 源代码行号查找预计算的 ID。
    // 完全无状态：无共享计数器，无闭包副作用。
    // node.position.start.line 从 1 开始，文档中每个标题唯一。
    const lineNumber = (node as any)?.position?.start?.line as number | undefined;
    const precomputedId = lineNumber !== undefined ? headingIdMap.get(lineNumber) : undefined;
    const headingId = (typeof id === 'string' && id) ? id : (precomputedId ?? 'section');
    const mergedClassName = ['group/heading scroll-mt-24', className].filter(Boolean).join(' ');

    return React.createElement(
      tag,
      {
        ...props,
        id: headingId,
        className: mergedClassName,
      },
      children,
    );
  };

  (HeadingRenderer as { displayName?: string }).displayName = `MarkdownHeading(${tag.toUpperCase()})`;
  return HeadingRenderer;
}

function parseMarkdownLink(href?: string): { href: string; isExternal: boolean } | null {
  if (!href) {
    return null;
  }

  const trimmed = href.trim();
  if (!trimmed) {
    return null;
  }

  const lowerHref = trimmed.toLowerCase();
  const blockedProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
  if (blockedProtocols.some((protocol) => lowerHref.startsWith(protocol))) {
    return null;
  }

  if (trimmed.startsWith('//')) {
    return { href: trimmed, isExternal: true };
  }

  if (
    trimmed.startsWith('#')
    || trimmed.startsWith('/')
    || trimmed.startsWith('./')
    || trimmed.startsWith('../')
    || trimmed.startsWith('?')
  ) {
    return { href: trimmed, isExternal: false };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { href: trimmed, isExternal: true };
    }
    if (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:') {
      return { href: trimmed, isExternal: false };
    }
    return null;
  } catch {
    return { href: trimmed, isExternal: false };
  }
}

function legacyCopyText(text: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);

  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}

async function copyCodeToClipboard(text: string): Promise<void> {
  if (
    typeof navigator !== 'undefined'
    && typeof window !== 'undefined'
    && window.isSecureContext
    && navigator.clipboard?.writeText
  ) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const copied = legacyCopyText(text);
  if (!copied) {
    throw new Error('Clipboard API unavailable and legacy copy failed');
  }
}

// mermaid 主题类型
type MermaidTheme = 'dark' | 'default';

// Mermaid 图表组件
const MermaidBlock: React.FC<{ code: string; theme: string; fallbackText: string }> = ({ code, theme, fallbackText }) => {
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
          // 仅针对暗色模式或特定需求调整变量
          themeVariables: theme === 'dark' ? {
            primaryColor: '#6366f1',
            primaryTextColor: '#f1f5f9',
            primaryBorderColor: '#818cf8',
            lineColor: '#64748b',
            secondaryColor: '#1e1b4b',
            tertiaryColor: '#1e293b',
          } : undefined,
          // 🛡️ Sentinel 安全改进：将 securityLevel 设为 strict，防范图表中的 XSS 攻击向量
          securityLevel: 'strict',
        });

        // mermaid.render 在语法无效时不会 throw,而是返回带"炸弹+Syntax error"的 SVG。
        // 先用 parse() 校验,失败走 catch 展示友好错误与原始代码,避免炸弹图标出现在文章里
        const parseResult = await mermaid.parse(code.trim(), { suppressErrors: true });
        if (parseResult === false) {
          setError(fallbackText);
          return;
        }

        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: renderedSvg } = await mermaid.render(id, code.trim());
        setSvg(renderedSvg);
        setError(null);
      } catch (e) {
        logger.error('Mermaid render error:', e, 'Code:', code);
        setError(fallbackText);
      } finally {
        setIsLoading(false);
      }
    };

    renderMermaid();
  }, [code, theme, fallbackText]); // 主题变更时重新渲染

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
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(svg, SVG_SANITIZE_CONFIG) }}
    />
  );
};

// Shiki 代码块组件 - 带语法高亮和折叠功能
const ShikiCodeBlock: React.FC<{ language: string; code: string; highlighter: HighlighterCore | null; theme: string }> = ({
  language,
  code,
  highlighter,
  theme
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const copyStateTimerRef = useRef<number | null>(null);
  const contentId = React.useId();

  // 计算代码行数
  const lineCount = code.split('\n').length;
  const shouldShowToggle = lineCount > 15; // 超过15行显示折叠按钮

  // 初始状态：超过15行自动折叠
  useEffect(() => {
    if (shouldShowToggle) {
      setIsCollapsed(true);
    }
  }, [shouldShowToggle]);

  useEffect(() => () => {
    if (copyStateTimerRef.current) {
      window.clearTimeout(copyStateTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!highlighter || !code) return;

    const highlight = async () => {
      try {
        const normalizedLang = normalizeLanguage(language);
        let shikiLang: BundledLanguage | 'text' = normalizedLang;

        // 动态加载语言（如果未加载）
        if (shikiLang !== 'text') {
          const loaded = await ensureLanguageLoaded(highlighter, shikiLang);
          if (!loaded) {
            shikiLang = 'text';
          }
        }

        const shikiTheme = theme === 'dark' ? 'github-dark' : 'github-light';

        // 使用 Shiki 的 transformers API 优雅地自定义输出
        const html = highlighter.codeToHtml(code, {
          lang: shikiLang === 'text' ? 'text' : shikiLang,
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

  const setTransientCopyState = useCallback((state: 'success' | 'error') => {
    setCopyState(state);
    if (copyStateTimerRef.current) {
      window.clearTimeout(copyStateTimerRef.current);
    }
    copyStateTimerRef.current = window.setTimeout(() => {
      setCopyState('idle');
    }, 1600);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await copyCodeToClipboard(code);
      setTransientCopyState('success');
    } catch (error) {
      logger.warn('Copy code block failed:', error);
      setTransientCopyState('error');
    }
  }, [code, setTransientCopyState]);

  const langDisplay = language?.toUpperCase() || 'TEXT';

  return (
    <div className={`code-block-wrapper relative group my-4 rounded-xl overflow-hidden border border-[var(--markdown-border-code)] bg-[var(--markdown-bg-code)] ${isCollapsed ? 'collapsed' : ''}`}>
      {/* 头部 */}
      <div className="code-block-header flex items-center justify-between px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--markdown-border-code)]">
        <span className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider">
          {langDisplay}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex min-h-8 min-w-[72px] items-center justify-center gap-1 rounded px-2 py-1 text-xs bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-live="polite"
          aria-label={copyState === 'success' ? '代码已复制' : copyState === 'error' ? '复制失败，请手动复制' : '复制代码'}
        >
          {copyState === 'success' ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              已复制
            </>
          ) : copyState === 'error' ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9l-6 6" />
                <path d="M9 9l6 6" />
              </svg>
              复制失败
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              复制
            </>
          )}
        </button>
      </div>

      {/* 代码内容 */}
      <div id={contentId} className="code-block-content overflow-x-auto" aria-hidden={isCollapsed}>
        {highlightedHtml ? (
          <div
            className="shiki-wrapper"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(highlightedHtml, SHIKI_SANITIZE_CONFIG) }}
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
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="code-block-toggle"
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="18 15 12 9 6 15" />
          </svg>
          {isCollapsed ? `展开全部 (${lineCount} 行)` : '收起代码'}
        </button>
      )}
    </div>
  );
};

// 创建自定义组件映射
function createComponents(
  highlighter: HighlighterCore | null,
  theme: string,
  headingIdMap: Map<number, string>,
): Components {
  // 六级标题共用同一查找 Map — 无可变计数器。
  const fallbackMathErrorText = '数学公式渲染失败';
  const fallbackMermaidErrorText = '图表渲染失败';
  const isBlockImageChild = (child: React.ReactNode) => {
    if (!React.isValidElement(child)) {
      return false;
    }

    const childType = typeof child.type === 'string' ? child.type : null;
    const childProps = child.props as { className?: string } | null;
    const childClassName =
      typeof childProps?.className === 'string' ? childProps.className : '';

    return childType === 'figure' || childType === 'img' || childClassName.includes('markdown-image');
  };

  return {
    h1: createHeadingRenderer('h1', headingIdMap),
    h2: createHeadingRenderer('h2', headingIdMap),
    h3: createHeadingRenderer('h3', headingIdMap),
    h4: createHeadingRenderer('h4', headingIdMap),
    h5: createHeadingRenderer('h5', headingIdMap),
    h6: createHeadingRenderer('h6', headingIdMap),
    
    // 自定义高亮块
    // @ts-expect-error - 自定义元素不在标准 HTML 类型中
    'alert-block': ({ node, ...props }: any) => {
      return (
        <AlertBlock type={props['data-type'] || 'info'} title={props['data-title']}>
          {props.children}
        </AlertBlock>
      );
    },

    p: ({ children, node, ...props }) => {
      const nodes = React.Children.toArray(children);
      const hasBlockImage = paragraphContainsBlockImage(node) || nodes.some(isBlockImageChild);

      if (hasBlockImage) {
        return (
          <div className="my-4" {...props}>
            {children}
          </div>
        );
      }

      return (
        <p className="my-4 leading-8 text-[var(--text-primary)]" {...props}>
          {children}
        </p>
      );
    },

    // 处理 pre 标签 - 捕获所有代码块
    // 只要 <pre> 有 React 元素子节点（<code> 或自定义 code 组件），
    // 就提取文本走 ShikiCodeBlock，避免四反引号无语言标识的代码块
    // 被当作默认 <pre> 渲染导致移动端 markdown 内容泄漏。
    pre: ({ children, ...props }) => {
      const child = React.Children.toArray(children)[0];

      if (React.isValidElement(child)) {
        const childProps = child.props as { className?: string; children?: React.ReactNode };
        const className = childProps.className || '';
        const match = /language-(\w+)/.exec(className);
        const language = match?.[1] || 'text';

        const codeContent = extractTextContent(childProps.children).replace(/\n$/, '');

        // Mermaid 图表
        if (language === 'mermaid') {
          return <MermaidBlock code={codeContent} theme={theme} fallbackText={fallbackMermaidErrorText} />;
        }

        return <ShikiCodeBlock language={language} code={codeContent} highlighter={highlighter} theme={theme} />;
      }

      // 默认 pre（仅当子节点不是 React 元素时）
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
    img: ({ src, alt, width: _width, height: _height, ...props }) => {
      if (typeof src !== 'string' || !src) {
        return null;
      }

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

      const caption = normalizeImageCaption(displayAlt);

      return (
        <figure
          className="markdown-image my-4"
          style={width ? { width, maxWidth: '100%' } : undefined}
        >
          <Image
            src={src}
            alt={caption || displayAlt || ''}
            loading="lazy"
            unoptimized
            width={1200}
            height={800}
            className="w-full max-w-full rounded-lg border border-[var(--border-subtle)] inline-block transition-all duration-300"
            style={{
              boxShadow: 'var(--shadow-md)',
              height: 'auto',
            }}
            {...props}
          />
          {caption && <figcaption className="mt-2 text-center text-sm text-[var(--text-muted)]">{caption}</figcaption>}
        </figure>
      );
    },

    // 表格
    table: ({ children }) => (
      <div className="markdown-table-wrapper overflow-x-auto my-4">
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
      (() => {
        const parsed = parseMarkdownLink(href);
        if (!parsed) {
          return (
            <span className="text-[var(--text-muted)] border-b border-dashed border-[var(--border-default)]" title="链接已被安全策略拦截">
              {children}
            </span>
          );
        }

        return (
          <a
            href={parsed.href}
            target={parsed.isExternal ? '_blank' : undefined}
            rel={parsed.isExternal ? 'noopener noreferrer' : undefined}
            className="text-primary hover:text-primary/80 no-underline border-b border-transparent hover:border-primary transition-colors"
            {...props}
          >
            {children}
          </a>
        );
      })()
    ),

    input: ({ type, checked, ...props }) => {
      if (type === 'checkbox') {
        const isChecked = Boolean(checked);
        return (
          <input
            {...props}
            type="checkbox"
            checked={isChecked}
            disabled
            readOnly
            aria-label={isChecked ? '任务已完成' : '任务未完成'}
          />
        );
      }

      return <input {...props} type={type} />;
    },

    span: ({ className, children, ...props }) => {
      if (typeof className === 'string' && className.includes('katex-error')) {
        const source = extractTextContent(children).trim();
        return (
          <span
            {...props}
            className="markdown-render-error"
            title={source ? `${fallbackMathErrorText}：${source}` : fallbackMathErrorText}
          >
            {fallbackMathErrorText}
          </span>
        );
      }

      return <span className={className} {...props}>{children}</span>;
    },

    // 水平线
    hr: () => <hr className="my-8 border-t border-white/10" />,
  };
}

const MarkdownRendererBase = ({ content, className = '' }: MarkdownRendererProps) => {
  // Seed from the module-level singleton so SPA navigation to a second article
  // after Shiki has already resolved doesn't flash a 1-frame visibility:hidden
  // before the ready effect runs.
  const [highlighter, setHighlighter] = useState<HighlighterCore | null>(highlighterInstance);
  // Shiki 加载结果：pending → 初始态；ready → 高亮器可用；failed → 降级为纯文本
  // 代码块。任何失败（如 CSP 拦截 WASM）都必须走 failed 分支解除 visibility:hidden，
  // 否则整篇正文永远保持不可见，用户看到空白页。
  const [shikiStatus, setShikiStatus] = useState<'pending' | 'ready' | 'failed'>(
    highlighterInstance ? 'ready' : 'pending',
  );

  // 加载 Shiki highlighter
  useEffect(() => {
    // Singleton already resolved — skip re-subscribing; initial state is correct.
    if (highlighterInstance) return;

    let cancelled = false;
    getHighlighter()
      .then((h) => {
        if (cancelled) return;
        setHighlighter(h);
        setShikiStatus('ready');
      })
      .catch((err) => {
        logger.error('[Shiki] highlighter init failed, falling back to plain code blocks:', err);
        if (cancelled) return;
        setShikiStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 检测数学公式，按需加载 KaTeX CSS
  useEffect(() => {
    if (content && /\$\$?[^$]+\$\$?/.test(content)) {
      loadKatexCss();
    }
  }, [content]);

  const { resolvedTheme } = useTheme();
  const normalizedContent = useMemo(() => preprocessMarkdown(content || ''), [content]);

  // 每次内容变更时预计算标题 ID Map。
  // Map 键为 AST 源代码行号（从 1 开始），值为稳定去重后的 ID。
  // 渲染器中完全无状态 — 无共享计数器，无闭包副作用。
  const headingIdMap = useMemo(() => buildHeadingIdMap(normalizedContent), [normalizedContent]);

  // 高亮器或主题变更时重新创建组件。
  // 标题 ID 为纯 Map 查询 — 任意次重渲染均幂等。
  const components = useMemo(
    () => createComponents(highlighter, resolvedTheme || 'dark', headingIdMap),
    [highlighter, resolvedTheme, headingIdMap],
  );

  if (!normalizedContent) return null;

  // Markdown FOUC 防护: Shiki 就绪前用 visibility 隐藏内容
  // 不使用 opacity 过渡 → 避免与外层 FadeIn 的 fadeInUp 动画产生双重淡入冲突
  // 注意：pending 才隐藏；ready 和 failed 都立刻显示——失败时代码块降级为
  // 无高亮的 <pre>，但正文必须对用户可见。
  const isReady = shikiStatus !== 'pending';

  return (
    <div
      className={`markdown-body prose dark:prose-invert max-w-none ${className}`}
      style={{
        visibility: isReady ? 'visible' : 'hidden',
      }}
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
};

export const MarkdownRenderer = React.memo(MarkdownRendererBase);
export default MarkdownRenderer;
