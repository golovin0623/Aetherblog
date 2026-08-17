/**
 * 发送前的历史预算裁剪 —— 客户端对齐后端 ai-service `_enforce_message_limits`
 * 的硬封顶（单条 8000 / 全量 32000 字符 / 64 条），超限后端直接 413。
 *
 * 与其把裁剪散落在各发送路径（useWritingChat 曾各写一份），这里收敛成纯函数：
 * 上层只管把「断点切片后的完整历史 + 本轮提问」丢进来，拿回可安全发送的数组
 * 与裁剪统计（供 UI 提示"已省略 N 条早期消息"）。
 */

/** 全量字符预算。后端总量硬限 32000，预留 4000 给系统注入与知识上下文。 */
export const CONTEXT_CHAR_BUDGET = 28000;
/** 单条字符上限。后端单条硬限 8000，预留余量给截断后缀等。 */
export const MESSAGE_CHAR_LIMIT = 7600;
/** 历史条数上限。后端硬限 64 条。 */
export const MAX_HISTORY_MESSAGES = 60;

/** 单条超长的截断后缀 —— 让模型知道内容不完整，避免它把断口当成原文结尾。 */
const TRUNCATION_SUFFIX = '…（已截断）';

export interface BudgetedHistory {
  history: { role: 'user' | 'assistant'; content: string }[];
  /** 因预算被丢弃的历史条数。 */
  droppedMessages: number;
  /** 单条超长被截断的条数。 */
  truncatedMessages: number;
  totalChars: number;
}

interface ClampedMessage {
  role: 'user' | 'assistant';
  content: string;
  truncated: boolean;
}

/** 单条超长先截断再计预算 —— 一条 3 万字的粘贴不该独占整个窗口。 */
function clampMessage(m: { role: 'user' | 'assistant'; content: string }): ClampedMessage {
  if (m.content.length <= MESSAGE_CHAR_LIMIT) {
    return { role: m.role, content: m.content, truncated: false };
  }
  return {
    role: m.role,
    content: `${m.content.slice(0, MESSAGE_CHAR_LIMIT)}${TRUNCATION_SUFFIX}`,
    truncated: true,
  };
}

/**
 * 把「历史 + 本轮提问（数组最后一条）」裁进后端预算。
 *
 * 三条硬约束（与 useWritingChat.buildOutboundMessages 踩过的坑对齐，勿回退）：
 * 1. **最后一条永远保留。** 那是本轮提问，丢了请求就没有意义；超长时截断而非丢弃。
 * 2. **从最新往旧回填，超预算即停。** 越新的上下文对当前回答越重要。
 * 3. **丢弃按轮对齐。** 回填停止后若历史打头是 assistant（它配对的 user 已被丢），
 *    一并丢弃 —— Anthropic / deepseek-reasoner 等要求严格交替的 provider 会对
 *    孤儿 assistant 开头直接 400。
 */
export function budgetHistory(
  messages: readonly { role: 'user' | 'assistant'; content: string }[],
): BudgetedHistory {
  if (messages.length === 0) {
    return { history: [], droppedMessages: 0, truncatedMessages: 0, totalChars: 0 };
  }

  const last = clampMessage(messages[messages.length - 1]);
  const kept: ClampedMessage[] = [last];
  let totalChars = last.content.length;

  for (let i = messages.length - 2; i >= 0; i--) {
    if (kept.length >= MAX_HISTORY_MESSAGES) break;
    const candidate = clampMessage(messages[i]);
    if (totalChars + candidate.content.length > CONTEXT_CHAR_BUDGET) break;
    kept.unshift(candidate);
    totalChars += candidate.content.length;
  }

  // 按轮对齐：打头的孤儿 assistant（可能连续多条）全部剥掉，但本轮提问不动。
  while (kept.length > 1 && kept[0].role === 'assistant') {
    totalChars -= kept[0].content.length;
    kept.shift();
  }

  return {
    history: kept.map((m) => ({ role: m.role, content: m.content })),
    droppedMessages: messages.length - kept.length,
    truncatedMessages: kept.filter((m) => m.truncated).length,
    totalChars,
  };
}
