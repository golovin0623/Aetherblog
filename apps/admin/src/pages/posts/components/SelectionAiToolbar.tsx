import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Languages, Loader2, Sparkles, X, Copy, Check } from 'lucide-react';
import { EditorView } from '@aetherblog/editor';
import { aiService } from '@/services/aiService';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SelectionAiToolbarProps {
  editorViewRef: React.RefObject<EditorView | null>;
  selectedModelId?: string;
  selectedProviderCode?: string;
}

type SelectionAnchor = {
  from: number;
  to: number;
  text: string;
  x: number;
  y: number;
};

type AiAction = 'polish' | 'summary' | 'translate';
type PreviewMode = 'diff' | 'result';

type DiffSegment = {
  type: 'equal' | 'insert' | 'delete';
  value: string;
};

const actionLabels: Record<AiAction, string> = {
  polish: '润色',
  summary: '摘要',
  translate: '翻译',
};

const languageOptions = [
  { value: 'en', label: '英语' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
];

const MAX_DIFF_TOKENS = 240;
const MAX_DIFF_MATRIX = 20000;

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter(token => token.length > 0);
}

function buildDiffSegments(original: string, updated: string): DiffSegment[] | null {
  const a = tokenize(original);
  const b = tokenize(updated);
  if (a.length === 0 && b.length === 0) return null;
  if (a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS) return null;
  if (a.length * b.length > MAX_DIFF_MATRIX) return null;

  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      segments.push({ type: 'equal', value: a[i] });
      i += 1;
      j += 1;
      continue;
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      segments.push({ type: 'delete', value: a[i] });
      i += 1;
    } else {
      segments.push({ type: 'insert', value: b[j] });
      j += 1;
    }
  }

  while (i < a.length) {
    segments.push({ type: 'delete', value: a[i] });
    i += 1;
  }

  while (j < b.length) {
    segments.push({ type: 'insert', value: b[j] });
    j += 1;
  }

  const merged: DiffSegment[] = [];
  for (const segment of segments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === segment.type) {
      prev.value += segment.value;
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}

function getAnchorCoords(view: EditorView, from: number, to: number) {
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  if (!start || !end) return null;

  const rawX = (start.left + end.right) / 2;
  const rawY = Math.min(start.top, end.top);

  const x = Math.min(window.innerWidth - 16, Math.max(16, rawX));
  const y = Math.min(window.innerHeight - 16, Math.max(16, rawY));

  return { x, y };
}

export function SelectionAiToolbar({ editorViewRef, selectedModelId, selectedProviderCode }: SelectionAiToolbarProps) {
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
  const [activeRange, setActiveRange] = useState<SelectionAnchor | null>(null);
  const [loadingAction, setLoadingAction] = useState<AiAction | null>(null);
  const [result, setResult] = useState<{ action: AiAction; text: string } | null>(null);
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [copied, setCopied] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('result');
  const rafRef = useRef<number | null>(null);

  const updateSelection = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    if (activeRange) {
      const coords = getAnchorCoords(view, activeRange.from, activeRange.to);
      if (!coords) return;
      setActiveRange(prev => (prev ? { ...prev, ...coords } : prev));
      return;
    }

    const { from, to } = view.state.selection.main;
    if (from === to) {
      setAnchor(null);
      return;
    }

    const text = view.state.sliceDoc(from, to);
    if (!text.trim()) {
      setAnchor(null);
      return;
    }

    const coords = getAnchorCoords(view, from, to);
    if (!coords) {
      setAnchor(null);
      return;
    }

    setAnchor({ from, to, text, ...coords });
  }, [activeRange, editorViewRef]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const attachListeners = () => {
      const view = editorViewRef.current;
      if (!view) {
        rafRef.current = requestAnimationFrame(attachListeners);
        return;
      }

      const handleUpdate = () => updateSelection();

      view.dom.addEventListener('mouseup', handleUpdate);
      view.dom.addEventListener('keyup', handleUpdate);
      view.dom.addEventListener('focus', handleUpdate);
      view.scrollDOM.addEventListener('scroll', handleUpdate, { passive: true });
      window.addEventListener('resize', handleUpdate);
      window.addEventListener('scroll', handleUpdate, true);

      cleanup = () => {
        view.dom.removeEventListener('mouseup', handleUpdate);
        view.dom.removeEventListener('keyup', handleUpdate);
        view.dom.removeEventListener('focus', handleUpdate);
        view.scrollDOM.removeEventListener('scroll', handleUpdate);
        window.removeEventListener('resize', handleUpdate);
        window.removeEventListener('scroll', handleUpdate, true);
      };

      handleUpdate();
    };

    attachListeners();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      cleanup?.();
    };
  }, [editorViewRef, updateSelection]);

  const runAction = useCallback(
    async (action: AiAction) => {
      const current = anchor;
      if (!current) return;

      setActiveRange(current);
      setLoadingAction(action);
      setResult(null);
      setCopied(false);
      setPreviewMode(action === 'polish' ? 'diff' : 'result');

      const modelPayload =
        selectedModelId && selectedProviderCode
          ? { modelId: selectedModelId, providerCode: selectedProviderCode }
          : {};

      try {
        if (action === 'polish') {
          const res = await aiService.polishContent({
            content: current.text,
            polishType: 'all',
            style: 'professional',
            ...modelPayload,
          });
          if (res.code === 200 && res.data) {
            setResult({ action, text: res.data.polishedContent });
          } else {
            toast.error(res.message || '润色失败');
          }
        }

        if (action === 'summary') {
          const res = await aiService.generateSummary({ content: current.text, ...modelPayload });
          if (res.code === 200 && res.data) {
            setResult({ action, text: res.data.summary });
          } else {
            toast.error(res.message || '摘要生成失败');
          }
        }

        if (action === 'translate') {
          const res = await aiService.translateContent({
            content: current.text,
            targetLanguage,
            ...modelPayload,
          });
          if (res.code === 200 && res.data) {
            setResult({ action, text: res.data.translatedContent });
          } else {
            toast.error(res.message || '翻译失败');
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI 处理失败';
        toast.error(message);
      } finally {
        setLoadingAction(null);
      }
    },
    [anchor, targetLanguage, selectedModelId, selectedProviderCode]
  );

  const clearResult = useCallback(() => {
    setResult(null);
    setActiveRange(null);
    setLoadingAction(null);
    setCopied(false);
    setPreviewMode('result');
    requestAnimationFrame(updateSelection);
  }, [updateSelection]);

  const applyResult = useCallback(
    (mode: 'replace' | 'insert') => {
      const view = editorViewRef.current;
      if (!view || !activeRange || !result) return;

      const insertText = mode === 'insert'
        ? (result.text.startsWith('\n') ? result.text : `\n${result.text}`)
        : result.text;

      const from = mode === 'insert' ? activeRange.to : activeRange.from;
      const to = mode === 'insert' ? activeRange.to : activeRange.to;

      view.dispatch({
        changes: { from, to, insert: insertText },
        selection: { anchor: from + insertText.length },
      });

      view.focus();
      clearResult();
    },
    [activeRange, result, editorViewRef, clearResult]
  );

  const copyResult = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      const message = error instanceof Error ? error.message : '复制失败';
      toast.error(message);
    }
  }, [result]);

  const displayAnchor = activeRange ?? anchor;
  const toolbarTop = displayAnchor ? Math.max(32, displayAnchor.y) : 0;
  const panelTop = displayAnchor ? Math.min(window.innerHeight - 120, displayAnchor.y + 12) : 0;

  const diffSegments = useMemo(() => {
    if (!result || !activeRange) return null;
    return buildDiffSegments(activeRange.text, result.text);
  }, [result, activeRange]);

  const actions = useMemo(() => ([
    { key: 'polish' as const, label: '润色', icon: Sparkles },
    { key: 'summary' as const, label: '摘要', icon: FileText },
    { key: 'translate' as const, label: '翻译', icon: Languages },
  ]), []);

  if (!displayAnchor) return null;

  return (
    <>
      <div
        className="fixed z-50 flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur shadow-lg"
        style={{ left: displayAnchor.x, top: toolbarTop, transform: 'translate(-50%, -100%)' }}
      >
        {actions.map((action) => (
          <button
            key={action.key}
            onClick={() => runAction(action.key)}
            disabled={loadingAction !== null}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors',
              'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
              loadingAction && 'opacity-60 cursor-not-allowed'
            )}
          >
            {loadingAction === action.key ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <action.icon className="w-3.5 h-3.5" />
            )}
            <span>{action.label}</span>
          </button>
        ))}

        <div className="w-px h-5 bg-[var(--border-subtle)] mx-1" />
        <select
          value={targetLanguage}
          onChange={(e) => setTargetLanguage(e.target.value)}
          className="h-7 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)] pl-2 pr-6 focus:outline-none appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%20stroke%3D%22%236b7280%22%3E%3Cpath%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px_16px] bg-[right_4px_center] bg-no-repeat"
        >
          {languageOptions.map((lang) => (
            <option key={lang.value} value={lang.value}>{lang.label}</option>
          ))}
        </select>
      </div>

      {(loadingAction || result) && (
        <div
          className="fixed z-40"
          style={{ left: displayAnchor.x, top: panelTop, transform: 'translateX(-50%)' }}
        >
          <div className="w-[90vw] max-w-[520px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-subtle)]">
              <div className="text-xs text-[var(--text-secondary)]">
                {loadingAction ? `AI ${actionLabels[loadingAction]}中...` : `AI ${result ? actionLabels[result.action] : ''}`}
              </div>
              <button
                onClick={clearResult}
                className="p-1 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="px-4 py-3">
              {loadingAction ? (
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  AI 正在生成结果...
                </div>
              ) : (
                <div className="space-y-3">
                  {diffSegments && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPreviewMode('diff')}
                        className={cn(
                          'px-2 py-1 text-xs rounded-md border transition-colors',
                          previewMode === 'diff'
                            ? 'border-primary text-primary bg-primary/10'
                            : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        )}
                      >
                        差异
                      </button>
                      <button
                        onClick={() => setPreviewMode('result')}
                        className={cn(
                          'px-2 py-1 text-xs rounded-md border transition-colors',
                          previewMode === 'result'
                            ? 'border-primary text-primary bg-primary/10'
                            : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        )}
                      >
                        结果
                      </button>
                      <span className="text-[10px] text-[var(--text-muted)]">最大 240 词</span>
                    </div>
                  )}
                  {previewMode === 'diff' && diffSegments ? (
                    <div className="text-sm text-[var(--text-primary)] whitespace-pre-wrap max-h-48 overflow-auto leading-relaxed">
                      {diffSegments.map((segment, index) => (
                        <span
                          key={`${segment.type}-${index}`}
                          className={cn(
                            segment.type === 'insert' && 'bg-emerald-500/20 text-emerald-200',
                            segment.type === 'delete' && 'bg-rose-500/20 text-rose-200 line-through',
                            segment.type === 'equal' && 'text-[var(--text-secondary)]'
                          )}
                        >
                          {segment.value}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--text-primary)] whitespace-pre-wrap max-h-48 overflow-auto">
                      {result?.text}
                    </div>
                  )}
                  {!diffSegments && (
                    <div className="text-[10px] text-[var(--text-muted)]">
                      差异预览仅适用于较短文本。
                    </div>
                  )}
                </div>
              )}
            </div>
            {!loadingAction && result && (
              <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                <div className="text-xs text-[var(--text-muted)]">选区长度：{activeRange?.text.length ?? 0}</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={copyResult}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)]"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? '已复制' : '复制'}
                  </button>
                  <button
                    onClick={() => applyResult('insert')}
                    className="px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)]"
                  >
                    插入下方
                  </button>
                  <button
                    onClick={() => applyResult('replace')}
                    className="px-2.5 py-1.5 text-xs rounded-md bg-primary text-white hover:bg-primary/90"
                  >
                    替换选区
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default SelectionAiToolbar;
