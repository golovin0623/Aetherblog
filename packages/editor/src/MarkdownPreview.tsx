import { useMemo, useState, useEffect, useRef } from 'react';
import { marked, Renderer, type TokenizerExtension, type RendererExtension, type Tokens } from 'marked';
import { createHighlighter, type Highlighter, type BundledLanguage } from 'shiki';
import katex from 'katex';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';

// 导入 KaTeX CSS
import 'katex/dist/katex.min.css';

/**
 * 自定义围栏代码块扩展 - 正确处理嵌套代码块
 * 
 * 标准 CommonMark 规范：外层围栏的反引号数量必须多于内层任何反引号序列
 * 例如：`````markdown 可以包含 ``` 块，因为 5 > 3
 */
const nestedFencesExtension: TokenizerExtension & RendererExtension = {
  name: 'fences',
  level: 'block',

  // 检测代码围栏的起始位置
  start(src: string) {
    const match = src.match(/^(`{3,}|~{3,})/m);
    return match ? match.index : -1;
  },

  // 解析围栏代码块
  tokenizer(src: string): Tokens.Code | undefined {
    // 匹配开头的围栏：至少3个反引号或波浪线，可选的语言标识
    const openMatch = src.match(/^(`{3,}|~{3,})([^\n`]*)\n/);
    if (!openMatch) return undefined;

    const fence = openMatch[1];
    const fenceChar = fence[0];
    const fenceLength = fence.length;
    const lang = openMatch[2].trim();

    // 查找匹配的闭合围栏（相同字符，相同或更多长度）
    const closePattern = new RegExp(`^${fenceChar}{${fenceLength},}\\s*$`, 'm');
    const remaining = src.slice(openMatch[0].length);

    let codeContent = '';
    let consumed = openMatch[0].length;

    const lines = remaining.split('\n');
    let foundClose = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 检查是否是闭合围栏
      if (closePattern.test(line)) {
        foundClose = true;
        consumed += lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0) + line.length + 1;
        break;
      }

      // 添加到代码内容
      if (i > 0) codeContent += '\n';
      codeContent += line;
    }

    // 如果没找到闭合，消费到文档末尾
    if (!foundClose) {
      codeContent = remaining;
      consumed = src.length;
    }

    return {
      type: 'code',
      raw: src.slice(0, consumed),
      text: codeContent,
      lang: lang || undefined
    };
  },

  // 渲染器（返回 false 使用默认渲染）
  renderer(): string | false {
    return false;
  }
};

// 配置 marked 使用自定义扩展
marked.use({ extensions: [nestedFencesExtension] });


export interface MarkdownPreviewProps {
  content: string;
  className?: string;
  style?: React.CSSProperties;
  theme?: 'light' | 'dark';
}

// 支持语法高亮的语言
const SUPPORTED_LANGUAGES: BundledLanguage[] = [
  'javascript', 'typescript', 'jsx', 'tsx',
  'python', 'java', 'go', 'rust', 'c', 'cpp',
  'html', 'css', 'scss', 'json', 'yaml', 'xml',
  'sql', 'bash', 'shell', 'powershell',
  'markdown', 'dockerfile', 'nginx',
  'php', 'ruby', 'swift', 'kotlin',
  'vue', 'svelte', 'astro'
];

// 语言别名映射
const LANGUAGE_ALIASES: Record<string, BundledLanguage> = {
  'js': 'javascript',
  'ts': 'typescript',
  'py': 'python',
  'rb': 'ruby',
  'yml': 'yaml',
  'sh': 'bash',
  'zsh': 'bash',
  'dockerfile': 'dockerfile',
  'docker': 'dockerfile',
};

// 全局高亮实例（单例）
let highlighterPromise: Promise<Highlighter> | null = null;
let highlighterInstance: Highlighter | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (highlighterInstance) return highlighterInstance;

  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-dark-dimmed', 'github-light'],
      langs: SUPPORTED_LANGUAGES,
    });
  }

  highlighterInstance = await highlighterPromise;
  return highlighterInstance;
}

// 使用暗色主题初始化 mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#6366f1',
    primaryTextColor: '#e2e8f0',
    primaryBorderColor: '#4f46e5',
    lineColor: '#64748b',
    secondaryColor: '#1e293b',
    tertiaryColor: '#0f172a',
    background: '#1a1b26',
    mainBkg: '#1a1b26',
    nodeBorder: '#4f46e5',
    clusterBkg: 'rgba(99, 102, 241, 0.1)',
    clusterBorder: '#4f46e5',
    titleColor: '#f1f5f9',
    edgeLabelBackground: '#1e293b',
    nodeTextColor: '#e2e8f0',
  },
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  securityLevel: 'strict',
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MARKDOWN_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style'],
  ADD_ATTR: ['data-source-line', 'data-mermaid-id', 'data-copy-code', 'aria-label'],
};

const SVG_SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
};

// 规范化语言名称
function normalizeLanguage(lang: string): BundledLanguage {
  const normalized = lang.toLowerCase().trim();
  if (LANGUAGE_ALIASES[normalized]) {
    return LANGUAGE_ALIASES[normalized];
  }
  if (SUPPORTED_LANGUAGES.includes(normalized as BundledLanguage)) {
    return normalized as BundledLanguage;
  }
  return 'text' as BundledLanguage;
}

// 渲染 LaTeX 数学公式
function renderMath(text: string): string {
  // 块级数学公式: $$...$$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_match, formula) => {
    try {
      return `<div class="math-block">${katex.renderToString(formula.trim(), {
        displayMode: true,
        throwOnError: false,
      })}</div>`;
    } catch {
      return `<div class="math-block math-error">${escapeHtml(formula)}</div>`;
    }
  });

  // 行内数学公式: $...$
  text = text.replace(/\$([^$\n]+?)\$/g, (_match, formula) => {
    try {
      return `<span class="math-inline">${katex.renderToString(formula.trim(), {
        displayMode: false,
        throwOnError: false,
      })}</span>`;
    } catch {
      return `<span class="math-inline math-error">${escapeHtml(formula)}</span>`;
    }
  });

  return text;
}

// 为 mermaid 图表生成唯一 ID
let mermaidIdCounter = 0;
function generateMermaidId(): string {
  return `mermaid-${Date.now()}-${mermaidIdCounter++}`;
}

// 创建一个为元素添加行号的自定义渲染器
function createLineTrackingRenderer(
  content: string,
  highlighter: Highlighter | null,
  theme: 'light' | 'dark' = 'dark'
): Renderer {
  const renderer = new Renderer();
  const lines = content.split('\n');

  const normalizeForMatch = (value: string): string => {
    return value
      .replace(/&[a-z0-9#]+;/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/^\s*>\s*/gm, '')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/[`*_~\[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };

  const buildCandidateKeys = (text: string): string[] => {
    const normalizedWhole = normalizeForMatch(text);
    const lineParts = text
      .split('\n')
      .map((line) => normalizeForMatch(line))
      .filter((line) => line.length > 0)
      .slice(0, 3);

    const keys = new Set<string>();
    if (normalizedWhole) {
      keys.add(normalizedWhole);
      keys.add(normalizedWhole.slice(0, 80));
    }

    for (const part of lineParts) {
      keys.add(part);
      keys.add(part.slice(0, 80));
    }

    return Array.from(keys).filter((key) => key.length > 0);
  };

  const normalizedSourceLines = lines.map((line) => normalizeForMatch(line));
  const lineIndexMap = new Map<string, number[]>();
  const keyCursorMap = new Map<string, number>();

  for (let i = 0; i < normalizedSourceLines.length; i++) {
    const normalized = normalizedSourceLines[i];
    if (!normalized) continue;

    const found = lineIndexMap.get(normalized);
    if (found) {
      found.push(i + 1);
    } else {
      lineIndexMap.set(normalized, [i + 1]);
    }
  }

  let lastMatchedLine = 1;

  const findLineNumber = (text: string): number => {
    const keys = buildCandidateKeys(text);
    let matchedLine = -1;

    for (const key of keys) {
      const candidates = lineIndexMap.get(key);
      if (!candidates || candidates.length === 0) {
        continue;
      }

      const usedCursor = keyCursorMap.get(key) ?? 0;
      let chosenCursor = usedCursor;

      while (chosenCursor < candidates.length && candidates[chosenCursor] < lastMatchedLine) {
        chosenCursor += 1;
      }

      if (chosenCursor >= candidates.length) {
        chosenCursor = Math.min(usedCursor, candidates.length - 1);
      }

      matchedLine = candidates[chosenCursor];
      keyCursorMap.set(key, Math.min(chosenCursor + 1, candidates.length));
      break;
    }

    if (matchedLine < 0) {
      for (const key of keys) {
        const shortKey = key.slice(0, 80);
        if (!shortKey) continue;

        for (let i = lastMatchedLine - 1; i < normalizedSourceLines.length; i++) {
          if (normalizedSourceLines[i].includes(shortKey)) {
            matchedLine = i + 1;
            break;
          }
        }

        if (matchedLine > 0) {
          break;
        }

        for (let i = 0; i < lastMatchedLine - 1; i++) {
          if (normalizedSourceLines[i].includes(shortKey)) {
            matchedLine = i + 1;
            break;
          }
        }

        if (matchedLine > 0) {
          break;
        }
      }
    }

    if (matchedLine > 0) {
      lastMatchedLine = Math.max(lastMatchedLine, matchedLine);
    }

    return matchedLine;
  };

  // 覆盖标题渲染器以添加 data-source-line (不在预览模式下显示锚点图标)
  renderer.heading = function (text: string, level: number) {
    const lineNum = findLineNumber(text);
    const lineAttr = lineNum > 0 ? ` data-source-line="${lineNum}"` : '';
    // 与前台对齐基础样式，但不保留 a.heading-anchor 用于复制链接，因为这是预览区
    return `<h${level}${lineAttr}>${text}</h${level}>\n`;
  };

  // 覆盖段落渲染器 - 同时处理数学公式
  renderer.paragraph = function (text: string) {
    const processedText = renderMath(text);
    const lineNum = findLineNumber(text.substring(0, 50));
    const lineAttr = lineNum > 0 ? ` data-source-line="${lineNum}"` : '';
    return `<p${lineAttr}>${processedText}</p>\n`;
  };

  // 覆盖代码块渲染器以支持语法高亮和 mermaid
  renderer.code = function (code: string, language?: string) {
    const lang = language?.toLowerCase().trim() || 'text';

    // 处理 Mermaid 图表
    if (lang === 'mermaid') {
      const id = generateMermaidId();
      const escapedMermaidCode = escapeHtml(code);
      return `
        <div class="mermaid-wrapper">
          <div class="mermaid-container" data-mermaid-id="${id}">
            <pre class="mermaid">${escapedMermaidCode}</pre>
          </div>
        </div>
      `;
    }

    const normalizedLang = normalizeLanguage(lang);
    const langDisplay = language?.toUpperCase() || 'TEXT';

    if (highlighter) {
      try {
        const highlightedCode = highlighter.codeToHtml(code, {
          lang: normalizedLang,
          theme: theme === 'light' ? 'github-light' : 'github-dark',
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

        // 使用带有语言标签的自定义容器包裹 - 使用 CSS 变量
        return `
          <div class="code-block-wrapper">
            <div class="code-block-header">
              <span class="code-block-lang">${langDisplay}</span>
              <button type="button" class="code-block-copy" data-copy-code="1" aria-label="Copy code">
                ⧉
              </button>
            </div>
            <div class="code-block-content">${highlightedCode}</div>
          </div>
        `;
      } catch {
        // 如果高亮失败，回退到普通代码块
      }
    }

    // 无语法高亮的回退 - 使用 CSS 变量
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span class="code-block-lang">${langDisplay}</span>
        </div>
        <pre class="code-block-fallback"><code>${escapedCode}</code></pre>
      </div>
    `;
  };

  return renderer;
}

export function MarkdownPreview({ content, className = '', style, theme = 'dark' }: MarkdownPreviewProps) {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 挂载时加载高亮器
  useEffect(() => {
    getHighlighter().then(setHighlighter);
  }, []);

  const html = useMemo(() => {
    if (!content) return '';
    try {
      const renderer = createLineTrackingRenderer(content, highlighter, theme);
      const parsedHtml = marked.parse(content, {
        gfm: true,
        breaks: true,
        renderer
      }) as string;

      return DOMPurify.sanitize(parsedHtml, MARKDOWN_SANITIZE_CONFIG);
    } catch {
      return DOMPurify.sanitize(`<p>${escapeHtml(content)}</p>`, MARKDOWN_SANITIZE_CONFIG);
    }
  }, [content, highlighter, theme]);

  useEffect(() => {
    if (!containerRef.current) return;

    const handleCopyClick = async (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const button = target.closest<HTMLButtonElement>('.code-block-copy');
      if (!button) return;

      const wrapper = button.closest('.code-block-wrapper');
      const codeElement = wrapper?.querySelector('code');
      const codeText = codeElement?.textContent;
      if (!codeText) return;

      try {
        await navigator.clipboard.writeText(codeText);
      } catch (error) {
        console.error('Copy code error:', error);
      }
    };

    const container = containerRef.current;
    container.addEventListener('click', handleCopyClick);

    return () => {
      container.removeEventListener('click', handleCopyClick);
    };
  }, [html]);

  // HTML 设置后渲染 mermaid 图表
  useEffect(() => {
    if (!containerRef.current) return;

    const mermaidContainers = containerRef.current.querySelectorAll('.mermaid-container');
    if (mermaidContainers.length === 0) return;

    // 重置 mermaid 以渲染新图表
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'light' ? 'default' : 'dark',
      themeVariables: theme === 'light' ? {
        primaryColor: '#6366f1',
        primaryTextColor: '#1e293b',
        primaryBorderColor: '#4f46e5',
        lineColor: '#64748b',
        secondaryColor: '#f1f5f9',
        tertiaryColor: '#ffffff',
        background: '#ffffff',
        mainBkg: '#ffffff',
        nodeBorder: '#cbd5e1',
        titleColor: '#0f172a',
        edgeLabelBackground: '#f8fafc',
        nodeTextColor: '#1e293b',
      } : {
        primaryColor: '#6366f1',
        primaryTextColor: '#e2e8f0',
        primaryBorderColor: '#4f46e5',
        lineColor: '#64748b',
        secondaryColor: '#1e293b',
        tertiaryColor: '#0f172a',
        background: '#1a1b26',
        mainBkg: '#1a1b26',
        nodeBorder: '#4f46e5',
        clusterBkg: 'rgba(99, 102, 241, 0.1)',
        clusterBorder: '#4f46e5',
        titleColor: '#f1f5f9',
        edgeLabelBackground: '#1e293b',
        nodeTextColor: '#e2e8f0',
      },
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      securityLevel: 'strict',
    });
    mermaidIdCounter = 0;

    const renderMermaidDiagrams = async () => {
      for (const container of mermaidContainers) {
        const pre = container.querySelector('pre.mermaid');
        if (!pre) continue;

        const code = pre.textContent || '';
        const id = container.getAttribute('data-mermaid-id') || generateMermaidId();

        try {
          const { svg } = await mermaid.render(id, code);
          container.innerHTML = DOMPurify.sanitize(svg, SVG_SANITIZE_CONFIG);
        } catch (error) {
          console.error('Mermaid rendering error:', error);
          container.innerHTML = `<div class="mermaid-error">Failed to render diagram</div>`;
        }
      }
    };

    renderMermaidDiagrams();
  }, [html]);

  return (
    <div
      ref={containerRef}
      className={`markdown-preview ${theme === 'light' ? 'light-mode' : ''} ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        color: theme === 'light' ? '#334155' : '#e2e8f0',
        lineHeight: 1.75,
        fontSize: '16px',
        ...style,
      }}
    />
  );
}

// Markdown 预览的 CSS 样式 (对齐前台 globals.css .markdown-body)
export const markdownPreviewStyles = `
  .markdown-preview h1 {
    font-size: 2em;
    font-weight: 800;
    margin-top: 2em;
    margin-bottom: 0.5em;
    color: #f1f5f9;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding-bottom: 0.3em;
  }
  .markdown-preview > :first-child {
    margin-top: 0 !important;
  }
  .markdown-preview.light-mode h1 {
    color: #0f172a;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }
  .markdown-preview h2 {
    font-size: 1.5em;
    font-weight: 700;
    margin-top: 1.6em;
    margin-bottom: 0.5em;
    color: #f1f5f9;
  }
  .markdown-preview.light-mode h2 {
    color: #0f172a;
  }
  .markdown-preview h3 {
    font-size: 1.25em;
    font-weight: 600;
    margin-top: 1.4em;
    margin-bottom: 0.5em;
    color: #f1f5f9;
  }
  .markdown-preview.light-mode h3 {
    color: #0f172a;
  }
  .markdown-preview p {
    margin: 0.75em 0;
  }
  .markdown-preview code {
    background: rgba(255, 255, 255, 0.1);
    padding: 0.2em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: inherit;
  }
  .markdown-preview.light-mode code {
    background: #f1f5f9;
    color: #0f172a;
  }
  .markdown-preview pre {
    background: rgba(0, 0, 0, 0.4);
    padding: 1em;
    border-radius: 8px;
    overflow-x: auto;
    margin: 1em 0;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .markdown-preview.light-mode pre {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
  }
  .markdown-preview pre code {
    background: transparent;
    padding: 0;
    font-size: 0.875em;
  }
  /* 代码块包装器样式 */
  .markdown-preview .code-block-wrapper {
    position: relative;
    margin: 1em 0;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: #1a1b26;
  }
  .markdown-preview.light-mode .code-block-wrapper {
    border: 1px solid #e2e8f0;
    background: #ffffff;
  }
  .markdown-preview .code-block-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5em 1em;
    background: rgba(255, 255, 255, 0.05);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  .markdown-preview.light-mode .code-block-header {
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }
  .markdown-preview .code-block-lang {
    font-size: 0.75em;
    color: #94a3b8;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .markdown-preview .code-block-copy {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25em;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #64748b;
    cursor: pointer;
    transition: all 0.2s;
  }
  .markdown-preview .code-block-copy:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
  }
  .markdown-preview.light-mode .code-block-copy:hover {
    background: rgba(0, 0, 0, 0.05);
    color: #334155;
  }
  .markdown-preview .code-block-content {
    overflow-x: auto;
  }
  .markdown-preview .code-block-content pre {
    margin: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
  }
  .markdown-preview .code-block-content code {
    font-size: 0.875em;
    line-height: 1.6;
    tab-size: 2;
  }
  .markdown-preview .code-block-fallback {
    margin: 0;
    padding: 1em;
    background: transparent;
    border: none;
    border-radius: 0;
  }
  /* Shiki 代码样式覆盖 */
  .markdown-preview .shiki {
    background: transparent !important;
    padding: 1em;
    margin: 0;
  }
  .markdown-preview .shiki code {
    background: transparent !important;
    padding: 0;
  }
  .markdown-preview ul {
    list-style-type: disc;
    padding-left: 1.5em;
    margin: 0.75em 0;
  }
  .markdown-preview ol {
    list-style-type: decimal;
    padding-left: 1.5em;
    margin: 0.75em 0;
  }
  .markdown-preview li {
    margin: 0.25em 0;
  }
  .markdown-preview blockquote {
    border-left: 4px solid #6366f1;
    padding-left: 1em;
    margin: 1em 0;
    color: #94a3b8;
    font-style: italic;
  }
  .markdown-preview a {
    color: #818cf8;
    text-decoration: underline;
  }
  .markdown-preview a:hover {
    color: #a5b4fc;
  }
  .markdown-preview hr {
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    margin: 2em 0;
  }
  .markdown-preview.light-mode hr {
    border-top: 1px solid #e2e8f0;
  }
  .markdown-preview table {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
  }
  .markdown-preview th, .markdown-preview td {
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 0.5em 1em;
    text-align: left;
  }
  .markdown-preview.light-mode th, .markdown-preview.light-mode td {
    border: 1px solid #e2e8f0;
  }
  .markdown-preview th {
    background: rgba(255, 255, 255, 0.05);
    font-weight: 600;
  }
  .markdown-preview.light-mode th {
    background: #f8fafc;
  }
  .markdown-preview img {
    max-width: 100%;
    border-radius: 8px;
  }
  /* 数学公式样式 */
  .markdown-preview .math-block {
    margin: 1em 0;
    padding: 1em;
    background: rgba(99, 102, 241, 0.05);
    border-radius: 8px;
    overflow-x: auto;
    text-align: center;
  }
  .markdown-preview.light-mode .math-block {
    background: rgba(99, 102, 241, 0.05); /* 同样的色调也适用于亮色模式 */
  }
  .markdown-preview .math-inline {
    padding: 0 0.2em;
  }
  .markdown-preview .math-error {
    color: #f87171;
    font-family: monospace;
  }
  /* Mermaid 样式 */
  .markdown-preview .mermaid-wrapper {
    margin: 1em 0;
    padding: 1em;
    background: rgba(99, 102, 241, 0.05);
    border-radius: 12px;
    border: 1px solid rgba(99, 102, 241, 0.2);
    overflow-x: auto;
  }
  .markdown-preview.light-mode .mermaid-wrapper {
    background: rgba(99, 102, 241, 0.05);
    border: 1px solid rgba(99, 102, 241, 0.2);
  }
  .markdown-preview .mermaid-container {
    display: flex;
    justify-content: center;
    min-height: 100px;
  }
  .markdown-preview .mermaid-container svg {
    max-width: 100%;
    height: auto;
  }
  .markdown-preview .mermaid-error {
    color: #f87171;
    padding: 1em;
    text-align: center;
    font-family: monospace;
  }
  /* KaTeX 暗色主题覆盖 */
  .markdown-preview .katex {
    color: #e2e8f0;
  }
  .markdown-preview.light-mode .katex {
    color: #334155;
  }
`;

export default MarkdownPreview;
