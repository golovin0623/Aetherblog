/**
 * QA Proofread Page — split-view: image + canonical tree editor
 * Left: original page image with bbox highlight overlay
 * Right: structured text tree (editable) + annotation creation
 * ref: docs/features/qa-document-workflow.md §3, §4, §7
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Save, Plus, X, ChevronRight, ChevronDown,
  Loader2, AlertCircle, MessageSquare, CheckCircle2, Edit3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { spring, transition } from '@aetherblog/ui';
import { Skeleton } from '@aetherblog/ui';
import { qaDocumentService } from '@/services/qaDocumentService';
import { useQaDocumentStore } from '@/stores/qaDocumentStore';
import type {
  CanonicalNode,
  QaAnnotation,
  AnnotationCategory,
  BBox,
} from '@/types/qaDocument';
import { logger } from '@/lib/logger';

const ANNOTATION_CATEGORIES: AnnotationCategory[] = [
  '错字', '漏字', '公式错', '表格错', '题号错', '拆分错', '答案错', '解析错',
];

/** Render a positioned rectangle overlay for a bbox (normalized 0~1) */
function BBoxOverlay({ bbox, active }: { bbox: BBox; active: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${bbox.x * 100}%`,
        top: `${bbox.y * 100}%`,
        width: `${bbox.w * 100}%`,
        height: `${bbox.h * 100}%`,
        pointerEvents: 'none',
      }}
      className={cn(
        'rounded border-2 transition-all duration-200',
        active
          ? 'border-[var(--aurora-1)] bg-[color-mix(in_oklch,var(--aurora-1)_15%,transparent)]'
          : 'border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] bg-transparent'
      )}
    />
  );
}

interface TreeNodeProps {
  node: CanonicalNode;
  depth: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onPatchText: (node: CanonicalNode, text: string) => void;
  onAnnotate: (node: CanonicalNode) => void;
  annotations: QaAnnotation[];
}

function TreeNode({
  node, depth, selectedKey, onSelect, onPatchText, onAnnotate, annotations,
}: TreeNodeProps) {
  const isSelected = selectedKey === node.stableKey;
  const [expanded, setExpanded] = useState(depth < 2);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(node.text);
  const [saving, setSaving] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const nodeAnnotations = annotations.filter((a) => a.stableKey === node.stableKey);

  const handleSave = async () => {
    setSaving(true);
    await onPatchText(node, editText);
    setSaving(false);
    setEditing(false);
  };

  return (
    <div>
      <div
        className={cn(
          'group flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
          isSelected
            ? 'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]'
            : 'hover:bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]'
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(node.stableKey)}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="mt-0.5 flex-shrink-0 text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--ink-muted)]">
              {node.blockType}
            </span>
            {nodeAnnotations.length > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--aurora-1)] px-1 font-mono text-[10px] text-white">
                {nodeAnnotations.length}
              </span>
            )}
            {node.confidence < 0.8 && (
              <span className="font-mono text-[10px] text-[var(--signal-warn)]">
                {Math.round(node.confidence * 100)}%
              </span>
            )}
          </div>

          {editing ? (
            <div className="mt-1 flex items-start gap-1" onClick={(e) => e.stopPropagation()}>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={2}
                className={cn(
                  'flex-1 rounded-md border border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] bg-[var(--bg-leaf)] px-2 py-1 text-xs text-[var(--ink-primary)]',
                  'focus:outline-none focus:border-[var(--aurora-1)] resize-none'
                )}
                autoFocus
              />
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded p-1 text-[var(--signal-success)] hover:bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)] disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setEditText(node.text); }}
                  className="rounded p-1 text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--ink-secondary)]">{node.text || <em className="opacity-40">（空）</em>}</p>
          )}
        </div>

        {isSelected && !editing && (
          <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className="rounded p-1 text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] hover:text-[var(--aurora-1)]"
              title="编辑文本"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAnnotate(node); }}
              className="rounded p-1 text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] hover:text-[var(--aurora-1)]"
              title="添加标注"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {hasChildren && expanded && (
        <div>
          {node.children!.map((child) => (
            <TreeNode
              key={child.stableKey}
              node={child}
              depth={depth + 1}
              selectedKey={selectedKey}
              onSelect={onSelect}
              onPatchText={onPatchText}
              onAnnotate={onAnnotate}
              annotations={annotations}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function QaProofreadPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tree, selectedStableKey, setTree, setSelectedStableKey, treeLoading, setTreeLoading } = useQaDocumentStore();

  const [doc, setDoc] = useState<{ id: string; title: string; fileUrl?: string } | null>(null);
  const [annotations, setAnnotations] = useState<QaAnnotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pageNo, setPageNo] = useState(1);

  // Annotation form
  const [annotateNode, setAnnotateNode] = useState<CanonicalNode | null>(null);
  const [annotateCategory, setAnnotateCategory] = useState<AnnotationCategory>('错字');
  const [annotateNote, setAnnotateNote] = useState('');
  const [annotateCorrected, setAnnotateCorrected] = useState('');
  const [annotating, setAnnotating] = useState(false);

  const imageRef = useRef<HTMLImageElement>(null);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setTreeLoading(true);
    try {
      const [docRes, treeRes, annRes] = await Promise.all([
        qaDocumentService.getById(id),
        qaDocumentService.getTree(id),
        qaDocumentService.getAnnotations(id),
      ]);
      if (docRes.data) setDoc({ id: docRes.data.id, title: docRes.data.title, fileUrl: docRes.data.fileUrl });
      if (treeRes.data) setTree(treeRes.data);
      if (annRes.data) setAnnotations(annRes.data);
    } catch (err) {
      logger.error('Proofread fetch error:', err);
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setTreeLoading(false);
    }
  }, [id, setTree, setTreeLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Selected node for bbox display
  const allNodes = flattenTree(tree);
  const selectedNode = allNodes.find((n) => n.stableKey === selectedStableKey);
  const pageNodes = allNodes.filter((n) => selectedNode ? n.pageNo === selectedNode.pageNo : n.pageNo === pageNo);

  const handlePatchText = async (node: CanonicalNode, text: string) => {
    if (!id || !node.id) return;
    try {
      await qaDocumentService.patchBlock(id, node.id, text);
      await fetchData();
    } catch (err) {
      logger.error('Patch block error:', err);
    }
  };

  const handleAnnotate = (node: CanonicalNode) => {
    setAnnotateNode(node);
    setAnnotateCorrected(node.text);
    setAnnotateNote('');
  };

  const submitAnnotation = async () => {
    if (!id || !annotateNode) return;
    setAnnotating(true);
    try {
      await qaDocumentService.createAnnotation(id, {
        blockId: annotateNode.id ?? annotateNode.stableKey,
        stableKey: annotateNode.stableKey,
        category: annotateCategory,
        note: annotateNote || undefined,
        correctedText: annotateCorrected || undefined,
      });
      setAnnotateNode(null);
      setAnnotateNote('');
      setAnnotateCorrected('');
      await fetchData();
    } catch (err) {
      logger.error('Create annotation error:', err);
    } finally {
      setAnnotating(false);
    }
  };

  // Current page image URL from the sourceCropUrl of page nodes or doc fileUrl
  const currentPageNode = allNodes.find((n) => n.blockType === 'PAGE' && n.pageNo === (selectedNode?.pageNo ?? pageNo));
  const pageImageUrl = currentPageNode?.sourceCropUrl ?? doc?.fileUrl;

  if (error) {
    return (
      <div className="p-6 text-center text-[var(--signal-danger)]">
        <AlertCircle className="mx-auto mb-2 h-8 w-8" />
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-4 py-3">
        <button
          type="button"
          onClick={() => navigate(`/qa/${id}`)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-2.5 text-sm text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          详情
        </button>
        <h1 className="flex-1 truncate font-display text-base text-[var(--ink-primary)]">
          {doc?.title ?? '校对'} — 人工校对
        </h1>
        <span className="font-mono text-xs text-[var(--ink-muted)]">
          {annotations.length} 条标注
        </span>
      </div>

      {/* Split pane */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: page image */}
        <div className="relative w-1/2 overflow-auto border-r border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-void)] p-4">
          {treeLoading ? (
            <Skeleton className="aspect-[3/4] w-full rounded-xl" />
          ) : pageImageUrl ? (
            <div className="relative inline-block max-w-full">
              <img
                ref={imageRef}
                src={pageImageUrl}
                alt={`第 ${selectedNode?.pageNo ?? pageNo} 页`}
                className="max-w-full rounded-lg shadow-xl"
                draggable={false}
              />
              {/* All block bbox overlays for current page */}
              {pageNodes
                .filter((n) => n.bbox && n.blockType !== 'PAGE')
                .map((n) => (
                  <BBoxOverlay
                    key={n.stableKey}
                    bbox={n.bbox}
                    active={n.stableKey === selectedStableKey}
                  />
                ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[var(--ink-muted)]">
              <p className="text-sm">暂无页面图片</p>
            </div>
          )}
        </div>

        {/* Right: tree editor */}
        <div className="flex w-1/2 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-3">
            {treeLoading ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : tree.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--ink-muted)]">
                暂无文档树节点
              </div>
            ) : (
              tree.map((node) => (
                <TreeNode
                  key={node.stableKey}
                  node={node}
                  depth={0}
                  selectedKey={selectedStableKey}
                  onSelect={setSelectedStableKey}
                  onPatchText={handlePatchText}
                  onAnnotate={handleAnnotate}
                  annotations={annotations}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Annotation modal */}
      <AnimatePresence>
        {annotateNode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition.quick}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={spring.soft}
              className="surface-overlay w-full max-w-sm rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] p-5 shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-base text-[var(--ink-primary)]">新建标注</h2>
                <button type="button" onClick={() => setAnnotateNode(null)} className="rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="mb-3 line-clamp-2 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-3 py-2 text-xs text-[var(--ink-muted)]">
                {annotateNode.text}
              </p>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">错误类别</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ANNOTATION_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setAnnotateCategory(cat)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                          annotateCategory === cat
                            ? 'border-[var(--aurora-1)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)]'
                            : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
                        )}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">纠正文本（可选）</label>
                  <input
                    type="text"
                    value={annotateCorrected}
                    onChange={(e) => setAnnotateCorrected(e.target.value)}
                    className={cn(
                      'h-9 w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] px-3 text-sm',
                      'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--aurora-1)]'
                    )}
                    placeholder="输入正确内容"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">备注（可选）</label>
                  <textarea
                    value={annotateNote}
                    onChange={(e) => setAnnotateNote(e.target.value)}
                    rows={2}
                    className={cn(
                      'w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] px-3 py-2 text-sm resize-none',
                      'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--aurora-1)]'
                    )}
                    placeholder="描述问题"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setAnnotateNode(null)}
                    className="flex-1 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] py-2 text-sm text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={submitAnnotation}
                    disabled={annotating}
                    className="flex-1 rounded-lg bg-[var(--aurora-1)] py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {annotating ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : '提交标注'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Flatten nested tree to a flat array for lookups */
function flattenTree(nodes: CanonicalNode[]): CanonicalNode[] {
  const result: CanonicalNode[] = [];
  function walk(n: CanonicalNode) {
    result.push(n);
    n.children?.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}
