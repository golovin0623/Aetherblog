'use client';

/**
 * CJK 友好的 markdown 预处理
 *
 * CommonMark 的 emphasis 闭合规则在中文标点 / 汉字相邻 `**` / `*` 时会失败。
 * 典型 case：
 *
 *   **出处说明：**我目前 ...     —— `：` + `**` + `我`，`**` 不能 right-flank
 *   字**重点**字                 —— 整个 bold 被汉字夹住，开闭都不算 flank
 *
 * Anthropic / OpenAI / Google 的中文模型几乎都会输出这种 markdown，让用户
 * 调整 prompt 不现实。这里在客户端预处理：在受影响的 `**` 旁边补半角空格，
 * 让 marked / commonmark 正确解析。视觉副作用是 bold 之后多 1 个空格——比
 * `**` 字面外漏好得多。
 */

const CJK_LETTER = '一-鿿㐀-䶿豈-﫿';

// 1) `字**bold**字` 三明治 —— bold 内容至少 2 个非空白字符，左右各补空格。
const WRAPPED_BOLD_BETWEEN_CJK = new RegExp(
  `([${CJK_LETTER}])(\\*\\*[^\\s*][^*]*?[^\\s*]\\*\\*)([${CJK_LETTER}])`,
  'gu',
);

// 2) `字**X**字` —— bold 内容只有 1 个字符，#1 的 `[^\\s*][^*]*?[^\\s*]` 不命中。
const WRAPPED_SINGLE_CHAR_BOLD = new RegExp(
  `([${CJK_LETTER}])(\\*\\*[^\\s*]\\*\\*)([${CJK_LETTER}])`,
  'gu',
);

// 3) 高频：`**xx：**汉字` —— 仅闭合侧失败。在 ** 与汉字之间补空格。
const CLOSING_BOLD_BEFORE_CJK = new RegExp(
  `([^\\s*])(\\*\\*)([${CJK_LETTER}])`,
  'gu',
);

export function normalizeCjkInlineMarkdown(text: string): string {
  if (!text) return text;
  let out = text;
  // 顺序敏感：先处理整体 unit，避免后续单方向规则把它打成开闭都失败的中间状态。
  out = out.replace(WRAPPED_BOLD_BETWEEN_CJK, '$1 $2 $3');
  out = out.replace(WRAPPED_SINGLE_CHAR_BOLD, '$1 $2 $3');
  // 然后处理 `xx：**汉字` 只在右侧失败的 case。
  out = out.replace(CLOSING_BOLD_BEFORE_CJK, '$1$2 $3');
  return out;
}
