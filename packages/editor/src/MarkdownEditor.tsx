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
      // 顶尖等宽字体栈 —— Geist Mono 优先,其次 JetBrains / SF Mono,最终降级系统 mono
      const monoFont = "'Geist Mono', 'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', 'Fira Code', ui-monospace, monospace";

      // Markdown 文档结构高亮 —— 全部走 CSS 变量,跟随用户主色 + 主题动态解析
      // iA Writer / Bear 哲学:标记符号淡化(opacity 0.4), 正文颜色克制
      const markdownHighlightStyle = HighlightStyle.define([
        // 标题 —— 墨色主色,层级由 CSS 端字号控制
        { tag: tags.heading1, color: 'var(--ink-primary)', fontWeight: '800', fontSize: '1.6em' },
        { tag: tags.heading2, color: 'var(--ink-primary)', fontWeight: '700', fontSize: '1.4em' },
        { tag: tags.heading3, color: 'var(--ink-primary)', fontWeight: '600', fontSize: '1.2em' },
        { tag: tags.heading4, color: 'var(--ink-secondary)', fontWeight: '600', fontSize: '1.1em' },
        { tag: tags.heading5, color: 'var(--ink-secondary)', fontWeight: '600' },
        { tag: tags.heading6, color: 'var(--ink-secondary)', fontWeight: '600' },

        // 强调
        { tag: tags.strong, fontWeight: '700', color: 'var(--ink-primary)' },
        { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--ink-secondary)' },
        { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--ink-muted)' },

        // 链接 —— 跟随主色
        { tag: tags.link, color: 'var(--aurora-1, var(--color-primary))', textDecoration: 'none' },
        { tag: tags.url, color: 'var(--ink-muted)', fontFamily: monoFont },

        // 行内代码 —— aurora 主色 + mono
        { tag: tags.monospace, fontFamily: monoFont, color: 'var(--aurora-1, var(--color-primary))' },

        // 【核心】Markdown 标记符号 —— 极度淡化(Bear/iA Writer 风)
        { tag: tags.processingInstruction, color: 'var(--ink-muted)' },
        { tag: tags.contentSeparator, color: 'var(--ink-muted)' },
        { tag: tags.meta, color: 'var(--ink-muted)' },
        { tag: tags.angleBracket, color: 'var(--ink-muted)' },

        // 引用 —— 墨色次色 + 斜体
        { tag: tags.quote, color: 'var(--ink-secondary)', fontStyle: 'italic' },

        // 列表标记 —— 弱化
        { tag: tags.list, color: 'var(--ink-muted)' },

        // HTML 标签 —— 信号色,mono 字体
        { tag: tags.tagName, color: 'var(--signal-danger)', fontFamily: monoFont },
        { tag: tags.attributeName, color: 'var(--signal-warn)', fontFamily: monoFont },
        { tag: tags.attributeValue, color: 'var(--signal-success)', fontFamily: monoFont },

        // 代码块内语法高亮 —— signal + aurora 混搭,保持代码可读性
        { tag: tags.keyword, color: 'var(--aurora-3, var(--color-primary))' },
        { tag: tags.string, color: 'var(--signal-success)' },
        { tag: tags.number, color: 'var(--signal-warn)' },
        { tag: tags.comment, color: 'var(--ink-muted)', fontStyle: 'italic' },
        { tag: tags.variableName, color: 'var(--signal-info)' },
        { tag: tags.definition(tags.variableName), color: 'var(--signal-info)' },
        { tag: tags.propertyName, color: 'var(--signal-danger)' },
        { tag: tags.typeName, color: 'var(--signal-warn)' },
        { tag: tags.operator, color: 'var(--signal-info)' },
        { tag: tags.punctuation, color: 'var(--ink-muted)' },
        { tag: tags.function(tags.variableName), color: 'var(--aurora-2, var(--color-primary))' },
        { tag: tags.bool, color: 'var(--signal-danger)' },
        { tag: tags.null, color: 'var(--signal-danger)' },
        { tag: tags.className, color: 'var(--signal-warn)' },
        { tag: tags.labelName, color: 'var(--signal-warn)' },
        { tag: tags.self, color: 'var(--signal-danger)' },
        { tag: tags.atom, color: 'var(--signal-warn)' },
        { tag: tags.invalid, color: 'var(--signal-danger)' },
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
          // 极简应用的主文本字体应该是无衬线字体,而非等宽字体(正文仍保留无衬线回退栈)
          fontFamily: 'var(--font-sans, ui-sans-serif), system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          color: 'var(--ink-primary)',
          backgroundColor: theme === 'light' ? 'var(--bg-leaf)' : 'transparent',
          lineHeight: '1.8', // 精致行距 —— iA Writer 级别的呼吸感
        },
        '&.cm-editor': {
          height: '100%',
        },
        '.cm-scroller': {
          overflow: 'auto !important',
          fontFamily: 'inherit',
        },
        '.cm-content': {
          minHeight,
          padding: '16px 24px',
          paddingLeft: '28px',
          maxWidth: contentCentered ? '800px' : 'none',
          margin: contentCentered ? '0 auto' : '0',
          caretColor: 'var(--aurora-1, var(--color-primary))',
        },
        // 基线位于文本起始位置(第一个字符的左边缘)
        '.cm-line': {
          padding: '0 4px',
          borderLeft: '2px solid transparent', // 用于保持对齐,替换原本的实线
          marginLeft: '-2px',
          marginBottom: '0.25em', // 段落间距感
        },
        // 代码块整体基础字体
        '.cm-content .ͼc': { // 代码块内容默认使用等宽字体
          fontFamily: monoFont,
        },
        // 光标 —— aurora 主色,加粗至 2px,易见
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: 'var(--aurora-1, var(--color-primary))',
          borderLeftWidth: '2px',
        },
        '&.cm-focused .cm-cursor': {
          borderLeftColor: 'var(--aurora-1, var(--color-primary))',
          borderLeftWidth: '2px',
        },
        // 选区 —— aurora 半透明,聚焦/失焦双层级
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
          backgroundColor: 'color-mix(in oklch, var(--aurora-1, var(--color-primary)) 22%, transparent) !important',
        },
        '&:not(.cm-focused) .cm-selectionLayer .cm-selectionBackground, &:not(.cm-focused) .cm-content ::selection': {
          backgroundColor: 'color-mix(in oklch, var(--aurora-1, var(--color-primary)) 14%, transparent) !important',
        },
        // 活动行 —— iA Writer 风:极淡 aurora 底
        '.cm-activeLine': {
          backgroundColor: 'color-mix(in oklch, var(--aurora-1, var(--color-primary)) 4%, transparent)',
        },
        // Gutter(行号槽)—— 透明底,mono 字体
        '.cm-gutters': {
          backgroundColor: 'transparent',
          borderRight: 'none',
          paddingLeft: '12px',
          paddingRight: '8px',
          color: 'var(--ink-muted)',
          fontFamily: monoFont,
          fontSize: '12px',
          opacity: 0.55,
          display: showLineNumbers ? 'flex' : 'none',
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
        // 活动行行号 —— aurora 高亮
        '.cm-activeLineGutter': {
          backgroundColor: 'transparent',
          color: 'var(--aurora-1, var(--color-primary))',
          opacity: 1,
        },
        // 匹配括号 —— aurora 低饱和背景 + 描边
        '.cm-matchingBracket, .cm-nonmatchingBracket': {
          backgroundColor: 'color-mix(in oklch, var(--aurora-1, var(--color-primary)) 15%, transparent)',
          outline: '1px solid color-mix(in oklch, var(--aurora-1, var(--color-primary)) 40%, transparent)',
          borderRadius: '2px',
        },
        // 搜索匹配 —— 信号警告色
        '.cm-searchMatch': {
          backgroundColor: 'color-mix(in oklch, var(--signal-warn) 25%, transparent)',
        },
        '.cm-searchMatch.cm-searchMatch-selected': {
          backgroundColor: 'color-mix(in oklch, var(--signal-warn) 45%, transparent)',
        },
        // 滚动条(webkit)—— 精致细滚动条
        '.cm-scroller::-webkit-scrollbar': { width: '8px', height: '8px' },
        '.cm-scroller::-webkit-scrollbar-track': { background: 'transparent' },
        '.cm-scroller::-webkit-scrollbar-thumb': {
          background: 'color-mix(in oklch, var(--ink-muted) 30%, transparent)',
          borderRadius: '4px',
        },
        '.cm-scroller::-webkit-scrollbar-thumb:hover': {
          background: 'color-mix(in oklch, var(--ink-muted) 50%, transparent)',
        },
        // 折叠 gutter / line fold
        '.cm-foldGutter .cm-gutterElement': { color: 'var(--ink-muted)' },
        // 代码块样式(旧 hash class 兼容)
        '.ͼb': { color: 'var(--ink-muted)' },
        '.ͼc': { color: 'var(--ink-primary)' },
      }, { dark: theme === 'dark' }),
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
