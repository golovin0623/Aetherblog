import { useCallback, useMemo } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

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
  /** 编辑器内容的字体大小（像素） */
  fontSize?: number;
  /** 用于暴露 CodeMirror EditorView 以供外部控制的 Ref */
  editorViewRef?: React.MutableRefObject<EditorView | null>;
  /** 拖放事件处理 */
  onDrop?: (e: React.DragEvent) => void;
  /** 拖拽进入事件 */
  onDragOver?: (e: React.DragEvent) => void;
  /** 拖拽离开事件 */
  onDragLeave?: (e: React.DragEvent) => void;
  /**粘贴事件处理 */
  onPaste?: (e: React.ClipboardEvent) => void;
  /** 是否正在拖拽文件 */
  isDragging?: boolean;
  /** 编辑器主题 */
  theme?: 'light' | 'dark';
  /** 额外的 CodeMirror Extensions */
  additionalExtensions?: Extension[];
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
  onDrop,
  onDragOver,
  onDragLeave,
  onPaste,
  isDragging = false,
  theme = 'dark',
  additionalExtensions = [],
}: MarkdownEditorProps) {
  // CodeMirror 组件的内部引用
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
      // Markdown 代码块语法高亮
      markdown({ codeLanguages: languages }),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          fontSize: `${fontSize}px`,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          color: theme === 'light' ? '#334155' : '#e2e8f0',
          backgroundColor: theme === 'light' ? '#ffffff' : 'transparent',
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
        // 基线位于文本起始位置（第一个字符的左边缘）
        '.cm-line': {
          padding: '0 4px',
          borderLeft: '1px solid rgba(139, 92, 246, 0.3)',
          marginLeft: '-1px',
        },
        '.cm-gutters': {
          backgroundColor: theme === 'light' ? '#f8fafc' : 'rgba(15, 15, 17, 0.8)',
          borderRight: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.08)',
          paddingLeft: '12px',
          paddingRight: '8px',
          color: theme === 'light' ? '#94a3b8' : 'rgba(255, 255, 255, 0.35)',
          display: showLineNumbers ? 'flex' : 'none', // 如果行号关闭，则隐藏整个装订线
        },
        '.cm-lineNumbers': {
          minWidth: '32px',
        },
        '.cm-lineNumbers .cm-gutterElement': {
          color: 'inherit',
          fontSize: '12px',
          paddingRight: '8px',
          textAlign: 'right',
        },
        '.cm-activeLine': {
          backgroundColor: theme === 'light' ? '#f1f5f9' : 'rgba(255, 255, 255, 0.05)',
        },
        '.cm-selectionBackground': {
          backgroundColor: 'rgba(139, 92, 246, 0.3) !important',
        },
        '&.cm-focused .cm-cursor': {
          borderLeftColor: '#8b5cf6',
        },
        // 代码块样式
        '.ͼb': { // Markdown 代码标记颜色
          color: theme === 'light' ? '#94a3b8' : '#94a3b8',
        },
        '.ͼc': { // 代码块内容
          color: theme === 'light' ? '#475569' : '#e2e8f0',
        },
        // 代码块的语法高亮颜色（明亮模式使用不同颜色）
        '.tok-keyword': { color: theme === 'light' ? '#7c3aed' : '#c792ea' }, // violet-600 对比紫色 (purple)
        '.tok-string': { color: theme === 'light' ? '#16a34a' : '#c3e88d' }, // green-600 对比浅绿色 (light green)
        '.tok-number': { color: theme === 'light' ? '#ea580c' : '#f78c6c' }, // orange-600 对比橙色 (orange)
        '.tok-comment': { color: theme === 'light' ? '#64748b' : '#546e7a', fontStyle: 'italic' }, // slate-500 对比蓝灰色 (blue-grey)
        '.tok-variableName': { color: theme === 'light' ? '#0284c7' : '#82aaff' }, // sky-600 对比蓝色 (blue)
        '.tok-definition': { color: theme === 'light' ? '#0284c7' : '#82aaff' },
        '.tok-propertyName': { color: theme === 'light' ? '#db2777' : '#f07178' }, // pink-600 对比红色 (red)
        '.tok-typeName': { color: theme === 'light' ? '#d97706' : '#ffcb6b' }, // amber-600 对比黄色 (yellow)
        '.tok-operator': { color: theme === 'light' ? '#0ea5e9' : '#89ddff' }, // sky-500 对比青色 (cyan)
        '.tok-punctuation': { color: theme === 'light' ? '#64748b' : '#89ddff' },
        '.tok-function': { color: theme === 'light' ? '#2563eb' : '#82aaff' }, // blue-600 对比蓝色 (blue)
        '.tok-bool': { color: theme === 'light' ? '#dc2626' : '#ff5370' },
        '.tok-null': { color: theme === 'light' ? '#dc2626' : '#ff5370' },
        '.tok-className': { color: theme === 'light' ? '#d97706' : '#ffcb6b' },
        '.tok-labelName': { color: theme === 'light' ? '#ea580c' : '#f78c6c' },
        '.tok-attributeName': { color: theme === 'light' ? '#d97706' : '#ffcb6b' },
        '.tok-attributeValue': { color: theme === 'light' ? '#16a34a' : '#c3e88d' },
        '.tok-tagName': { color: theme === 'light' ? '#db2777' : '#f07178' },
        '.tok-angleBracket': { color: theme === 'light' ? '#64748b' : '#89ddff' },
        '.tok-self': { color: theme === 'light' ? '#db2777' : '#f07178' },
        '.tok-atom': { color: theme === 'light' ? '#ea580c' : '#f78c6c' },
        '.tok-meta': { color: theme === 'light' ? '#d97706' : '#ffcb6b' },
        '.tok-invalid': { color: theme === 'light' ? '#dc2626' : '#ff5370' },
        '.tok-link': { color: theme === 'light' ? '#0284c7' : '#82aaff', textDecoration: 'underline' },
        '.tok-heading': { color: theme === 'light' ? '#7c3aed' : '#c792ea', fontWeight: 'bold' },
        '.tok-emphasis': { fontStyle: 'italic' },
        '.tok-strong': { fontWeight: 'bold' },
        '.tok-strikethrough': { textDecoration: 'line-through' },
      }),
      // 添加外部传入的 Extensions
      ...additionalExtensions,
    ],
    [minHeight, showLineNumbers, contentCentered, fontSize, theme, additionalExtensions]
  );

  return (
    <div
      className={`h-full relative ${!plain ? (theme === 'light' ? 'rounded-lg border border-slate-200 bg-white' : 'rounded-lg border border-white/10 bg-white/5') : ''} ${className}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}>
      <CodeMirror
        ref={cmRef}
        value={value}
        onChange={handleChange}
        extensions={extensions}
        placeholder={placeholder}
        readOnly={readOnly}
        theme={theme === 'light' ? 'light' : 'dark'}
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
        onPaste={onPaste}
      />
      {/*拖拽覆盖层 */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-3 text-primary">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm font-medium">释放以上传图片</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default MarkdownEditor;
