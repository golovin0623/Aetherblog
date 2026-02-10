/**
 * AI Ghost Text Extension for CodeMirror 6
 *
 * 功能：
 * 1. 渲染灰色半透明的 AI 建议文本
 * 2. Tab 键接纳建议
 * 3. Esc 键拒绝建议
 * 4. 支持部分接纳（一个词/一行）
 */

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { StateField, StateEffect, Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

// ==================== 状态管理 ====================

/** AI 建议的状态 */
export interface GhostTextState {
  suggestion: string;
  position: number;
  confidence: number;
}

/** 设置 Ghost Text 的 Effect */
export const setGhostTextEffect = StateEffect.define<GhostTextState | null>();

/** Ghost Text State Field */
export const ghostTextState = StateField.define<GhostTextState | null>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setGhostTextEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

// ==================== Ghost Text Widget ====================

class GhostTextWidget extends WidgetType {
  constructor(private suggestion: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.textContent = this.suggestion;
    span.className = 'cm-ghost-text';
    span.style.cssText = `
      color: var(--text-muted, #64748b);
      opacity: 0.5;
      pointer-events: none;
      font-style: italic;
    `;
    return span;
  }

  eq(other: GhostTextWidget): boolean {
    return this.suggestion === other.suggestion;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ==================== 装饰器管理 ====================

export const ghostTextPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.state.field(ghostTextState) !== update.startState.field(ghostTextState)
      ) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const ghostText = view.state.field(ghostTextState);

      if (!ghostText || !ghostText.suggestion) {
        return Decoration.none;
      }

      const { position, suggestion } = ghostText;

      // 确保位置有效
      if (position < 0 || position > view.state.doc.length) {
        return Decoration.none;
      }

      const widget = Decoration.widget({
        widget: new GhostTextWidget(suggestion),
        side: 1,
      });

      return Decoration.set([widget.range(position)]);
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// ==================== 快捷键处理 ====================

export interface GhostTextKeyBindings {
  onAccept: () => void;
  onReject: () => void;
  onAcceptWord: () => void;
  onAcceptLine: () => void;
}

export const createGhostTextKeymap = (handlers: GhostTextKeyBindings): Extension => {
  return keymap.of([
    {
      key: 'Tab',
      preventDefault: true,
      run: (view) => {
        const ghostText = view.state.field(ghostTextState, false);
        if (ghostText && ghostText.suggestion) {
          handlers.onAccept();
          return true;
        }
        return false;
      },
    },
    {
      key: 'Escape',
      run: (view) => {
        const ghostText = view.state.field(ghostTextState, false);
        if (ghostText && ghostText.suggestion) {
          handlers.onReject();
          return true;
        }
        return false;
      },
    },
    {
      key: 'Ctrl-ArrowRight',
      mac: 'Cmd-ArrowRight',
      run: (view) => {
        const ghostText = view.state.field(ghostTextState, false);
        if (ghostText && ghostText.suggestion) {
          handlers.onAcceptWord();
          return true;
        }
        return false;
      },
    },
    {
      key: 'Ctrl-ArrowDown',
      mac: 'Cmd-ArrowDown',
      run: (view) => {
        const ghostText = view.state.field(ghostTextState, false);
        if (ghostText && ghostText.suggestion) {
          handlers.onAcceptLine();
          return true;
        }
        return false;
      },
    },
  ]);
};

// ==================== 辅助函数 ====================

/**
 * 设置 Ghost Text
 */
export function setGhostText(
  view: EditorView,
  suggestion: string,
  confidence: number = 0.8
): void {
  const position = view.state.selection.main.head;

  view.dispatch({
    effects: setGhostTextEffect.of({
      suggestion,
      position,
      confidence,
    }),
  });
}

/**
 * 清除 Ghost Text
 */
export function clearGhostText(view: EditorView): void {
  view.dispatch({
    effects: setGhostTextEffect.of(null),
  });
}

/**
 * 接纳 Ghost Text
 */
export function acceptGhostText(view: EditorView): void {
  const ghostText = view.state.field(ghostTextState, false);

  if (!ghostText || !ghostText.suggestion) return;

  view.dispatch({
    changes: {
      from: ghostText.position,
      insert: ghostText.suggestion,
    },
    effects: setGhostTextEffect.of(null),
  });

  // 移动光标到建议末尾
  const newPosition = ghostText.position + ghostText.suggestion.length;
  view.dispatch({
    selection: { anchor: newPosition },
  });

  view.focus();
}

/**
 * 接纳 Ghost Text 的一个词
 */
export function acceptGhostTextWord(view: EditorView): void {
  const ghostText = view.state.field(ghostTextState, false);

  if (!ghostText || !ghostText.suggestion) return;

  // 找到第一个空格或换行符的位置
  const match = ghostText.suggestion.match(/^(\S+\s?)/);
  if (!match) return;

  const word = match[1];
  const remaining = ghostText.suggestion.slice(word.length);

  // 插入一个词
  view.dispatch({
    changes: {
      from: ghostText.position,
      insert: word,
    },
  });

  // 更新 Ghost Text 为剩余部分
  if (remaining) {
    view.dispatch({
      effects: setGhostTextEffect.of({
        suggestion: remaining,
        position: ghostText.position + word.length,
        confidence: ghostText.confidence,
      }),
    });
  } else {
    clearGhostText(view);
  }

  // 移动光标
  const newPosition = ghostText.position + word.length;
  view.dispatch({
    selection: { anchor: newPosition },
  });

  view.focus();
}

/**
 * 接纳 Ghost Text 的一行
 */
export function acceptGhostTextLine(view: EditorView): void {
  const ghostText = view.state.field(ghostTextState, false);

  if (!ghostText || !ghostText.suggestion) return;

  // 找到第一个换行符的位置
  const newlineIndex = ghostText.suggestion.indexOf('\n');

  if (newlineIndex === -1) {
    // 没有换行符，接纳全部
    acceptGhostText(view);
    return;
  }

  const line = ghostText.suggestion.slice(0, newlineIndex + 1);
  const remaining = ghostText.suggestion.slice(newlineIndex + 1);

  // 插入一行
  view.dispatch({
    changes: {
      from: ghostText.position,
      insert: line,
    },
  });

  // 更新 Ghost Text 为剩余部分
  if (remaining) {
    view.dispatch({
      effects: setGhostTextEffect.of({
        suggestion: remaining,
        position: ghostText.position + line.length,
        confidence: ghostText.confidence,
      }),
    });
  } else {
    clearGhostText(view);
  }

  // 移动光标
  const newPosition = ghostText.position + line.length;
  view.dispatch({
    selection: { anchor: newPosition },
  });

  view.focus();
}

/**
 * 完整的 Ghost Text Extension
 */
export function createGhostTextExtension(handlers: GhostTextKeyBindings): Extension[] {
  return [
    ghostTextState,
    ghostTextPlugin,
    createGhostTextKeymap(handlers),
  ];
}
