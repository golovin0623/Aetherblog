import { useState, useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownPreview, markdownPreviewStyles } from './MarkdownPreview';
import { Edit, Eye, Columns } from 'lucide-react';

export type ViewMode = 'edit' | 'preview' | 'split';

export interface EditorWithPreviewProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** 外部视图模式控制（受控组件） */
  viewMode?: ViewMode;
  /** 视图模式更改时的回调（仅用于外部 viewMode） */
  onViewModeChange?: (mode: ViewMode) => void;
  /** 隐藏内部工具栏（在提供外部控制时使用） */
  hideToolbar?: boolean;
  /** 在分屏模式下同步编辑器和预览之间的滚动 */
  isSyncScroll?: boolean;
  /** 基础字体大小（px）（未提供 editorFontSize/previewFontSize 时使用） */
  fontSize?: number;
  /** 编辑器字体大小（px）（覆盖编辑器的 fontSize） */
  editorFontSize?: number;
  /** 预览字体大小（px）（覆盖预览的 fontSize） */
  previewFontSize?: number;
  /** 是否在编辑器中显示行号 */
  showLineNumbers?: boolean;
  /** 用于暴露 CodeMirror EditorView 以供外部控制（工具栏命令）的 Ref */
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
}

export function EditorWithPreview({
  value,
  onChange,
  className = '',
  viewMode: externalViewMode,
  onViewModeChange,
  hideToolbar = false,
  isSyncScroll = false,
  fontSize = 14,
  editorFontSize,
  previewFontSize,
  showLineNumbers = false,
  editorViewRef,
  onDrop,
  onDragOver,
  onDragLeave,
  onPaste,
  isDragging = false,
  theme = 'dark',
}: EditorWithPreviewProps) {
  // 解析实际字体大小（个别覆盖基础）
  const actualEditorFontSize = editorFontSize ?? fontSize;
  const actualPreviewFontSize = previewFontSize ?? fontSize;
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>('split');
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);
  
  // 如果提供则使用外部视图模式，否则使用内部状态
  const viewMode = externalViewMode ?? internalViewMode;
  const setViewMode = onViewModeChange ?? setInternalViewMode;

  // 注入 Markdown 预览样式
  useEffect(() => {
    const styleId = 'markdown-preview-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = markdownPreviewStyles;
      document.head.appendChild(style);
    }
  }, []);

  // 同步滚动逻辑 - 使用基于行的同步以提高准确性
  useEffect(() => {
    if (!isSyncScroll || viewMode !== 'split') return;

    const editorContainer = editorScrollRef.current;
    const previewEl = previewScrollRef.current;
    if (!editorContainer || !previewEl) return;

    // 使用 RAF 确保 CodeMirror 已渲染
    const rafId = requestAnimationFrame(() => {
      // 查找 CodeMirror 的内部滚动容器和行元素
      const editorEl = editorContainer.querySelector('.cm-scroller') as HTMLElement | null;
      const cmContent = editorContainer.querySelector('.cm-content') as HTMLElement | null;
      if (!editorEl || !cmContent) return;

      // 获取编辑器中当前顶部可见的行
      const getEditorTopLine = (): number => {
        const scrollTop = editorEl.scrollTop;
        const paddingTop = parseFloat(getComputedStyle(cmContent).paddingTop) || 0;
        
        // 从第一行可见行动态测量行高
        const firstLine = cmContent.querySelector('.cm-line');
        // 如果未找到行，则默认为 fontSize * 1.5（1.5 是标准行高）
        const lineHeight = firstLine ? firstLine.clientHeight : (fontSize || 16) * 1.5;
        
        if (!lineHeight) return 1;

        // 根据滚动位置计算行号
        // 减去内边距以获取内容滚动位置
        const contentScrollTop = Math.max(0, scrollTop - paddingTop);
        return Math.floor(contentScrollTop / lineHeight) + 1;
      };

      // 在预览中查找具有 data-source-line 的最近元素
      const scrollPreviewToLine = (lineNum: number): void => {
        // 查找具有 data-source-line 属性的元素
        const elements = previewEl.querySelectorAll('[data-source-line]');
        let closestElement: HTMLElement | null = null;
        let closestLine = 0;

        elements.forEach(el => {
          const sourceLine = parseInt(el.getAttribute('data-source-line') || '0', 10);
          if (sourceLine > 0 && sourceLine <= lineNum && sourceLine > closestLine) {
            closestLine = sourceLine;
            closestElement = el as HTMLElement;
          }
        });

        if (closestElement !== null) {
          // 计算偏移位置
          const elementTop = (closestElement as HTMLElement).offsetTop;
          const lineDiff = lineNum - closestLine;
          // 计算动态行高
          const firstLine = cmContent.querySelector('.cm-line');
          const lineHeight = firstLine ? firstLine.clientHeight : (fontSize || 16) * 1.5;

          // 根据行差估计额外滚动
          const additionalScroll = lineDiff * lineHeight;
          
          previewEl.scrollTop = Math.max(0, elementTop + additionalScroll - 50);
        } else {
          // 回退到基于百分比的同步
          const editorScrollable = editorEl.scrollHeight - editorEl.clientHeight;
          const previewScrollable = previewEl.scrollHeight - previewEl.clientHeight;
          if (editorScrollable > 0 && previewScrollable > 0) {
            const scrollPercentage = editorEl.scrollTop / editorScrollable;
            previewEl.scrollTop = scrollPercentage * previewScrollable;
          }
        }
      };

      // 从预览滚动同步编辑器
      const scrollEditorToPreviewPosition = (): void => {
        const previewScrollable = previewEl.scrollHeight - previewEl.clientHeight;
        if (previewScrollable <= 0) return;
        
        const scrollPercentage = previewEl.scrollTop / previewScrollable;
        const editorScrollable = editorEl.scrollHeight - editorEl.clientHeight;
        editorEl.scrollTop = scrollPercentage * editorScrollable;
      };

      // 注意：我们特意不立即在启用时同步
      // 这可以防止在 TOC 导航后恢复同步时出现位置跳跃

      const handleEditorScroll = () => {
        if (isSyncingRef.current) return;
        isSyncingRef.current = true;
        
        scrollPreviewToLine(getEditorTopLine());
        
        requestAnimationFrame(() => {
          isSyncingRef.current = false;
        });
      };

      const handlePreviewScroll = () => {
        if (isSyncingRef.current) return;
        isSyncingRef.current = true;
        
        scrollEditorToPreviewPosition();
        
        requestAnimationFrame(() => {
          isSyncingRef.current = false;
        });
      };

      editorEl.addEventListener('scroll', handleEditorScroll, { passive: true });
      previewEl.addEventListener('scroll', handlePreviewScroll, { passive: true });

      // 存储清理函数
      (editorContainer as any).__scrollCleanup = () => {
        editorEl.removeEventListener('scroll', handleEditorScroll);
        previewEl.removeEventListener('scroll', handlePreviewScroll);
      };
    });

    return () => {
      cancelAnimationFrame(rafId);
      const cleanup = (editorContainer as any).__scrollCleanup;
      if (cleanup) {
        cleanup();
        delete (editorContainer as any).__scrollCleanup;
      }
    };
  }, [isSyncScroll, viewMode]); // 移除 'value' 以避免每次按键时重新绑定

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 内部工具栏 - 仅在未隐藏时显示 */}
      {!hideToolbar && (
        <div className="flex items-center gap-2 p-2 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <button
            onClick={() => setViewMode('edit')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              viewMode === 'edit' ? 'bg-primary text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            <Edit className="w-4 h-4" />
            编辑
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              viewMode === 'preview' ? 'bg-primary text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            <Eye className="w-4 h-4" />
            预览
          </button>
          <button
            onClick={() => setViewMode('split')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              viewMode === 'split' ? 'bg-primary text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            <Columns className="w-4 h-4" />
            分屏
          </button>
        </div>
      )}

      {/* 内容 */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div
            ref={viewMode === 'split' ? editorScrollRef : null}
            className={`flex-1 overflow-hidden min-h-0 ${viewMode === 'split' ? 'border-r border-[var(--border-subtle)]' : ''}`}
          >
            <MarkdownEditor
              value={value}
              onChange={onChange}
              plain
              fontSize={actualEditorFontSize}
              showLineNumbers={showLineNumbers}
              contentCentered={viewMode === 'edit'}
              editorViewRef={editorViewRef}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onPaste={onPaste}
              isDragging={isDragging}
              theme={theme}
            />
          </div>
        )}
        
        {viewMode === 'preview' && (
          <div className="flex-1 overflow-y-auto bg-[var(--bg-primary)]">
            <div
              className="w-full pt-4 pb-12 px-6 min-h-full"
              style={{ maxWidth: '800px', margin: '0 auto' }}
            >
              <MarkdownPreview
                content={value}
                style={{ fontSize: `${actualPreviewFontSize}px` }}
                theme={theme}
              />
            </div>
          </div>
        )}

        {viewMode === 'split' && (
          <div
            ref={previewScrollRef}
            className="flex-1 overflow-y-auto bg-[var(--bg-primary)]"
          >
            <div className="max-w-[90%] mx-auto w-full pt-4 pb-10 px-6 min-h-full">
              <MarkdownPreview
                content={value}
                style={{ fontSize: `${actualPreviewFontSize}px` }}
                theme={theme}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 导出 ViewMode 类型和组件
export type { ViewMode as EditorViewMode };
export default EditorWithPreview;
