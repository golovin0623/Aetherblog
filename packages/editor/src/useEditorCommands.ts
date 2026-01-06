/**
 * @file useEditorCommands.ts
 * @description Hook for programmatic text manipulation in CodeMirror editor
 * @ref §3.2.3 - Editor Package Development
 */

import { useCallback } from 'react';
import { EditorView } from '@codemirror/view';
import { undo as cmUndo, redo as cmRedo } from '@codemirror/commands';

export interface EditorCommands {
  /** Insert text at current cursor position */
  insertText: (text: string) => void;
  /** Wrap selected text with prefix and suffix, or insert both at cursor if no selection */
  wrapSelection: (prefix: string, suffix: string) => void;
  /** Toggle wrap: if selection already has prefix/suffix, remove them; otherwise add them */
  toggleWrap: (prefix: string, suffix: string) => void;
  /** Insert prefix at the beginning of the current line */
  insertAtLineStart: (prefix: string) => void;
  /** Toggle line start prefix: if line starts with prefix, remove it; otherwise add it */
  toggleLineStart: (prefix: string) => void;
  /** Get the currently selected text */
  getSelection: () => string;
  /** Focus the editor */
  focus: () => void;
  /** Undo the last change */
  undo: () => void;
  /** Redo the last undone change */
  redo: () => void;
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
 * // Toggle bold on selection
 * commands.toggleWrap('**', '**');
 * 
 * // Insert heading at line start
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
      // Place cursor after prefix if no selection, or select the wrapped text
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
    
    // Check if selection is already wrapped (look at surrounding text)
    const beforeStart = Math.max(0, from - prefix.length);
    const afterEnd = Math.min(view.state.doc.length, to + suffix.length);
    
    const textBefore = view.state.sliceDoc(beforeStart, from);
    const textAfter = view.state.sliceDoc(to, afterEnd);
    
    // If already wrapped, remove the wrapping
    if (textBefore === prefix && textAfter === suffix) {
      view.dispatch({
        changes: [
          { from: beforeStart, to: from, insert: '' },
          { from: to, to: afterEnd, insert: '' },
        ],
        selection: { anchor: beforeStart, head: beforeStart + selectedText.length },
      });
    } else if (selectedText.startsWith(prefix) && selectedText.endsWith(suffix) && selectedText.length >= prefix.length + suffix.length) {
      // If the selection itself contains the markers, unwrap
      const unwrapped = selectedText.slice(prefix.length, selectedText.length - suffix.length);
      view.dispatch({
        changes: { from, to, insert: unwrapped },
        selection: { anchor: from, head: from + unwrapped.length },
      });
    } else {
      // Not wrapped, add wrapping
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
    
    // Check if line already starts with prefix
    if (lineText.startsWith(prefix)) {
      // Remove prefix
      view.dispatch({
        changes: { from: lineStart, to: lineStart + prefix.length, insert: '' },
        selection: { anchor: Math.max(lineStart, from - prefix.length) },
      });
    } else {
      // Add prefix
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
  };
}

export default useEditorCommands;
