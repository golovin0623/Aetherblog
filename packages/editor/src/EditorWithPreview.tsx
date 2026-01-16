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
  /** External view mode control (controlled component) */
  viewMode?: ViewMode;
  /** Callback when view mode changes (only used with external viewMode) */
  onViewModeChange?: (mode: ViewMode) => void;
  /** Hide the internal toolbar (use when providing external controls) */
  hideToolbar?: boolean;
  /** Synchronize scroll between editor and preview in split mode */
  isSyncScroll?: boolean;
  /** Base font size in px (used when editorFontSize/previewFontSize not provided) */
  fontSize?: number;
  /** Editor font size in px (overrides fontSize for editor) */
  editorFontSize?: number;
  /** Preview font size in px (overrides fontSize for preview) */
  previewFontSize?: number;
  /** Whether to show line numbers in editor */
  showLineNumbers?: boolean;
  /** Ref to expose the CodeMirror EditorView for external control (toolbar commands) */
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
  /** 是否正在拖拽文件 */
  isDragging?: boolean;
  /** Editor theme */
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
  // Resolve actual font sizes (individual overrides base)
  const actualEditorFontSize = editorFontSize ?? fontSize;
  const actualPreviewFontSize = previewFontSize ?? fontSize;
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>('split');
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);
  
  // Use external viewMode if provided, otherwise use internal state
  const viewMode = externalViewMode ?? internalViewMode;
  const setViewMode = onViewModeChange ?? setInternalViewMode;

  // Inject markdown preview styles
  useEffect(() => {
    const styleId = 'markdown-preview-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = markdownPreviewStyles;
      document.head.appendChild(style);
    }
  }, []);

  // Sync scroll logic - uses line-based sync for better accuracy
  useEffect(() => {
    if (!isSyncScroll || viewMode !== 'split') return;

    const editorContainer = editorScrollRef.current;
    const previewEl = previewScrollRef.current;
    if (!editorContainer || !previewEl) return;

    // Use RAF to ensure CodeMirror has rendered
    const rafId = requestAnimationFrame(() => {
      // Find CodeMirror's internal scroller and line elements
      const editorEl = editorContainer.querySelector('.cm-scroller') as HTMLElement | null;
      const cmContent = editorContainer.querySelector('.cm-content') as HTMLElement | null;
      if (!editorEl || !cmContent) return;

      // Get the current top visible line in the editor
      const getEditorTopLine = (): number => {
        const scrollTop = editorEl.scrollTop;
        const paddingTop = parseFloat(getComputedStyle(cmContent).paddingTop) || 0;
        
        // Measure line height dynamically from the first visible line
        const firstLine = cmContent.querySelector('.cm-line');
        // Default to fontSize * 1.5 if no line found (1.5 is standard line-height)
        const lineHeight = firstLine ? firstLine.clientHeight : (fontSize || 16) * 1.5;
        
        if (!lineHeight) return 1;

        // Calculate line number based on scroll position
        // Subtract padding to get content scroll position
        const contentScrollTop = Math.max(0, scrollTop - paddingTop);
        return Math.floor(contentScrollTop / lineHeight) + 1;
      };

      // Find the closest element in preview with data-source-line
      const scrollPreviewToLine = (lineNum: number): void => {
        // Find elements with data-source-line attributes
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
          // Calculate offset position
          const elementTop = (closestElement as HTMLElement).offsetTop;
          const lineDiff = lineNum - closestLine;
          // Calculate dynamic line height
          const firstLine = cmContent.querySelector('.cm-line');
          const lineHeight = firstLine ? firstLine.clientHeight : (fontSize || 16) * 1.5;

          // Estimate additional scroll based on line difference
          const additionalScroll = lineDiff * lineHeight;
          
          previewEl.scrollTop = Math.max(0, elementTop + additionalScroll - 50);
        } else {
          // Fallback to percentage-based sync
          const editorScrollable = editorEl.scrollHeight - editorEl.clientHeight;
          const previewScrollable = previewEl.scrollHeight - previewEl.clientHeight;
          if (editorScrollable > 0 && previewScrollable > 0) {
            const scrollPercentage = editorEl.scrollTop / editorScrollable;
            previewEl.scrollTop = scrollPercentage * previewScrollable;
          }
        }
      };

      // Sync editor from preview scroll
      const scrollEditorToPreviewPosition = (): void => {
        const previewScrollable = previewEl.scrollHeight - previewEl.clientHeight;
        if (previewScrollable <= 0) return;
        
        const scrollPercentage = previewEl.scrollTop / previewScrollable;
        const editorScrollable = editorEl.scrollHeight - editorEl.clientHeight;
        editorEl.scrollTop = scrollPercentage * editorScrollable;
      };

      // Note: We intentionally do NOT immediately sync on enable
      // This prevents position jumps when restoring sync after TOC navigation

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

      // Store cleanup function
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
  }, [isSyncScroll, viewMode]); // Remove 'value' to avoid rebinding on every keystroke

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Internal Toolbar - only show if not hidden */}
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

      {/* Content */}
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
              className="w-full py-12 px-6 min-h-full"
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
            <div className="max-w-[90%] mx-auto w-full py-10 px-6 min-h-full">
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

// Export ViewMode type and component
export type { ViewMode as EditorViewMode };
export default EditorWithPreview;
