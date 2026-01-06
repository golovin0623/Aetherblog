import { useMemo, useState, useEffect } from 'react';
import { marked, Renderer } from 'marked';
import { createHighlighter, type Highlighter, type BundledLanguage } from 'shiki';

export interface MarkdownPreviewProps {
  content: string;
  className?: string;
  style?: React.CSSProperties;
}

// Supported languages for syntax highlighting
const SUPPORTED_LANGUAGES: BundledLanguage[] = [
  'javascript', 'typescript', 'jsx', 'tsx',
  'python', 'java', 'go', 'rust', 'c', 'cpp',
  'html', 'css', 'scss', 'json', 'yaml', 'xml',
  'sql', 'bash', 'shell', 'powershell',
  'markdown', 'dockerfile', 'nginx',
  'php', 'ruby', 'swift', 'kotlin',
  'vue', 'svelte', 'astro'
];

// Language alias mapping
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

// Global highlighter instance (singleton)
let highlighterPromise: Promise<Highlighter> | null = null;
let highlighterInstance: Highlighter | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (highlighterInstance) return highlighterInstance;
  
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-dark-dimmed'],
      langs: SUPPORTED_LANGUAGES,
    });
  }
  
  highlighterInstance = await highlighterPromise;
  return highlighterInstance;
}

// Normalize language name
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

// Create a custom renderer that adds line numbers to elements
function createLineTrackingRenderer(
  content: string,
  highlighter: Highlighter | null
): Renderer {
  const renderer = new Renderer();
  const lines = content.split('\n');
  
  // Find line number for a given text
  const findLineNumber = (text: string): number => {
    const trimmedText = text.trim().replace(/^#+\s*/, '');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(trimmedText)) {
        return i + 1;
      }
    }
    return -1;
  };

  // Override heading renderer to add data-source-line
  renderer.heading = function(text: string, level: number) {
    const lineNum = findLineNumber(text);
    const lineAttr = lineNum > 0 ? ` data-source-line="${lineNum}"` : '';
    return `<h${level}${lineAttr}>${text}</h${level}>\n`;
  };

  // Override paragraph renderer
  renderer.paragraph = function(text: string) {
    const lineNum = findLineNumber(text.substring(0, 50)); // Use first 50 chars to match
    const lineAttr = lineNum > 0 ? ` data-source-line="${lineNum}"` : '';
    return `<p${lineAttr}>${text}</p>\n`;
  };

  // Override code block renderer for syntax highlighting
  renderer.code = function(code: string, language?: string) {
    const lang = normalizeLanguage(language || 'text');
    const langDisplay = language?.toUpperCase() || 'TEXT';
    
    if (highlighter) {
      try {
        const highlightedCode = highlighter.codeToHtml(code, {
          lang,
          theme: 'github-dark',
        });
        
        // Wrap in custom container with language label
        return `
          <div class="code-block-wrapper">
            <div class="code-block-header">
              <span class="code-block-lang">${langDisplay}</span>
              <button class="code-block-copy" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrapper').querySelector('code').textContent)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
            </div>
            <div class="code-block-content">${highlightedCode}</div>
          </div>
        `;
      } catch {
        // Fall back to plain code block if highlighting fails
      }
    }
    
    // Fallback without syntax highlighting
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

export function MarkdownPreview({ content, className = '', style }: MarkdownPreviewProps) {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);

  // Load highlighter on mount
  useEffect(() => {
    getHighlighter().then(setHighlighter);
  }, []);

  const html = useMemo(() => {
    if (!content) return '';
    try {
      const renderer = createLineTrackingRenderer(content, highlighter);
      return marked.parse(content, {
        gfm: true,
        breaks: true,
        renderer
      }) as string;
    } catch {
      return content;
    }
  }, [content, highlighter]);

  return (
    <div
      className={`markdown-preview ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        color: '#e2e8f0',
        lineHeight: 1.75,
        fontSize: '16px',
        ...style,
      }}
    />
  );
}

// CSS styles for markdown preview
export const markdownPreviewStyles = `
  .markdown-preview h1 {
    font-size: 2em;
    font-weight: 700;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    color: #f1f5f9;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 0.3em;
  }
  .markdown-preview h2 {
    font-size: 1.5em;
    font-weight: 600;
    margin-top: 1.25em;
    margin-bottom: 0.5em;
    color: #f1f5f9;
  }
  .markdown-preview h3 {
    font-size: 1.25em;
    font-weight: 600;
    margin-top: 1em;
    margin-bottom: 0.5em;
    color: #f1f5f9;
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
  }
  .markdown-preview pre {
    background: rgba(0, 0, 0, 0.4);
    padding: 1em;
    border-radius: 8px;
    overflow-x: auto;
    margin: 1em 0;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .markdown-preview pre code {
    background: transparent;
    padding: 0;
    font-size: 0.875em;
  }
  /* Code block wrapper styles */
  .markdown-preview .code-block-wrapper {
    position: relative;
    margin: 1em 0;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: #1a1b26;
  }
  .markdown-preview .code-block-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5em 1em;
    background: rgba(255, 255, 255, 0.05);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
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
  /* Shiki code styling overrides */
  .markdown-preview .shiki {
    background: transparent !important;
    padding: 1em;
    margin: 0;
  }
  .markdown-preview .shiki code {
    background: transparent !important;
    padding: 0;
  }
  .markdown-preview ul, .markdown-preview ol {
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
  .markdown-preview th {
    background: rgba(255, 255, 255, 0.05);
    font-weight: 600;
  }
  .markdown-preview img {
    max-width: 100%;
    border-radius: 8px;
  }
`;

export default MarkdownPreview;
