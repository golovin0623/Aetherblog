import { useCallback, useMemo } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { createBearDecorations } from './bearDecorations';

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
  /** 启用 Bear 风格 WYSIWYG 模式（隐藏非活跃行的 Markdown 标记） */
  bearMode?: boolean;
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
  bearMode = false,
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
    () => {
      const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      
      // Markdown 文档结构高亮（Bear / Typora 风格的极简优雅设计）
      const markdownHighlightStyle = HighlightStyle.define([
        // 标题 - 摒弃彩色，使用不同字号 + 极度加粗 + 主文本色，突出层级
        { tag: tags.heading1, color: theme === 'light' ? '#0f172a' : '#f8fafc', fontWeight: '800', fontSize: '1.6em' },
        { tag: tags.heading2, color: theme === 'light' ? '#0f172a' : '#f8fafc', fontWeight: '700', fontSize: '1.4em' },
        { tag: tags.heading3, color: theme === 'light' ? '#1e293b' : '#f1f5f9', fontWeight: '600', fontSize: '1.2em' },
        { tag: tags.heading4, color: theme === 'light' ? '#1e293b' : '#f1f5f9', fontWeight: '600', fontSize: '1.1em' },
        { tag: tags.heading5, color: theme === 'light' ? '#334155' : '#e2e8f0', fontWeight: '600' },
        { tag: tags.heading6, color: theme === 'light' ? '#475569' : '#cbd5e1', fontWeight: '600' },
        
        // 强调
        { tag: tags.strong, fontWeight: '700', color: theme === 'light' ? '#0f172a' : '#f8fafc' },
        { tag: tags.emphasis, fontStyle: 'italic', color: theme === 'light' ? '#334155' : '#cbd5e1' },
        { tag: tags.strikethrough, textDecoration: 'line-through', color: theme === 'light' ? '#94a3b8' : '#64748b' },
        
        // 链接 - 柔和的 Apple Blue
        { tag: tags.link, color: theme === 'light' ? '#007AFF' : '#0A84FF', textDecoration: 'none' },
        { tag: tags.url, color: theme === 'light' ? '#94a3b8' : '#64748b', fontFamily: monoFont },
        
        // 行内代码 - 专属等宽字体，去掉背景色避免在代码块内每行换行产生破坏性盒子
        { tag: tags.monospace, fontFamily: monoFont, color: theme === 'light' ? '#ea580c' : '#fb923c' },
        
        // 【核心优化】Markdown 标记符号（#, *, >, -, ` 等）极度弱化，让位于正文
        { tag: tags.processingInstruction, color: theme === 'light' ? '#cbd5e1' : '#475569' }, // ``` 代码块标记
        { tag: tags.contentSeparator, color: theme === 'light' ? '#cbd5e1' : '#475569' }, // #, *, -, > 等符号
        { tag: tags.meta, color: theme === 'light' ? '#cbd5e1' : '#475569' }, // [ ] 等
        { tag: tags.angleBracket, color: theme === 'light' ? '#cbd5e1' : '#475569' }, // < >
        
        // 引用 - 柔和色彩 + 斜体
        { tag: tags.quote, color: theme === 'light' ? '#64748b' : '#94a3b8', fontStyle: 'italic' },
        
        // 列表标记 - 稍微弱化
        { tag: tags.list, color: theme === 'light' ? '#94a3b8' : '#64748b' },
        
        // HTML 标签 - 略微等宽
        { tag: tags.tagName, color: theme === 'light' ? '#db2777' : '#f07178', fontFamily: monoFont },
        { tag: tags.attributeName, color: theme === 'light' ? '#d97706' : '#ffcb6b', fontFamily: monoFont },
        { tag: tags.attributeValue, color: theme === 'light' ? '#16a34a' : '#c3e88d', fontFamily: monoFont },
        
        // 代码块内的语法高亮 - 去除冗余的 fontFamily，因为 .cm-content .ͼc 已全局设置
        { tag: tags.keyword, color: theme === 'light' ? '#7c3aed' : '#c792ea' },
        { tag: tags.string, color: theme === 'light' ? '#16a34a' : '#c3e88d' },
        { tag: tags.number, color: theme === 'light' ? '#ea580c' : '#f78c6c' },
        { tag: tags.comment, color: theme === 'light' ? '#94a3b8' : '#64748b', fontStyle: 'italic' },
        { tag: tags.variableName, color: theme === 'light' ? '#0284c7' : '#82aaff' },
        { tag: tags.definition(tags.variableName), color: theme === 'light' ? '#0284c7' : '#82aaff' },
        { tag: tags.propertyName, color: theme === 'light' ? '#db2777' : '#f07178' },
        { tag: tags.typeName, color: theme === 'light' ? '#d97706' : '#ffcb6b' },
        { tag: tags.operator, color: theme === 'light' ? '#0ea5e9' : '#89ddff' },
        { tag: tags.punctuation, color: theme === 'light' ? '#94a3b8' : '#64748b' },
        { tag: tags.function(tags.variableName), color: theme === 'light' ? '#2563eb' : '#82aaff' },
        { tag: tags.bool, color: theme === 'light' ? '#dc2626' : '#ff5370' },
        { tag: tags.null, color: theme === 'light' ? '#dc2626' : '#ff5370' },
        { tag: tags.className, color: theme === 'light' ? '#d97706' : '#ffcb6b' },
        { tag: tags.labelName, color: theme === 'light' ? '#ea580c' : '#f78c6c' },
        { tag: tags.self, color: theme === 'light' ? '#db2777' : '#f07178' },
        { tag: tags.atom, color: theme === 'light' ? '#ea580c' : '#f78c6c' },
        { tag: tags.invalid, color: theme === 'light' ? '#dc2626' : '#ff5370' },
      ]);

      return [
      // Markdown 语法高亮（必须在最前面以获得最高优先级）
      syntaxHighlighting(markdownHighlightStyle),
      // Markdown 代码块语法高亮
      markdown({ codeLanguages: languages }),
      EditorView.lineWrapping,
      // Bear 风格 WYSIWYG 装饰器（隐藏标记、代码块背景等）
      ...(bearMode ? createBearDecorations(theme) : []),
      // 选区在失焦（例如 AI 面板打开）时也保持可见，避免默认样式降级过深
      EditorView.theme({
        '&.cm-editor': {
          '--ab-selection-focused': theme === 'light' ? 'rgba(99, 102, 241, 0.32)' : 'rgba(139, 92, 246, 0.36)',
          '--ab-selection-blurred': theme === 'light' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(139, 92, 246, 0.24)',
        },
        '.cm-selectionLayer .cm-selectionBackground, .cm-content ::selection': {
          backgroundColor: 'var(--ab-selection-focused) !important',
        },
        '&:not(.cm-focused) .cm-selectionLayer .cm-selectionBackground, &:not(.cm-focused) .cm-content ::selection': {
          backgroundColor: 'var(--ab-selection-blurred) !important',
        },
        '&.cm-focused .cm-selectionLayer .cm-selectionBackground, &.cm-focused .cm-content ::selection': {
          backgroundColor: 'var(--ab-selection-focused) !important',
        },
      }),
      EditorView.theme({
        '&': {
          fontSize: `${fontSize}px`,
          // 极简应用的主文本字体应该是无衬线字体，而非等宽字体
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          color: theme === 'light' ? '#334155' : '#e2e8f0',
          backgroundColor: theme === 'light' ? '#ffffff' : 'transparent',
          lineHeight: '1.7', // 提升行高，更适合阅读
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
          borderLeft: '2px solid transparent', // 用于保持对齐，替换原本的实线
          marginLeft: '-2px',
          marginBottom: '0.25em', // 段落间距感
        },
        // 代码块整体基础字体
        '.cm-content .ͼc': { // 代码块内容默认使用等宽字体
          fontFamily: monoFont,
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
          backgroundColor: 'var(--ab-selection-focused) !important',
        },
        '.cm-selectionLayer .cm-selectionBackground': {
          backgroundColor: 'var(--ab-selection-focused) !important',
        },
        '.cm-content ::selection': {
          backgroundColor: 'var(--ab-selection-focused) !important',
          color: 'inherit',
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
      }),
      // 添加外部传入的 Extensions
      ...additionalExtensions,
    ];},
    [minHeight, showLineNumbers, contentCentered, fontSize, theme, additionalExtensions, bearMode]
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
