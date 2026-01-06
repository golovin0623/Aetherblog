'use client';

import { useMemo, useState, useEffect } from 'react';
import { marked, Renderer } from 'marked';
import { createHighlighter, type Highlighter, type BundledLanguage } from 'shiki';

interface MarkdownRendererProps {
  content: string;
  className?: string;
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

// Create a custom renderer with syntax highlighting
function createHighlightingRenderer(highlighter: Highlighter | null): Renderer {
  const renderer = new Renderer();

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

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);

  // Load highlighter on mount
  useEffect(() => {
    getHighlighter().then(setHighlighter);
  }, []);

  const html = useMemo(() => {
    if (!content) return '';
    try {
      const renderer = createHighlightingRenderer(highlighter);
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
    <>
      <style jsx global>{`
        /* Code block wrapper styles */
        .markdown-body .code-block-wrapper {
          position: relative;
          margin: 1em 0;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: #1a1b26;
        }
        .markdown-body .code-block-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5em 1em;
          background: rgba(255, 255, 255, 0.05);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .markdown-body .code-block-lang {
          font-size: 0.75em;
          color: #94a3b8;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .markdown-body .code-block-copy {
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
        .markdown-body .code-block-copy:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #e2e8f0;
        }
        .markdown-body .code-block-content {
          overflow-x: auto;
        }
        .markdown-body .code-block-content pre {
          margin: 0 !important;
          border: none !important;
          border-radius: 0 !important;
          background: transparent !important;
        }
        .markdown-body .code-block-content code {
          font-size: 0.875em;
          line-height: 1.6;
          tab-size: 2;
        }
        .markdown-body .code-block-fallback {
          margin: 0;
          padding: 1em;
          background: transparent;
          border: none;
          border-radius: 0;
        }
        /* Shiki code styling overrides */
        .markdown-body .shiki {
          background: transparent !important;
          padding: 1em;
          margin: 0;
        }
        .markdown-body .shiki code {
          background: transparent !important;
          padding: 0;
        }
      `}</style>
      <div
        className={`markdown-body ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}

export default MarkdownRenderer;
