/**
 * @file bearDecorations.ts
 * @description Bear 风格 WYSIWYG Markdown 装饰器
 * 
 * 核心原理：使用 CodeMirror 的 ViewPlugin + Decoration 系统，
 * 在光标不在某行时隐藏 Markdown 标记符号（#, **, *, ~~, ` 等），
 * 并为代码块、引用块、分割线等提供内联渲染效果。
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

// ========== Widget Types ==========

/** 水平分割线 Widget */
class HrWidget extends WidgetType {
  private theme: string;
  constructor(theme: string) {
    super();
    this.theme = theme;
  }
  toDOM() {
    const hr = document.createElement('hr');
    hr.style.cssText = `
      border: none;
      height: 1px;
      background: ${this.theme === 'light' ? '#e2e8f0' : '#334155'};
      margin: 0.8em 0;
      pointer-events: none;
    `;
    return hr;
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
 * 检查位置是否在代码块内
 */
function isInsideFencedCode(codeRanges: { from: number; to: number }[], pos: number): boolean {
  return codeRanges.some(r => pos >= r.from && pos <= r.to);
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
        // 同时隐藏 URL 前面的 ( 和后面的 )，但那些是 LinkMark 处理的
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
          // 不覆盖代码块
          if (!lineClasses.has(i)) {
            lineClasses.set(i, 'cm-bear-blockquote-line');
          }
        }
        return;
      }
    },
  });

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
    // Range decorations（隐藏标记 + 行内代码背景 + 分割线 Widget）
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

    // Line decorations（代码块背景 + 引用块边框）
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

    // Bear 风格样式
    EditorView.theme({
      '.cm-bear-codeblock-line': {
        backgroundColor: theme === 'light' ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.04)',
        borderRadius: '0',
      },
      '.cm-bear-blockquote-line': {
        borderLeft: `3px solid ${theme === 'light' ? '#94a3b8' : '#64748b'}`,
        paddingLeft: '12px !important',
        color: theme === 'light' ? '#64748b' : '#94a3b8',
        fontStyle: 'italic',
      },
      '.cm-bear-inline-code': {
        backgroundColor: theme === 'light' ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.1)',
        borderRadius: '4px',
        padding: '1px 5px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '0.9em',
        color: theme === 'light' ? '#c2410c' : '#fb923c',
      },
    }),
  ];
}
