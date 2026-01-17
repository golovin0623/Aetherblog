/**
 * @file useEditorCommands.ts
 * @description 用于在 CodeMirror 编辑器中以编程方式操作文本的 Hook
 * @ref §3.2.3 - 编辑器包开发
 */

import { useCallback } from 'react';
import { EditorView } from '@codemirror/view';
import { undo as cmUndo, redo as cmRedo } from '@codemirror/commands';

/**
 * 验证 URL 是否安全
 * 只允许 http/https 协议，防止 javascript: 等危险协议
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'data:'].includes(parsed.protocol);
  } catch {
    // 相对路径也允许
    return url.startsWith('/') || url.startsWith('./') || url.startsWith('../');
  }
}

/**图片信息 */
export interface ImageInfo {
  from: number;
  to: number;
  url: string;
  alt: string;
  size?: string; // 如"50%" 或 "200px"
}

export interface EditorCommands {
  /** 在当前光标位置插入文本 */
  insertText: (text: string) => void;
  /** 用前缀和后缀包裹选中的文本，如果没有选中则在光标处同时插入两者 */
  wrapSelection: (prefix: string, suffix: string) => void;
  /** 切换包裹：如果选中项已有前缀/后缀则移除，否则添加 */
  toggleWrap: (prefix: string, suffix: string) => void;
  /** 在当前行开头插入前缀 */
  insertAtLineStart: (prefix: string) => void;
  /** 切换行首前缀：如果行以前缀开头则移除，否则添加 */
  toggleLineStart: (prefix: string) => void;
  /** 获取当前选中的文本 */
  getSelection: () => string;
  /** 聚焦编辑器 */
  focus: () => void;
  /** 撤销最后的更改 */
  undo: () => void;
  /** 重做最后撤销的更改 */
  redo: () => void;
  /** 在光标位置插入图片 markdown */
  insertImage: (url: string, alt?: string, size?: string) => void;
  /** 更新指定位置的图片大小 */
  updateImageSize: (imageInfo: ImageInfo, newSize: string | null) => void;
  /** 查找当前光标位置的图片 */
  getImageAtCursor: () => ImageInfo | null;
  /** 获取当前光标位置 */
  getCursorPosition: () => number;
}

/**
 * Hook that provides programmatic text manipulation commands for CodeMirror.
 * 
 * @param editorViewRef - React ref containing the CodeMirror EditorView instance
 * @returns EditorCommands object with text manipulation methods
 * 
 * @example
 * const editorViewRef = useRef<EditorView | null>(null);
 * const commands = useEditorCommands(editorViewRef);
 * 
 * // 切换选中项的粗体
 * commands.toggleWrap('**', '**');
 * 
 * // 在行首插入标题
 * commands.insertAtLineStart('# ');
 */
export function useEditorCommands(
  editorViewRef: React.RefObject<EditorView | null>
): EditorCommands {
  
  const insertText = useCallback((text: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    
    const { from } = view.state.selection.main;
    view.dispatch({
      changes: { from, to: from, insert: text },
      selection: { anchor: from + text.length },
    });
  }, [editorViewRef]);

  const wrapSelection = useCallback((prefix: string, suffix: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    
    const { from, to } = view.state.selection.main;
    const selectedText = view.state.sliceDoc(from, to);
    
    const newText = prefix + selectedText + suffix;
    
    view.dispatch({
      changes: { from, to, insert: newText },
      // 如果没有选中，将光标放在前缀之后，或者选中包裹的文本
      selection: selectedText
        ? { anchor: from + prefix.length, head: from + prefix.length + selectedText.length }
        : { anchor: from + prefix.length },
    });
  }, [editorViewRef]);

  const toggleWrap = useCallback((prefix: string, suffix: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    
    const { from, to } = view.state.selection.main;
    const selectedText = view.state.sliceDoc(from, to);
    
    // 检查选中项是否已被包裹（查看周围的文本）
    const beforeStart = Math.max(0, from - prefix.length);
    const afterEnd = Math.min(view.state.doc.length, to + suffix.length);
    
    const textBefore = view.state.sliceDoc(beforeStart, from);
    const textAfter = view.state.sliceDoc(to, afterEnd);
    
    // 如果已被包裹，移除包裹
    if (textBefore === prefix && textAfter === suffix) {
      view.dispatch({
        changes: [
          { from: beforeStart, to: from, insert: '' },
          { from: to, to: afterEnd, insert: '' },
        ],
        selection: { anchor: beforeStart, head: beforeStart + selectedText.length },
      });
    } else if (selectedText.startsWith(prefix) && selectedText.endsWith(suffix) && selectedText.length >= prefix.length + suffix.length) {
      // 如果选中项本身包含标记，则解包
      const unwrapped = selectedText.slice(prefix.length, selectedText.length - suffix.length);
      view.dispatch({
        changes: { from, to, insert: unwrapped },
        selection: { anchor: from, head: from + unwrapped.length },
      });
    } else {
      // 未包裹，添加包裹
      const newText = prefix + selectedText + suffix;
      view.dispatch({
        changes: { from, to, insert: newText },
        selection: selectedText
          ? { anchor: from + prefix.length, head: from + prefix.length + selectedText.length }
          : { anchor: from + prefix.length },
      });
    }
  }, [editorViewRef]);

  const insertAtLineStart = useCallback((prefix: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const lineStart = line.from;
    
    view.dispatch({
      changes: { from: lineStart, to: lineStart, insert: prefix },
      selection: { anchor: from + prefix.length },
    });
  }, [editorViewRef]);

  const toggleLineStart = useCallback((prefix: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const lineStart = line.from;
    const lineText = line.text;
    
    // 检查行是否已以前缀开头
    if (lineText.startsWith(prefix)) {
      // 移除前缀
      view.dispatch({
        changes: { from: lineStart, to: lineStart + prefix.length, insert: '' },
        selection: { anchor: Math.max(lineStart, from - prefix.length) },
      });
    } else {
      // 添加前缀
      view.dispatch({
        changes: { from: lineStart, to: lineStart, insert: prefix },
        selection: { anchor: from + prefix.length },
      });
    }
  }, [editorViewRef]);

  const getSelection = useCallback((): string => {
    const view = editorViewRef.current;
    if (!view) return '';
    
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  }, [editorViewRef]);

  const focus = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    view.focus();
  }, [editorViewRef]);

  const undo = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    cmUndo(view);
  }, [editorViewRef]);

  const redo = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    cmRedo(view);
  }, [editorViewRef]);

  /**
   * 插入图片 Markdown
   * 支持带大小参数的语法: ![alt|size](url)
   */
  const insertImage = useCallback((url: string, alt: string = '', size?: string) => {
    const view = editorViewRef.current;
    if (!view) return;

    // 验证 URL 安全性
    if (!isValidUrl(url)) {
      console.warn('[Editor] Invalid or unsafe URL:', url);
      return;
    }

    // 构建图片 Markdown
    // 使用自定义语法: ![alt|size](url)
    // 如: ![图片|50%](http://example.com/image.png)
    let markdown: string;
    if (size) {
      markdown = `![${alt}|${size}](${url})`;
    } else {
      markdown = `![${alt}](${url})`;
    }

    const { from } = view.state.selection.main;
    view.dispatch({
      changes: { from, to: from, insert: markdown },
      selection: { anchor: from + markdown.length },
    });
  }, [editorViewRef]);

  /**
   * 更新图片大小
   * 修改已有图片的大小参数
   */
  const updateImageSize = useCallback((imageInfo: ImageInfo, newSize: string | null) => {
    const view = editorViewRef.current;
    if (!view) return;

    const { from, to, url, alt } = imageInfo;
    
    // 构建新的图片 Markdown
    let newMarkdown: string;
    if (newSize) {
      newMarkdown = `![${alt}|${newSize}](${url})`;
    } else {
      newMarkdown = `![${alt}](${url})`;
    }
    
    view.dispatch({
      changes: { from, to, insert: newMarkdown },
    });
  }, [editorViewRef]);

  /**
   * 获取光标位置的图片信息
   * 解析 ![alt|size](url) 格式
   */
  const getImageAtCursor = useCallback((): ImageInfo | null => {
    const view = editorViewRef.current;
    if (!view) return null;

    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const lineText = line.text;
    
    //匹配图片语法: ![alt|size?](url)
    const imageRegex = /!\[([^\]|]*?)(?:\|([^\]]*?))?\]\(([^)]+)\)/g;
    
    let match;
    while ((match = imageRegex.exec(lineText)) !== null) {
      const matchStart = line.from + match.index;
      const matchEnd = matchStart + match[0].length;
      
      // 检查光标是否在这个图片范围内
      if (from >= matchStart && from <= matchEnd) {
        return {
          from: matchStart,
          to: matchEnd,
          alt: match[1] || '',
          size: match[2] || undefined,
          url: match[3],
        };
      }
    }
    
    return null;
  }, [editorViewRef]);

  /**
   * 获取当前光标位置
   */
  const getCursorPosition = useCallback((): number => {
    const view = editorViewRef.current;
    if (!view) return 0;
    return view.state.selection.main.from;
  }, [editorViewRef]);

  return {
    insertText,
    wrapSelection,
    toggleWrap,
    insertAtLineStart,
    toggleLineStart,
    getSelection,
    focus,
    undo,
    redo,
    insertImage,
    updateImageSize,
    getImageAtCursor,
    getCursorPosition,
  };
}

export default useEditorCommands;
