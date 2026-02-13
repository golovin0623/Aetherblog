import { useState, useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
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
  /** 额外的 CodeMirror Extensions */
  additionalExtensions?: Extension[];
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
  additionalExtensions = [],
}: EditorWithPreviewProps) {
  // 解析实际字体大小（个别覆盖基础）
  const actualEditorFontSize = editorFontSize ?? fontSize;
  const actualPreviewFontSize = previewFontSize ?? fontSize;
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>('split');
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);
  const syncSuspendUntilRef = useRef(0);
  
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

  // 同步滚动逻辑：锚点分段插值 + 惯性抑制 + 双向节流
  useEffect(() => {
    if (!isSyncScroll || viewMode !== 'split') {
      return;
    }

    const editorContainer = editorScrollRef.current;
    const previewEl = previewScrollRef.current;
    if (!editorContainer || !previewEl) {
      return;
    }

    syncSuspendUntilRef.current = Date.now() + 500;

    let editorFrame: number | null = null;
    let previewFrame: number | null = null;
    let lastEditorSyncAt = 0;
    let lastPreviewSyncAt = 0;

    const SYNC_THROTTLE_MS = 24;
    const SNAP_THRESHOLD = 4;
    const SCROLL_OFFSET = 50;

    const rafId = requestAnimationFrame(() => {
      const editorEl = editorContainer.querySelector('.cm-scroller') as HTMLElement | null;
      const cmContent = editorContainer.querySelector('.cm-content') as HTMLElement | null;
      if (!editorEl || !cmContent) {
        return;
      }

      type AnchorPoint = { line: number; top: number };

      const getLineHeight = (): number => {
        const firstLine = cmContent.querySelector('.cm-line') as HTMLElement | null;
        return firstLine?.clientHeight || (fontSize || 16) * 1.5;
      };

      const getEditorMetrics = () => {
        const lineHeight = Math.max(1, getLineHeight());
        const paddingTop = parseFloat(getComputedStyle(cmContent).paddingTop) || 0;
        return { lineHeight, paddingTop };
      };

      const readAnchors = (): AnchorPoint[] => {
        const elements = previewEl.querySelectorAll('[data-source-line]');
        const points: AnchorPoint[] = [];
        const seen = new Set<number>();

        for (const node of Array.from(elements)) {
          const el = node as HTMLElement;
          const line = Number.parseInt(el.dataset.sourceLine || '0', 10);
          if (!Number.isFinite(line) || line <= 0 || seen.has(line)) {
            continue;
          }
          seen.add(line);
          points.push({ line, top: el.offsetTop });
        }

        return points.sort((a, b) => a.line - b.line);
      };

      const interpolatePreviewTopFromLine = (lineNum: number, anchors: AnchorPoint[], lineHeight: number): number => {
        if (anchors.length === 0) {
          const editorScrollable = editorEl.scrollHeight - editorEl.clientHeight;
          const previewScrollable = previewEl.scrollHeight - previewEl.clientHeight;
          if (editorScrollable <= 0 || previewScrollable <= 0) {
            return 0;
          }
          return (editorEl.scrollTop / editorScrollable) * previewScrollable;
        }

        let prev: AnchorPoint | null = null;
        let next: AnchorPoint | null = null;

        for (const anchor of anchors) {
          if (anchor.line <= lineNum) {
            prev = anchor;
            continue;
          }
          next = anchor;
          break;
        }

        if (prev && next) {
          const lineSpan = Math.max(1, next.line - prev.line);
          const ratio = (lineNum - prev.line) / lineSpan;
          return prev.top + ratio * (next.top - prev.top) - SCROLL_OFFSET;
        }

        if (prev) {
          return prev.top + (lineNum - prev.line) * lineHeight - SCROLL_OFFSET;
        }

        const firstAnchor = anchors[0];
        return Math.max(0, firstAnchor.top - (firstAnchor.line - lineNum) * lineHeight - SCROLL_OFFSET);
      };

      const interpolateLineFromPreviewTop = (previewTop: number, anchors: AnchorPoint[], lineHeight: number): number => {
        if (anchors.length === 0) {
          const previewScrollable = previewEl.scrollHeight - previewEl.clientHeight;
          const editorScrollable = editorEl.scrollHeight - editorEl.clientHeight;
          if (previewScrollable <= 0 || editorScrollable <= 0) {
            return 1;
          }
          const ratio = previewEl.scrollTop / previewScrollable;
          const estimatedEditorTop = ratio * editorScrollable;
          return Math.max(1, Math.floor(estimatedEditorTop / lineHeight) + 1);
        }

        const targetTop = previewTop + SCROLL_OFFSET;
        let prev: AnchorPoint | null = null;
        let next: AnchorPoint | null = null;

        for (const anchor of anchors) {
          if (anchor.top <= targetTop) {
            prev = anchor;
            continue;
          }
          next = anchor;
          break;
        }

        if (prev && next) {
          const topSpan = Math.max(1, next.top - prev.top);
          const ratio = (targetTop - prev.top) / topSpan;
          return Math.max(1, Math.round(prev.line + ratio * (next.line - prev.line)));
        }

        if (prev) {
          return Math.max(1, Math.round(prev.line + (targetTop - prev.top) / lineHeight));
        }

        const firstAnchor = anchors[0];
        return Math.max(1, Math.round(firstAnchor.line - (firstAnchor.top - targetTop) / lineHeight));
      };

      const syncEditorToPreview = () => {
        const now = Date.now();
        if (now < syncSuspendUntilRef.current || now - lastEditorSyncAt < SYNC_THROTTLE_MS) {
          return;
        }

        lastEditorSyncAt = now;
        const { lineHeight, paddingTop } = getEditorMetrics();
        const contentScrollTop = Math.max(0, editorEl.scrollTop - paddingTop);
        const topLine = Math.floor(contentScrollTop / lineHeight) + 1;
        const anchors = readAnchors();
        const targetTop = Math.max(0, interpolatePreviewTopFromLine(topLine, anchors, lineHeight));

        if (Math.abs(previewEl.scrollTop - targetTop) <= SNAP_THRESHOLD) {
          return;
        }

        previewEl.scrollTop = targetTop;
      };

      const syncPreviewToEditor = () => {
        const now = Date.now();
        if (now < syncSuspendUntilRef.current || now - lastPreviewSyncAt < SYNC_THROTTLE_MS) {
          return;
        }

        lastPreviewSyncAt = now;
        const { lineHeight, paddingTop } = getEditorMetrics();
        const anchors = readAnchors();
        const targetLine = interpolateLineFromPreviewTop(previewEl.scrollTop, anchors, lineHeight);
        const targetEditorTop = Math.max(0, paddingTop + (targetLine - 1) * lineHeight - SCROLL_OFFSET);

        if (Math.abs(editorEl.scrollTop - targetEditorTop) <= SNAP_THRESHOLD) {
          return;
        }

        editorEl.scrollTop = targetEditorTop;
      };

      const handleEditorScroll = () => {
        if (isSyncingRef.current) {
          return;
        }
        if (editorFrame !== null) {
          cancelAnimationFrame(editorFrame);
        }

        editorFrame = requestAnimationFrame(() => {
          editorFrame = null;
          isSyncingRef.current = true;
          syncEditorToPreview();
          requestAnimationFrame(() => {
            isSyncingRef.current = false;
          });
        });
      };

      const handlePreviewScroll = () => {
        if (isSyncingRef.current) {
          return;
        }
        if (previewFrame !== null) {
          cancelAnimationFrame(previewFrame);
        }

        previewFrame = requestAnimationFrame(() => {
          previewFrame = null;
          isSyncingRef.current = true;
          syncPreviewToEditor();
          requestAnimationFrame(() => {
            isSyncingRef.current = false;
          });
        });
      };

      editorEl.addEventListener('scroll', handleEditorScroll, { passive: true });
      previewEl.addEventListener('scroll', handlePreviewScroll, { passive: true });

      (editorContainer as any).__scrollCleanup = () => {
        editorEl.removeEventListener('scroll', handleEditorScroll);
        previewEl.removeEventListener('scroll', handlePreviewScroll);
        if (editorFrame !== null) {
          cancelAnimationFrame(editorFrame);
          editorFrame = null;
        }
        if (previewFrame !== null) {
          cancelAnimationFrame(previewFrame);
          previewFrame = null;
        }
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
  }, [fontSize, isSyncScroll, viewMode]);

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
              additionalExtensions={additionalExtensions}
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
