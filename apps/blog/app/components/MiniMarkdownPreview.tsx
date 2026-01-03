'use client';

import { useMemo } from 'react';
import { marked } from 'marked';

interface MiniPreviewProps {
  content: string;
  maxLength?: number;
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function MiniMarkdownPreview({ content, maxLength = 2000 }: MiniPreviewProps) {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      const truncated = content.slice(0, maxLength);
      return marked.parse(truncated) as string;
    } catch {
      return content;
    }
  }, [content, maxLength]);

  return (
    <div
      className="mini-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default MiniMarkdownPreview;
