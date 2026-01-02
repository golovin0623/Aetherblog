import React, { useMemo } from 'react';
import { marked } from 'marked';

export interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className = '' }: MarkdownPreviewProps) {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      return marked.parse(content);
    } catch {
      return content;
    }
  }, [content]);

  return (
    <div
      className={`prose prose-invert prose-lg max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default MarkdownPreview;
