/* =============================================================
 * ANSI 终端色码处理
 * -------------------------------------------------------------
 * 后端 zerolog 的 ConsoleWriter 在被 start.sh 重定向进日志文件时，
 * 仍可能把彩色 SGR 序列（ESC[32m … ESC[0m）写进 *.log。这些字节在
 * 浏览器里会渲染成「脏字符」（□ / 方块）。这里提供两条互补能力：
 *   • stripAnsi —— 彻底剥离色码，供「优化模式」做结构化解析。
 *   • tokenizeAnsi —— 把色码翻译成带 design-token 颜色的片段，供「原始
 *     模式」忠实还原终端配色（对齐 CLI Proxy API 的观感），且不留脏字符。
 *
 * 颜色一律映射到设计系统 token（ref: CLAUDE.md §3.4.1 不发明新颜色）。
 * ============================================================= */

// 标准 CSI SGR 序列：ESC[ … m（\x1b[），以及 8-bit C1 形态（\x9b）。
// no-control-regex 是刻意的 —— 匹配 ANSI 必须命中 ESC/C1 控制字节。
// eslint-禁用-下一行无控制正则表达式
const ANSI_SGR_RE = /\x1b\[[0-9;]*m|\x9b[0-9;]*m/g;
// 退化形态：ESC 字节在传输/拷贝中丢失，仅剩 "[36m" 这种孤儿码。
// 仅在确认行内出现过真实 ESC/C1 字节时才清理，避免误伤正文里的 "[200ms]" 之类。
const ORPHAN_SGR_RE = /\[\d{1,3}(?:;\d{1,3})*m/g;

/** 行内是否含有 ANSI 色码（以 ESC / C1 字节判定）。 */
export function hasAnsi(input: string): boolean {
  // eslint-禁用-下一行无控制正则表达式
  return /\x1b\[|\x9b/.test(input);
}

/** 剥离所有 ANSI 色码，返回纯文本。 */
export function stripAnsi(input: string): string {
  if (!input) return input;
  let out = input.replace(ANSI_SGR_RE, '');
  if (input.indexOf('\x1b') !== -1 || input.indexOf('\x9b') !== -1) {
    out = out.replace(ORPHAN_SGR_RE, '');
  }
  return out;
}

export interface AnsiToken {
  text: string;
  /** 拼接好的 className（颜色 + 粗体 + 暗淡）。 */
  cls: string;
}

// SGR 前景色 → design-token className。
// aurora 调色板偏靛紫，没有原生青色：青(36/96) 借用 signal-info（蓝），
// 品红(35/95) 借用 aurora-4（紫）。
const FG_CLASS: Record<number, string> = {
  30: 'text-[var(--ink-muted)]',
  31: 'text-[var(--signal-danger)]',
  32: 'text-[var(--signal-success)]',
  33: 'text-[var(--signal-warn)]',
  34: 'text-[var(--signal-info)]',
  35: 'text-[var(--aurora-4)]',
  36: 'text-[var(--signal-info)]',
  37: 'text-[var(--ink-secondary)]',
  90: 'text-[var(--ink-muted)]',
  91: 'text-[var(--signal-danger)]',
  92: 'text-[var(--signal-success)]',
  93: 'text-[var(--signal-warn)]',
  94: 'text-[var(--signal-info)]',
  95: 'text-[var(--aurora-4)]',
  96: 'text-[var(--signal-info)]',
  97: 'text-[var(--ink-primary)]',
};

/**
 * 把含 ANSI 色码的字符串切成带样式的片段。无色码时返回单个素片段。
 * 仅处理常见的前景色 / 粗体(1) / 暗淡(2) / 重置(0,22,39) —— 足以覆盖
 * zerolog ConsoleWriter 与 uvicorn 的输出，不追求完整 VT100 仿真。
 */
export function tokenizeAnsi(input: string): AnsiToken[] {
  const tokens: AnsiToken[] = [];
  if (!input) return tokens;

  let fg = '';
  let bold = false;
  let dim = false;
  let last = 0;
  // eslint-禁用-下一行无控制正则表达式
  const re = /\x1b\[([0-9;]*)m|\x9b([0-9;]*)m/g;
  let m: RegExpExecArray | null;

  const push = (text: string) => {
    if (!text) return;
    const cls = [fg, bold ? 'font-semibold' : '', dim ? 'opacity-70' : '']
      .filter(Boolean)
      .join(' ');
    tokens.push({ text, cls });
  };

  while ((m = re.exec(input)) !== null) {
    push(input.slice(last, m.index));
    last = re.lastIndex;
    const codes = (m[1] ?? m[2] ?? '')
      .split(';')
      .filter((s) => s !== '')
      .map(Number);
    if (codes.length === 0) {
      // 空参数等价于 reset
      fg = '';
      bold = false;
      dim = false;
      continue;
    }
    for (const code of codes) {
      if (code === 0) {
        fg = '';
        bold = false;
        dim = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 2) {
        dim = true;
      } else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 39) {
        fg = '';
      } else if (FG_CLASS[code]) {
        fg = FG_CLASS[code];
      }
    }
  }
  push(input.slice(last));
  return tokens;
}
