'use client';

interface CodeSampleProps {
  code: string;
  language?: string;
  caption?: string;
  className?: string;
}

/**
 * 轻量代码片段展示 —— 不引入 shiki/prism(会膨胀 bundle),
 * 只做:mono 字体 + 左侧 aurora 光带 + 可选 caption。
 * 保持克制,让 code 本身成为主角。
 */
export default function CodeSample({
  code,
  language = 'css',
  caption,
  className = '',
}: CodeSampleProps) {
  return (
    <figure className={`relative rounded-lg overflow-hidden ${className}`}>
      {/* 左侧 aurora 光带 */}
      <div
        className="absolute left-0 top-3 bottom-3 w-[2px] rounded-full"
        style={{ background: 'var(--aurora-1)' }}
        aria-hidden="true"
      />
      <pre
        className="font-mono text-[12.5px] leading-relaxed overflow-x-auto py-4 pl-5 pr-4 m-0 bg-[color-mix(in_oklch,var(--bg-leaf)_75%,transparent)] text-[var(--ink-secondary)]"
      >
        <code className={`language-${language}`}>{code}</code>
      </pre>
      {caption && (
        <figcaption className="mt-2 font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--ink-muted)]">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
