import { useCallback, useMemo } from 'react';
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
  plain?: boolean;
  style?: React.CSSProperties;
  showLineNumbers?: boolean;
  contentCentered?: boolean;
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
        '&.cm-editor': {
          height: '100%',
        },
        '.cm-scroller': {
          overflow: 'auto !important',
        },
        '.cm-content': {
          minHeight,
          padding: '24px',
          maxWidth: contentCentered ? '800px' : 'none',
          margin: contentCentered ? '0 auto' : '0',
        },
        '.cm-gutters': {
          backgroundColor: 'transparent',
          border: 'none',
          paddingLeft: '12px',
          display: showLineNumbers ? 'flex' : 'none', // Hide entire gutter if line numbers are off
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
    [minHeight, showLineNumbers, contentCentered]
  );

  return (
    <div className={`h-full ${!plain ? 'rounded-lg border border-white/10 bg-white/5' : ''} ${className}`}>
      <CodeMirror
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
