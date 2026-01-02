import React, { useCallback, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  maxHeight?: string;
  className?: string;
  readOnly?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = '开始写作...',
  minHeight = '400px',
  maxHeight = '100%',
  className = '',
  readOnly = false,
}: MarkdownEditorProps) {
  const handleChange = useCallback(
    (val: string) => {
      onChange(val);
    },
    [onChange]
  );

  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          fontSize: '16px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        },
        '.cm-content': {
          minHeight,
          padding: '16px',
        },
        '.cm-gutters': {
          backgroundColor: 'transparent',
          border: 'none',
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
      }),
    ],
    [minHeight]
  );

  return (
    <div className={`rounded-lg overflow-hidden border border-white/10 bg-white/5 ${className}`}>
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        placeholder={placeholder}
        readOnly={readOnly}
        theme="dark"
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: true,
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
