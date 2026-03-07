import { useState, useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownPreview, markdownPreviewStyles } from './MarkdownPreview';
import { Edit, Eye, Columns } from 'lucide-react';
import { motion } from 'framer-motion';

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
  /** 使用原地淡入淡出过渡而非左右滑动（移动端用） */
  useCrossfade?: boolean;
  /** 移动端触发切换到编辑模式时的 Y 坐标 */
  mobileTapY?: number;
  /** 启用 Bear 风格 WYSIWYG 模式 */
  bearMode?: boolean;
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
  useCrossfade = false,
  mobileTapY,
  bearMode = false,
}: EditorWithPreviewProps) {
  // 解析实际字体大小（个别覆盖基础）
  const actualEditorFontSize = editorFontSize ?? fontSize;
  const actualPreviewFontSize = previewFontSize ?? fontSize;
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>('split');
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  // 交叉淡入淡出模式下始终挂载的滚动容器 ref
  const crossfadeEditorRef = useRef<HTMLDivElement>(null);
  const crossfadePreviewRef = useRef<HTMLDivElement>(null);
  const scrollRatioRef = useRef<number>(0);
  const prevViewModeRef = useRef<ViewMode>(externalViewMode ?? 'split');
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

  // 跨模式切换时保留精确滚动位置（基于真实 DOM 行元素定位，支持可变行高）
  useEffect(() => {
    if (!useCrossfade) return;
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;
    if (prev === viewMode || prev === 'split' || viewMode === 'split') return;

    // ========== 核心工具函数 ==========
    
    // 通过遍历 CodeMirror 的 .cm-line DOM 元素找到第 N 行的**真实**像素偏移
    // 这正确处理了标题等行高不同的元素
    const getLinePixelOffset = (cmContent: HTMLElement, targetLine: number): number => {
      const lines = cmContent.querySelectorAll('.cm-line');
      // 行号是 1-indexed，DOM 是 0-indexed
      const idx = Math.min(targetLine - 1, lines.length - 1);
      if (idx < 0 || lines.length === 0) return 0;
      const lineEl = lines[idx] as HTMLElement;
      // offsetTop 是相对于 cm-content 的，带上 cm-content 自身的 offsetTop
      return lineEl.offsetTop;
    };

    // 通过 scrollTop 位置找到当前视口最靠近指定 Y 偏移的 CodeMirror 行号
    const getEditorLineAtOffset = (editorEl: HTMLElement, yOffset: number): { lineId: number; lineTop: number } => {
      const cmContent = editorEl.querySelector('.cm-content') as HTMLElement | null;
      if (!cmContent) return { lineId: 1, lineTop: 0 };
      
      const lines = cmContent.querySelectorAll('.cm-line');
      const absoluteY = editorEl.scrollTop + yOffset;
      
      let closestIdx = 0;
      let closestLineTop = 0;
      let minDist = Infinity;
      
      for (let i = 0; i < lines.length; i++) {
        const el = lines[i] as HTMLElement;
        const top = el.offsetTop;
        const dist = Math.abs(top - absoluteY);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = i;
          closestLineTop = top;
        }
        // 如果已经过了目标位置很远就停止
        if (top > absoluteY + 200) break;
      }
      
      return { lineId: closestIdx + 1, lineTop: closestLineTop };
    };
    
    // ========== 提取锚点信息 ==========
    
    let targetLineId = 1;
    // anchorVisualY: 锚点行在旧视口中的可视 Y 偏移（相对于容器顶部）
    let anchorVisualY = 40;

    if (prev === 'edit') {
      // 从源码编辑器提取：找到视口顶部 + 40px 处的行
      const container = crossfadeEditorRef.current;
      const editorEl = container?.querySelector('.cm-scroller') as HTMLElement | null;
      if (editorEl && editorEl.scrollTop > 0) {
        const result = getEditorLineAtOffset(editorEl, 40);
        targetLineId = result.lineId;
        // 这一行在视口中实际显示在: lineTop - scrollTop 的位置
        anchorVisualY = result.lineTop - editorEl.scrollTop;
      }
    } else if (prev === 'preview') {
      // 从预览面板提取：用户点击位置 or 视口顶部
      const previewEl = crossfadePreviewRef.current;
      if (previewEl) {
        const rect = previewEl.getBoundingClientRect();
        // 用户明确点击了某个位置
        const tapYInContainer = (mobileTapY && mobileTapY > 0) ? (mobileTapY - rect.top) : 40;
        const absoluteY = previewEl.scrollTop + tapYInContainer;
        
        const elements = Array.from(previewEl.querySelectorAll('[data-source-line]')) as HTMLElement[];
        
        let closestLine = 1;
        let closestElTop = 0;
        let minDistance = Infinity;
        
        for (const el of elements) {
          const lineNum = parseInt(el.dataset.sourceLine || '1', 10);
          const dist = Math.abs(el.offsetTop - absoluteY);
          if (dist < minDistance) {
            minDistance = dist;
            closestLine = lineNum;
            closestElTop = el.offsetTop;
          }
          if (el.offsetTop > absoluteY + 500) break;
        }
        
        targetLineId = closestLine;
        // 这个锚点在视口中的可视位置
        anchorVisualY = closestElTop - previewEl.scrollTop;
      }
    }

    // ========== 应用锚点到新面板 ==========
    
    const timer = setTimeout(() => {
      if (viewMode === 'edit') {
        const container = crossfadeEditorRef.current;
        const editorEl = container?.querySelector('.cm-scroller') as HTMLElement | null;
        const cmContent = container?.querySelector('.cm-content') as HTMLElement | null;
        if (editorEl && cmContent) {
          // 找到目标行的真实像素偏移
          const linePixelTop = getLinePixelOffset(cmContent, targetLineId);
          const maxScroll = editorEl.scrollHeight - editorEl.clientHeight;
          // 设 scrollTop 使得该行出现在视口的 anchorVisualY 位置
          const targetScroll = Math.max(0, linePixelTop - anchorVisualY);
          editorEl.scrollTop = Math.min(maxScroll, targetScroll);
        }
      } else if (viewMode === 'preview') {
        const previewEl = crossfadePreviewRef.current;
        if (previewEl) {
          const elements = Array.from(previewEl.querySelectorAll('[data-source-line]')) as HTMLElement[];
          let targetEl: HTMLElement | null = null;
          
          for (const el of elements) {
            const lineNum = parseInt(el.dataset.sourceLine || '1', 10);
            if (lineNum >= targetLineId) {
              targetEl = el;
              break;
            }
          }
          if (!targetEl && elements.length > 0) targetEl = elements[elements.length - 1];
          
          if (targetEl) {
            const maxScroll = previewEl.scrollHeight - previewEl.clientHeight;
            // 将锚点放在视口中同样的 anchorVisualY 位置
            const targetScroll = Math.max(0, targetEl.offsetTop - anchorVisualY);
            previewEl.scrollTop = Math.min(maxScroll, targetScroll);
          } else {
            previewEl.scrollTop = scrollRatioRef.current * (previewEl.scrollHeight - previewEl.clientHeight);
          }
        }
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [viewMode, useCrossfade, mobileTapY]);

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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${viewMode === 'edit' ? 'bg-primary text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]'
              }`}
          >
            <Edit className="w-4 h-4" />
            编辑
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${viewMode === 'preview' ? 'bg-primary text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]'
              }`}
          >
            <Eye className="w-4 h-4" />
            预览
          </button>
          <button
            onClick={() => setViewMode('split')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${viewMode === 'split' ? 'bg-primary text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]'
              }`}
          >
            <Columns className="w-4 h-4" />
            分屏
          </button>
        </div>
      )}

      {/* 内容 */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* 编辑器区域 */}
        <motion.div
          initial={false}
          animate={
            useCrossfade && viewMode !== 'split'
              ? {
                  opacity: viewMode === 'edit' ? 1 : 0,
                  scale: viewMode === 'edit' ? 1 : 0.985,
                  width: '100%',
                }
              : {
                  width: viewMode === 'edit' ? '100%' : viewMode === 'split' ? '50%' : '0%',
                  opacity: viewMode === 'preview' ? 0 : 1,
                  borderRightWidth: viewMode === 'split' ? 1 : 0,
                }
          }
          transition={
            useCrossfade && viewMode !== 'split'
              ? { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }
              : { type: 'spring', bounce: 0, duration: 0.4 }
          }
          className={`h-full overflow-hidden flex flex-col min-w-0 border-[var(--border-subtle)] ${
            useCrossfade && viewMode !== 'split' ? 'absolute inset-0 z-[2]' : ''
          }`}
          style={{
            ...(useCrossfade && viewMode !== 'split' && viewMode === 'preview'
              ? { pointerEvents: 'none' as const }
              : {}),
            ...(useCrossfade ? { willChange: 'transform, opacity', backfaceVisibility: 'hidden' as const } : {}),
          }}
        >
          <div ref={useCrossfade ? crossfadeEditorRef : (viewMode === 'split' ? editorScrollRef : null)} className="flex-1 overflow-hidden min-h-0 w-full min-w-[320px]">
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
              bearMode={bearMode}
            />
          </div>
        </motion.div>

        {/* 预览区域 */}
        <motion.div
          initial={false}
          animate={
            useCrossfade && viewMode !== 'split'
              ? {
                  opacity: viewMode === 'preview' ? 1 : 0,
                  scale: viewMode === 'preview' ? 1 : 0.985,
                  width: '100%',
                }
              : {
                  width: viewMode === 'preview' ? '100%' : viewMode === 'split' ? '50%' : '0%',
                  opacity: viewMode === 'edit' ? 0 : 1,
                }
          }
          transition={
            useCrossfade && viewMode !== 'split'
              ? { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }
              : { type: 'spring', bounce: 0, duration: 0.4 }
          }
          className={`h-full overflow-hidden bg-[var(--bg-primary)] flex flex-col min-w-0 ${
            useCrossfade && viewMode !== 'split' ? 'absolute inset-0 z-[1]' : ''
          }`}
          style={{
            ...(useCrossfade && viewMode !== 'split' && viewMode === 'edit'
              ? { pointerEvents: 'none' as const }
              : {}),
            ...(useCrossfade ? { willChange: 'transform, opacity', backfaceVisibility: 'hidden' as const } : {}),
          }}
        >
          <div ref={useCrossfade ? crossfadePreviewRef : (viewMode === 'split' ? previewScrollRef : null)} className="flex-1 overflow-y-auto w-full min-w-[320px]">
            <div className={`w-full pt-4 pb-12 px-6 min-h-full ${viewMode === 'preview' ? 'max-w-[800px] mx-auto' : 'max-w-[90%] mx-auto'}`}>
              <MarkdownPreview
                content={value}
                style={{ fontSize: `${actualPreviewFontSize}px` }}
                theme={theme}
              />
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// 导出 ViewMode 类型和组件
export type { ViewMode as EditorViewMode };
export default EditorWithPreview;
