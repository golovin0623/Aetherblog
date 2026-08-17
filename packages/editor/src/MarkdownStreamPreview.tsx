/**
 * MarkdownStreamPreview —— AI 流式输出期间的轻量 Markdown 渲染器。
 *
 * 它与正式版 `MarkdownPreview.tsx` 的分工（为什么这里什么重型能力都不引）：
 *   · 不引 shiki    —— 流式期间每一帧增量都会触发整段重 parse + 重 highlight，
 *                     shiki 的逐 token 上色在长回答里是主线程灾难；
 *   · 不引 KaTeX    —— 公式只输出一半时（`$\frac{a}{` 这种）渲染结果每帧在
 *                     「公式」和「乱码」之间跳变，视觉闪烁；
 *   · 不引 mermaid  —— 半截图定义必然 parse 失败，错误占位反复闪现；
 *   · 不引自定义 tokenizer（嵌套围栏 / alert 块）—— 半截 `:::info` 会被解析
 *                     成普通段落再突变成块，流式期间只求「结构大致稳定」。
 *
 * 流式结束后由调用方切换到 MarkdownPreview，拿回 shiki / KaTeX / mermaid /
 * alert 块的完整能力。这里只做 marked(gfm) + DOMPurify 的最小组合，
 * 目标是每帧 parse 开销小到可以忽略。
 */
import { memo, useMemo, type FC } from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * 流式期间稳定未闭合的代码围栏。
 *
 * 模型正在输出代码块时，累计文本里的围栏尚未闭合 —— parser 会在
 * 「后续所有文本都是代码」和「反引号只是普通字符」两种解析之间随
 * 每帧增量反复横跳，scrollHeight 剧烈振荡（blog 端实测 1k↔5k px），
 * 既是主线程重排风暴也是「滚动乱窜」的元凶。检测到未闭合围栏时补一个
 * 合成闭合，让代码块单调生长（LobeHub / streamdown 同款技术）。
 *
 * 用小型状态机而非奇偶计数：按 CommonMark 语义，围栏内部以另一种
 * 记号开头的行（``` 块里的 ~~~ 分隔线）或长度不足的同记号行都是
 * 内容而非闭合；闭合必须同字符、长度 ≥ 开栏、且行尾只有空白。
 * 朴素计数会被这些行翻转奇偶，反而在结尾拼出一个虚假的新开栏。
 *
 * 纯函数、单独导出 —— 供测试直接覆盖（editor 包暂无测试基建，admin 侧后补）。
 */
export function stabilizeStreamingFences(src: string): string {
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
 * marked 实例隔离：MarkdownPreview 在模块顶层对全局单例 `marked` 调用了
 * `marked.use({ extensions: [...] })`（嵌套围栏 / alert 块 tokenizer）。
 * 流式渲染既不需要也不想继承这些扩展（半截 alert 会解析失败），所以用
 * 独立的 `new Marked()` 实例（marked ^12 支持实例化），双方配置互不污染 ——
 * 这里改配置不影响 MarkdownPreview，反之亦然。
 *
 * 代码块走 marked 默认渲染：普通 `<pre><code class="language-x">`，无高亮。
 */
const streamMarked = new Marked({ gfm: true, breaks: true });

/**
 * 与 MarkdownPreview 同一防线：AI 输出可能复述外部内容（检索片段 / 用户
 * 粘贴的 HTML），不能直接信任，统一过 DOMPurify。
 */
const STREAM_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface MarkdownStreamPreviewProps {
  content: string;
  className?: string;
}

function MarkdownStreamPreviewBase({ content, className = '' }: MarkdownStreamPreviewProps) {
  // parse 结果按 content 缓存：调用方通常已用 rAF 限帧合并增量，这里再用
  // useMemo 保证内容未变的重渲染（如父级布局变化）零 parse 成本。
  const html = useMemo(() => {
    if (!content) return '';
    try {
      // 同步 parse（未开 async 选项），返回值必为 string
      const parsed = streamMarked.parse(stabilizeStreamingFences(content)) as string;
      return DOMPurify.sanitize(parsed, STREAM_SANITIZE_CONFIG);
    } catch {
      // 半成品 Markdown 极端情况下 parse 抛错：回退成纯文本段落，
      // 绝不让流式 UI 因一帧坏输入而崩掉。
      return DOMPurify.sanitize(`<p>${escapeHtml(content)}</p>`, STREAM_SANITIZE_CONFIG);
    }
  }, [content]);

  return (
    <div
      className={`markdown-stream-preview ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// content 字符串就是唯一的重渲染信号，浅比较即可挡掉父级无关更新。
export const MarkdownStreamPreview: FC<MarkdownStreamPreviewProps> = memo(
  MarkdownStreamPreviewBase,
);

export default MarkdownStreamPreview;
