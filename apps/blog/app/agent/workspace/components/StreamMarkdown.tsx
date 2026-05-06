'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
}

/**
 * 流式期间的轻量 Markdown 渲染器。
 *
 * 它和正式版 `apps/blog/app/components/MarkdownRenderer.tsx` 的差异：
 *   · 不引 shiki    —— 流式期间每帧都重 highlight 太贵；
 *   · 不引 KaTeX    —— 公式半截渲染会闪烁；
 *   · 不引 mermaid  —— 半截图同理；
 *   · 不引 sanitize —— assistant 内容不来自外部 user，本身可信；流式时还要求
 *                     parser 容忍未闭合标签（`**bold` 这种半成品状态），rehype-sanitize
 *                     的严格模式反而会抹掉刚出现的格式。
 *
 * 仍然支持的：
 *   · GFM (表格 / 任务列表 / 删除线)
 *   · 标准 Markdown 内联 + 块（标题 / 列表 / 引用 / 代码 fence / 链接）
 *
 * 流式结束后（`!message.pending`），父级会切到正式 MarkdownRenderer，shiki 上色。
 */
const REMARK_PLUGINS = [remarkGfm];

function StreamMarkdownBase({ content }: Props) {
  return (
    <div className="agent-md agent-md-stream">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
        {content || ''}
      </ReactMarkdown>
    </div>
  );
}

// content 字符串本身就是 props.diff 的核心信号；其它 props 不存在，比较器可以
// 极简。父级用 rAF 限速到 60fps，每次内容变化都是有效新帧。
export default memo(StreamMarkdownBase);
