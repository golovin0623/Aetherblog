import { useCallback, useMemo } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  maxHeight?: string;
  className?: string;
  readOnly?: boolean;
  plain?: boolean;
  style?: React.CSSProperties;
  showLineNumbers?: boolean;
  contentCentered?: boolean;
  /** Font size in pixels for the editor content */
  fontSize?: number;
  /** Ref to expose the CodeMirror EditorView for external control */
  editorViewRef?: React.MutableRefObject<EditorView | null>;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = '开始写作...',
  minHeight = '400px',
  className = '',
  readOnly = false,
  plain = false,
  style,
  showLineNumbers = false,
  contentCentered = false,
  fontSize = 16,
  editorViewRef,
}: MarkdownEditorProps) {
  // Internal ref for CodeMirror component
  const cmRef = useCallback((ref: ReactCodeMirrorRef | null) => {
    if (editorViewRef && ref?.view) {
      editorViewRef.current = ref.view;
    }
  }, [editorViewRef]);
  const handleChange = useCallback(
    (val: string) => {
      onChange(val);
    },
    [onChange]
  );

  const extensions = useMemo(
    () => [
      // Markdown with code block syntax highlighting
      markdown({ codeLanguages: languages }),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          fontSize: `${fontSize}px`,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        },
        '&.cm-editor': {
          height: '100%',
        },
        '.cm-scroller': {
          overflow: 'auto !important',
        },
        '.cm-content': {
          minHeight,
          padding: '24px',
          paddingLeft: '28px',
          maxWidth: contentCentered ? '800px' : 'none',
          margin: contentCentered ? '0 auto' : '0',
        },
        // Baseline at text start position (left edge of first character)
        '.cm-line': {
          padding: '0 4px',
          borderLeft: '1px solid rgba(139, 92, 246, 0.3)',
          marginLeft: '-1px',
        },
        '.cm-gutters': {
          backgroundColor: 'rgba(15, 15, 17, 0.8)',
          borderRight: '1px solid rgba(255, 255, 255, 0.08)',
          paddingLeft: '12px',
          paddingRight: '8px',
          display: showLineNumbers ? 'flex' : 'none', // Hide entire gutter if line numbers are off
        },
        '.cm-lineNumbers': {
          minWidth: '32px',
        },
        '.cm-lineNumbers .cm-gutterElement': {
          color: 'rgba(255, 255, 255, 0.35)',
          fontSize: '12px',
          paddingRight: '8px',
          textAlign: 'right',
        },
        '.cm-activeLine': {
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
        },
        '.cm-selectionBackground': {
          backgroundColor: 'rgba(139, 92, 246, 0.3) !important',
        },
        '&.cm-focused .cm-cursor': {
          borderLeftColor: '#8b5cf6',
        },
        // Style for fenced code blocks
        '.ͼb': { // Markdown code marker color
          color: '#94a3b8',
        },
        '.ͼc': { // Code block content
          color: '#e2e8f0',
        },
        // Syntax highlighting colors for code blocks
        '.tok-keyword': { color: '#c792ea' },
        '.tok-string': { color: '#c3e88d' },
        '.tok-number': { color: '#f78c6c' },
        '.tok-comment': { color: '#546e7a', fontStyle: 'italic' },
        '.tok-variableName': { color: '#82aaff' },
        '.tok-definition': { color: '#82aaff' },
        '.tok-propertyName': { color: '#f07178' },
        '.tok-typeName': { color: '#ffcb6b' },
        '.tok-operator': { color: '#89ddff' },
        '.tok-punctuation': { color: '#89ddff' },
        '.tok-function': { color: '#82aaff' },
        '.tok-bool': { color: '#ff5370' },
        '.tok-null': { color: '#ff5370' },
        '.tok-className': { color: '#ffcb6b' },
        '.tok-labelName': { color: '#f78c6c' },
        '.tok-attributeName': { color: '#ffcb6b' },
        '.tok-attributeValue': { color: '#c3e88d' },
        '.tok-tagName': { color: '#f07178' },
        '.tok-angleBracket': { color: '#89ddff' },
        '.tok-self': { color: '#f07178' },
        '.tok-atom': { color: '#f78c6c' },
        '.tok-meta': { color: '#ffcb6b' },
        '.tok-invalid': { color: '#ff5370' },
        '.tok-link': { color: '#82aaff', textDecoration: 'underline' },
        '.tok-heading': { color: '#c792ea', fontWeight: 'bold' },
        '.tok-emphasis': { fontStyle: 'italic' },
        '.tok-strong': { fontWeight: 'bold' },
        '.tok-strikethrough': { textDecoration: 'line-through' },
      }),
    ],
    [minHeight, showLineNumbers, contentCentered, fontSize]
  );

  return (
    <div className={`h-full ${!plain ? 'rounded-lg border border-white/10 bg-white/5' : ''} ${className}`}>
      <CodeMirror
        ref={cmRef}
        value={value}
        onChange={handleChange}
        extensions={extensions}
        placeholder={placeholder}
        readOnly={readOnly}
        theme="dark"
        height="100%"
        style={{ height: '100%', ...style }}
        basicSetup={{
          lineNumbers: showLineNumbers,
          highlightActiveLineGutter: showLineNumbers,
          highlightActiveLine: true,
          foldGutter: showLineNumbers,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
        }}
      />
    </div>
  );
}

export default MarkdownEditor;
