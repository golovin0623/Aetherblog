/**
 * @file bearDecorations.ts
 * @description Bear 风格 WYSIWYG Markdown 装饰器
 * 
 * 核心原理：使用 CodeMirror 的 ViewPlugin + Decoration 系统，
 * 在光标不在某行时隐藏 Markdown 标记符号（#, **, *, ~~, ` 等），
 * 并为代码块、引用块、分割线、自定义高亮块等提供内联渲染效果。
 * 
 * @ref Bear App 的 WYSIWYG Markdown 编辑体验
 */

import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';

// ========== Alert Block 配置 ==========

// 色值全部走 CSS 变量 —— 跟随主色 + 主题动态解析(苹果级低饱和 signal 色)
const ALERT_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; svg: string }> = {
  info: {
    label: '信息',
    color: 'var(--signal-info)',
    bg: 'rgb(from var(--signal-info) r g b / 0.08)',
    border: 'var(--signal-info)',
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  },
  note: {
    label: '注意',
    color: 'var(--ink-muted)',
    bg: 'rgb(from var(--ink-muted) r g b / 0.08)',
    border: 'var(--ink-muted)',
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/></svg>',
  },
  warning: {
    label: '警告',
    color: 'var(--signal-warn)',
    bg: 'rgb(from var(--signal-warn) r g b / 0.08)',
    border: 'var(--signal-warn)',
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  },
  danger: {
    label: '危险',
    color: 'var(--signal-danger)',
    bg: 'rgb(from var(--signal-danger) r g b / 0.08)',
    border: 'var(--signal-danger)',
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
  },
  tip: {
    label: '提示',
    color: 'var(--signal-success)',
    bg: 'rgb(from var(--signal-success) r g b / 0.08)',
    border: 'var(--signal-success)',
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.9 1.2 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
  },
};

// ========== Widget Types ==========

/** 水平分割线 Widget —— aurora 渐变细线,替代硬 hex
 *  (theme 参数保留用于调用处签名兼容,内部色值由 CSS 变量解析) */
class HrWidget extends WidgetType {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_theme: string) {
    super();
  }
  toDOM() {
    const hr = document.createElement('hr');
    hr.style.cssText = `
      border: none;
      height: 1px;
      background: linear-gradient(90deg,
        transparent,
        rgb(from var(--aurora-1, var(--color-primary)) r g b / 0.28) 50%,
        transparent);
      margin: 0.8em 0;
      pointer-events: none;
    `;
    return hr;
  }
  ignoreEvent() { return false; }
}

/** Alert Block 标题 Widget - 替换 :::type{title="..."} 行 */
class AlertTitleWidget extends WidgetType {
  private alertType: string;
  private title: string;
  private theme: string;

  constructor(alertType: string, title: string, theme: string) {
    super();
    this.alertType = alertType;
    this.title = title;
    this.theme = theme;
  }

  eq(other: AlertTitleWidget) {
    return this.alertType === other.alertType && this.title === other.title && this.theme === other.theme;
  }

  toDOM() {
    const cfg = ALERT_CONFIG[this.alertType] || ALERT_CONFIG.info;
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-bear-alert-title-widget';
    wrapper.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      font-size: 0.9em;
      color: ${cfg.color};
      pointer-events: none;
      user-select: none;
    `;

    // 图标
    const iconSpan = document.createElement('span');
    iconSpan.style.cssText = `display: inline-flex; align-items: center; color: ${cfg.color};`;
    iconSpan.innerHTML = cfg.svg;
    wrapper.appendChild(iconSpan);

    // 标题文本
    const titleSpan = document.createElement('span');
    titleSpan.textContent = this.title;
    wrapper.appendChild(titleSpan);

    return wrapper;
  }

  ignoreEvent() { return false; }
}

// ========== 工具函数 ==========

/**
 * 判断光标是否在指定范围所在的行上
 */
function isCursorOnLine(view: EditorView, from: number, to: number): boolean {
  const { state } = view;
  const lineStart = state.doc.lineAt(from);
  const lineEnd = state.doc.lineAt(to);
  
  for (const range of state.selection.ranges) {
    const cursorLine = state.doc.lineAt(range.head);
    if (cursorLine.number >= lineStart.number && cursorLine.number <= lineEnd.number) return true;
  }
  return false;
}

/**
 * 判断光标是否在指定行号范围内 (inclusive)
 */
function isCursorInLineRange(view: EditorView, startLineNum: number, endLineNum: number): boolean {
  const { state } = view;
  for (const range of state.selection.ranges) {
    const cursorLine = state.doc.lineAt(range.head).number;
    if (cursorLine >= startLineNum && cursorLine <= endLineNum) return true;
  }
  return false;
}

/**
 * 检查位置是否在代码块内
 */
function isInsideFencedCode(codeRanges: { from: number; to: number }[], pos: number): boolean {
  return codeRanges.some(r => pos >= r.from && pos <= r.to);
}

// ========== Alert Block 扫描 ==========

interface AlertBlockRange {
  type: string;
  title: string;
  openLineNum: number;
  closeLineNum: number;
  openLineFrom: number;
  openLineTo: number;
  closeLineFrom: number;
  closeLineTo: number;
}

function scanAlertBlocks(view: EditorView): AlertBlockRange[] {
  const doc = view.state.doc;
  const alertOpenRe = /^:::\s*(info|note|warning|danger|tip)\s*(?:\{\s*title="([^"]*)"\s*\})?\s*$/;
  const alertCloseRe = /^:::\s*$/;
  const blocks: AlertBlockRange[] = [];

  let current: { type: string; title: string; openLineNum: number; openLineFrom: number; openLineTo: number } | null = null;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;

    if (!current) {
      const m = alertOpenRe.exec(text);
      if (m) {
        const cfg = ALERT_CONFIG[m[1]];
        current = {
          type: m[1],
          title: m[2] || (cfg ? cfg.label : m[1]),
          openLineNum: i,
          openLineFrom: line.from,
          openLineTo: line.to,
        };
      }
    } else {
      if (alertCloseRe.test(text)) {
        blocks.push({
          type: current.type,
          title: current.title,
          openLineNum: current.openLineNum,
          closeLineNum: i,
          openLineFrom: current.openLineFrom,
          openLineTo: current.openLineTo,
          closeLineFrom: line.from,
          closeLineTo: line.to,
        });
        current = null;
      }
    }
  }
  return blocks;
}

// ========== Range Decorations（隐藏标记符号）==========

function buildRangeDecorations(view: EditorView, theme: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  const doc = view.state.doc;

  // 收集代码块范围
  const codeRanges: { from: number; to: number }[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === 'FencedCode') {
        codeRanges.push({ from: node.from, to: node.to });
      }
    },
  });

  // 收集所有 range decorations
  const decos: { from: number; to: number; deco: Decoration }[] = [];

  tree.iterate({
    enter(node) {
      const { from, to } = node;

      // 跳过代码块内的节点
      if (isInsideFencedCode(codeRanges, from)) return;

      // 水平分割线 → Widget
      if (node.name === 'HorizontalRule') {
        if (!isCursorOnLine(view, from, to)) {
          decos.push({ from, to, deco: Decoration.replace({ widget: new HrWidget(theme) }) });
        }
        return;
      }

      // 光标在该行时不隐藏标记
      if (isCursorOnLine(view, from, to)) return;

      // 标题标记 # ## ### 等
      if (node.name === 'HeaderMark') {
        const line = doc.lineAt(from);
        const afterMark = Math.min(to + 1, line.to); // 吃掉后面的空格
        decos.push({ from, to: afterMark, deco: Decoration.replace({}) });
        return;
      }

      // 强调标记 * ** _ __
      if (node.name === 'EmphasisMark') {
        decos.push({ from, to, deco: Decoration.replace({}) });
        return;
      }

      // 删除线标记 ~~
      if (node.name === 'StrikethroughMark') {
        decos.push({ from, to, deco: Decoration.replace({}) });
        return;
      }

      // 行内代码 `code`
      if (node.name === 'InlineCode') {
        const text = doc.sliceString(from, to);
        if (text.startsWith('`') && text.endsWith('`') && text.length >= 2) {
          // 隐藏开头 `
          decos.push({ from, to: from + 1, deco: Decoration.replace({}) });
          // 隐藏结尾 `
          decos.push({ from: to - 1, to, deco: Decoration.replace({}) });
          // 中间内容加背景
          if (to - from > 2) {
            decos.push({
              from: from + 1, to: to - 1,
              deco: Decoration.mark({ class: 'cm-bear-inline-code' }),
            });
          }
        }
        return;
      }

      // 链接标记 [ ] ( )
      if (node.name === 'LinkMark') {
        decos.push({ from, to, deco: Decoration.replace({}) });
        return;
      }

      // URL（链接目标）
      if (node.name === 'URL') {
        decos.push({ from, to, deco: Decoration.replace({}) });
        return;
      }

      // 引用标记 >
      if (node.name === 'QuoteMark') {
        const line = doc.lineAt(from);
        const afterMark = Math.min(to + 1, line.to);
        decos.push({ from, to: afterMark, deco: Decoration.replace({}) });
        return;
      }
    },
  });

  // === Alert Block WYSIWYG ===
  // 当光标不在 alert block 范围内时，隐藏 ::: 标记并显示标题 Widget
  const alertBlocks = scanAlertBlocks(view);
  for (const block of alertBlocks) {
    // 检查光标是否在整个 alert block 范围内（包括开头和结尾行）
    const cursorInBlock = isCursorInLineRange(view, block.openLineNum, block.closeLineNum);

    if (!cursorInBlock) {
      // 替换开头行 :::type{title="..."} → 标题 Widget
      decos.push({
        from: block.openLineFrom,
        to: block.openLineTo,
        deco: Decoration.replace({
          widget: new AlertTitleWidget(block.type, block.title, theme),
        }),
      });

      // 隐藏关闭行 :::
      decos.push({
        from: block.closeLineFrom,
        to: block.closeLineTo,
        deco: Decoration.replace({}),
      });
    }
  }

  // 必须按 from 升序排列
  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const d of decos) {
    builder.add(d.from, d.to, d.deco);
  }
  return builder.finish();
}

// ========== Line Decorations（背景/边框）==========

function buildLineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  const doc = view.state.doc;

  const lineClasses = new Map<number, string>();

  tree.iterate({
    enter(node) {
      // 代码块整块背景
      if (node.name === 'FencedCode') {
        const startLine = doc.lineAt(node.from);
        const endLine = doc.lineAt(node.to);
        for (let i = startLine.number; i <= endLine.number; i++) {
          lineClasses.set(i, 'cm-bear-codeblock-line');
        }
        return;
      }

      // 引用块左边框
      if (node.name === 'Blockquote') {
        const startLine = doc.lineAt(node.from);
        const endLine = doc.lineAt(node.to);
        for (let i = startLine.number; i <= endLine.number; i++) {
          if (!lineClasses.has(i)) {
            lineClasses.set(i, 'cm-bear-blockquote-line');
          }
        }
        return;
      }
    },
  });

  // === 自定义高亮块行装饰 ===
  const alertColorMap: Record<string, string> = {
    info: 'cm-bear-alert-info',
    note: 'cm-bear-alert-note',
    warning: 'cm-bear-alert-warning',
    danger: 'cm-bear-alert-danger',
    tip: 'cm-bear-alert-tip',
  };
  const alertBlocks = scanAlertBlocks(view);
  for (const block of alertBlocks) {
    const cls = alertColorMap[block.type] || alertColorMap.info;
    for (let i = block.openLineNum; i <= block.closeLineNum; i++) {
      if (!lineClasses.has(i)) {
        lineClasses.set(i, cls);
      }
    }
  }

  // Line decorations 按行号升序添加
  const sorted = Array.from(lineClasses.entries()).sort((a, b) => a[0] - b[0]);
  for (const [lineNum, cls] of sorted) {
    const line = doc.line(lineNum);
    builder.add(line.from, line.from, Decoration.line({ class: cls }));
  }
  return builder.finish();
}

// ========== 导出 ==========

/**
 * 创建 Bear 风格装饰器的 CodeMirror 扩展
 */
export function createBearDecorations(theme: string) {
  return [
    // Range decorations（隐藏标记 + 行内代码背景 + 分割线 Widget + Alert WYSIWYG）
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildRangeDecorations(view, theme);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = buildRangeDecorations(update.view, theme);
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),

    // Line decorations（代码块背景 + 引用块边框 + Alert 背景）
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildLineDecorations(view);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = buildLineDecorations(update.view);
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),

    // Bear 风格样式 —— 全部走 CSS 变量,跟随主色 + 主题自动切换
    EditorView.theme({
      '.cm-bear-codeblock-line': {
        backgroundColor: 'rgb(from var(--ink-muted) r g b / 0.05)',
        borderRadius: '0',
      },
      '.cm-bear-blockquote-line': {
        borderLeft: '2px solid rgb(from var(--aurora-1, var(--color-primary)) r g b / 0.45)',
        paddingLeft: '12px !important',
        color: 'var(--ink-secondary)',
        fontStyle: 'italic',
      },
      '.cm-bear-inline-code': {
        backgroundColor: 'rgb(from var(--aurora-1, var(--color-primary)) r g b / 0.1)',
        borderRadius: '4px',
        padding: '1px 5px',
        fontFamily: "'Geist Mono', 'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', 'Fira Code', ui-monospace, monospace",
        fontSize: '0.9em',
        color: 'var(--aurora-1, var(--color-primary))',
      },
      // Alert 高亮块行装饰样式
      '.cm-bear-alert-info': {
        borderLeft: '3px solid var(--signal-info)',
        paddingLeft: '12px !important',
        backgroundColor: 'rgb(from var(--signal-info) r g b / 0.08)',
      },
      '.cm-bear-alert-note': {
        borderLeft: '3px solid var(--ink-muted)',
        paddingLeft: '12px !important',
        backgroundColor: 'rgb(from var(--ink-muted) r g b / 0.08)',
      },
      '.cm-bear-alert-warning': {
        borderLeft: '3px solid var(--signal-warn)',
        paddingLeft: '12px !important',
        backgroundColor: 'rgb(from var(--signal-warn) r g b / 0.08)',
      },
      '.cm-bear-alert-danger': {
        borderLeft: '3px solid var(--signal-danger)',
        paddingLeft: '12px !important',
        backgroundColor: 'rgb(from var(--signal-danger) r g b / 0.08)',
      },
      '.cm-bear-alert-tip': {
        borderLeft: '3px solid var(--signal-success)',
        paddingLeft: '12px !important',
        backgroundColor: 'rgb(from var(--signal-success) r g b / 0.08)',
      },
    }, { dark: theme === 'dark' }),
  ];
}
