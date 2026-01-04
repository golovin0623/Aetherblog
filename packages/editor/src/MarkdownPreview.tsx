import { useMemo } from 'react';
import { marked, Renderer } from 'marked';

export interface MarkdownPreviewProps {
  content: string;
  className?: string;
  style?: React.CSSProperties;
}

// Create a custom renderer that adds line numbers to elements
function createLineTrackingRenderer(content: string): Renderer {
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

  return renderer;
}

export function MarkdownPreview({ content, className = '', style }: MarkdownPreviewProps) {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      const renderer = createLineTrackingRenderer(content);
      return marked.parse(content, { 
        gfm: true, 
        breaks: true,
        renderer 
      }) as string;
    } catch {
      return content;
    }
  }, [content]);

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
