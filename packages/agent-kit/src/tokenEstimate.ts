/**
 * 轻量 token 估算 —— 纯前端启发式，用于上下文用量计与消息元数据展示。
 *
 * 后端不回传 usage 事件（用量只落 ai_usage_logs），前端只能估算。经验系数：
 *   · CJK（汉字/假名/谚文）≈ 1 字符 = 1 token（BPE 对 CJK 基本逐字切）
 *   · 其余文本 ≈ 4 字符 = 1 token（OpenAI/Anthropic 英文经验值）
 * 展示时永远带 "~" 前缀，明确这是估算而非计费真值。
 */

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = text.match(CJK_RE)?.length ?? 0;
  const rest = text.length - cjkCount;
  return cjkCount + Math.ceil(rest / 4);
}

/** 多段消息合计（含每条消息的固定开销 ~4 token role/分隔符）。 */
export function estimateMessagesTokens(contents: readonly string[]): number {
  let total = 0;
  for (const c of contents) total += estimateTokens(c) + 4;
  return total;
}

/** 1234 -> "1.2K"，890 -> "890"。上下文计量的紧凑显示。 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}
