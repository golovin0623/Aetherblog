'use client';

import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
}

/**
 * 流式期间稳定未闭合的代码围栏。
 *
 * 模型正在输出代码块时，累计文本里的围栏尚未闭合 —— remark 会在
 * 「后续所有文本都是代码」和「反引号只是普通字符」两种解析之间随
 * 每帧增量反复横跳，scrollHeight 剧烈振荡（实测 1k↔5k px），既是
 * 主线程重排风暴也是"滚动乱窜"的元凶。检测到未闭合围栏时补一个
 * 合成闭合，让代码块单调生长（LobeHub / streamdown 同款技术）。
 *
 * 用小型状态机而非奇偶计数：按 CommonMark 语义，围栏内部以另一种
 * 记号开头的行（``` 块里的 ~~~ 分隔线）或长度不足的同记号行都是
 * 内容而非闭合；闭合必须同字符、长度 ≥ 开栏、且行尾只有空白。
 * 朴素计数会被这些行翻转奇偶，反而在结尾拼出一个虚假的新开栏。
 */
function stabilizeStreamingFences(src: string): string {
  let openChar: string | null = null;
  let openLen = 0;
  for (const line of src.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!m) continue;
    const marker = m[1];
    if (openChar === null) {
      // 开栏：反引号围栏的 info string 里不允许再出现反引号（CommonMark），
      // 该情形按普通文本处理。
      if (marker[0] === '`' && m[2].includes('`')) continue;
      openChar = marker[0];
      openLen = marker.length;
    } else if (marker[0] === openChar && marker.length >= openLen && m[2].trim() === '') {
      openChar = null;
      openLen = 0;
    }
    // 其余（围栏内的异种记号 / 长度不足 / 带尾缀的行）都是内容，忽略。
  }
  if (openChar !== null) {
    return `${src}\n${openChar.repeat(Math.max(3, openLen))}`;
  }
  return src;
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
  const stabilized = useMemo(() => stabilizeStreamingFences(content || ''), [content]);
  return (
    <div className="agent-md agent-md-stream">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
        {stabilized}
      </ReactMarkdown>
    </div>
  );
}

// content 字符串本身就是 props.diff 的核心信号；其它 props 不存在，比较器可以
// 极简。父级用 rAF 限速到 60fps，每次内容变化都是有效新帧。
export default memo(StreamMarkdownBase);
