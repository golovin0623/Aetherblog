import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Copy, FileText, Hash, Languages, Library, ListPlus, Minus, PenLine, Plus, PlusCircle, Replace, Search, Sparkles, Tag, Type, X } from 'lucide-react';
import { MarkdownPreview } from '@aetherblog/editor';
import { cn } from '@/lib/utils';
import type { StreamResult } from '@/hooks/useStreamResponse';
import type { AiToolTargetApi, ApplyTagInput, ContentApplyMode } from '@/hooks/useAiToolTarget';
import { ApplyPreviewModal, type PreviewToolKind } from '@/components/ai/ApplyPreviewModal';
import { computeTagPlan, type SelectedTagItem } from '@/lib/aiToolDiff';
import type { Tag as ExistingTag } from '@/services/tagService';

/**
 * 分发式渲染器：根据 toolId 选择对应的结构化展示组件。
 * 优先消费 `result`（来自 stream 尾部 `{type:"result"}` 事件），否则回落到
 * 原始 `streamContent` 做客户端解析。
 */

interface ToolResultRendererProps {
  toolId: string;
  streamContent: string;
  result: StreamResult;
  target: AiToolTargetApi;
  previewTheme: 'light' | 'dark';
  /**
   * 现有标签库 (供 tags 工具的"匹配现有/新建议"双段渲染 + 手动添加 picker 使用)。
   * 其它工具忽略。可选: 不传则 `TagsResult` 退化到旧扁平模式 (无热度徽标 / 无手动 picker)。
   */
  existingTags?: ExistingTag[];
  /**
   * 应用标签 (尤其是创建新标签) 后, 父级可借此回调刷新 `existingTags`
   * —— 让"新建议"在下次再生成时正确归类为"匹配"而非"新建议"。
   */
  onTagsLibraryChange?: () => void;
}

const _LIST_PREFIX_RE = /^(?:\d+[.)、]|[-•*])\s*/;
const _QUOTE_STRIP_RE = /[\u201c\u201d\u2018\u2019"'`]/g;
// 从每个解析后的 token 外缘剥除的字符集合。镜像 Python 端
// `apps/ai-service/app/api/routes/ai.py` 的 `_OUTER_STRIP` 集合，使得
// 像 `[“tag1”, “tag2”]` 这类畸形 LLM 输出（智能引号 → json.loads 失败 →
// 走分隔符切分路径）仍然能得到干净的 `["tag1", "tag2"]` 而不是
// `["[tag1", "tag2]"]`（PR #435 review C13）。
// 正则字符类中只有 `]` 需要转义；`[` 在字符类内部是字面量。
const _OUTER_STRIP_RE = /^[\s\u201c\u201d\u2018\u2019"'`[\]【】《》]+|[\s\u201c\u201d\u2018\u2019"'`[\]【】《》]+$/g;

function _stripToken(value: string): string {
  let result = value.replace(_OUTER_STRIP_RE, '').trim();
  if (result.startsWith('#')) {
    result = result.replace(/^#+/, '').trim();
  }
  return result;
}

// 与 Python 端 `_parse_tags` / `_parse_titles` 对齐的客户端 fallback。
function fallbackParseList(text: string): string[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const items = parsed.map((v) => _stripToken(String(v))).filter((v) => v.length > 0);
        if (items.length > 0) return items;
      }
    } catch {
      /* 非 JSON —— 落到分隔符切分路径（处理智能引号伪 JSON） */
    }
  }
  const parts: string[] = [];
  trimmed.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.replace(_LIST_PREFIX_RE, '').trim();
    if (!line) return;
    line.split(/[,，、;；]/).forEach((piece) => {
      const cleaned = _stripToken(piece.replace(_QUOTE_STRIP_RE, ''));
      if (cleaned) parts.push(cleaned);
    });
  });
  return parts;
}

function fallbackParseTitles(text: string): string[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const items = parsed.map((v) => _stripToken(String(v))).filter((v) => v.length > 0);
        if (items.length > 0) return items;
      }
    } catch {
      /* 非 JSON —— 落到按行切分路径 */
    }
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => _stripToken(line.replace(_LIST_PREFIX_RE, '').replace(_QUOTE_STRIP_RE, '')))
    .filter((line) => line.length > 0);
}

// ─────────────────────────── 共享基础元素 ───────────────────────────

interface ActionButtonProps {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  title?: string;
}

function ActionButton({ label, icon, onClick, disabled, variant = 'secondary', title }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95',
        'border shadow-sm focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-card)]',
        variant === 'primary'
          ? 'bg-[var(--ink-primary)] text-[var(--bg-void)] border-[var(--ink-primary)] hover:opacity-90'
          : 'bg-[var(--bg-card)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] hover:border-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)]',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyHint() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="flex items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/45 px-4 py-3 text-xs text-[var(--text-muted)]">
        <Sparkles className="h-4 w-4 text-[var(--aurora-1)]" />
        等待 AI 输出…
      </div>
    </div>
  );
}

// ─────────────────────────── 摘要 ───────────────────────────

function SummaryResult({
  text,
  target,
  previewTheme,
}: {
  text: string;
  target: AiToolTargetApi;
  previewTheme: 'light' | 'dark';
}) {
  if (!text.trim()) return <EmptyHint />;
  const currentSummary = target.targetPost?.summary || '';
  const hasTarget = target.targetPostId !== null;

  return (
    <div className="space-y-4">
      <MarkdownPreview
        content={text}
        className="bg-transparent border-none p-0"
        theme={previewTheme}
        style={{ fontSize: '15px', color: 'var(--text-primary)' }}
      />

      {hasTarget && (
        <div className="space-y-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 p-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
            <FileText className="w-3 h-3" />
            应用预览
          </div>
          <div className="grid gap-2">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">当前摘要</div>
              <div className="text-xs leading-relaxed text-[var(--text-secondary)] line-clamp-3">
                {currentSummary.trim() ? currentSummary : <span className="italic text-[var(--text-muted)]">（空，应用后将首次写入）</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 text-primary">
              <ArrowRight className="w-3 h-3" />
              <span className="font-mono text-[10px] uppercase tracking-wider">应用后</span>
            </div>
            <div>
              <div className="text-xs leading-relaxed text-[var(--text-primary)] line-clamp-3">{text}</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
        <ActionButton
          label="设为文章摘要"
          icon={<FileText className="w-3.5 h-3.5" />}
          variant="primary"
          onClick={() => target.applySummary(text)}
          disabled={!hasTarget}
          title={!hasTarget ? '请先选择目标文章' : undefined}
        />
        <ActionButton
          label="复制"
          icon={<Copy className="w-3.5 h-3.5" />}
          onClick={() => target.copyToClipboard(text, '摘要')}
        />
      </div>
    </div>
  );
}

/**
 * 单行差量行 (4 色调):
 *   - neutral: 保留 (灰白)
 *   - link:    复用现有标签 (aurora-1, 与"匹配现有"段同色,提示零成本)
 *   - add:     新建/新增 (success 绿,提示会创建)
 *   - remove:  移除 (danger 红,删除线)
 */
function TagDiffRow({
  label,
  tags,
  tone,
  icon,
}: {
  label: string;
  tags: string[];
  tone: 'neutral' | 'link' | 'add' | 'remove';
  icon: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
        {icon}
        {label}（{tags.length}）
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className={cn(
              'inline-flex items-center px-2 py-0.5 text-[11px] rounded-full border',
              tone === 'link' && 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)] border-[color-mix(in_oklch,var(--aurora-1)_32%,transparent)]',
              tone === 'add' && 'bg-[color-mix(in_oklch,var(--signal-success)_14%,transparent)] text-[var(--signal-success)] border-[color-mix(in_oklch,var(--signal-success)_28%,transparent)]',
              tone === 'remove' && 'bg-[color-mix(in_oklch,var(--signal-danger)_12%,transparent)] text-[var(--signal-danger)] border-[color-mix(in_oklch,var(--signal-danger)_28%,transparent)] line-through opacity-80',
              tone === 'neutral' && 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
            )}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}


// ─────────────────────────── 标签 ───────────────────────────

/**
 * 选中项的内部表示。`source` 决定视觉徽标 + 应用时是否需要"按名查找/创建":
 *   - match:      AI 命中现有标签, 已带 `tagId`, 应用零开销直接关联;
 *   - suggestion: AI 新建议, 无 `tagId`, 应用时需要先创建;
 *   - manual:     用户从"添加更多"picker 加入的现有标签, 已带 `tagId`。
 */
type SelectedTagSource = 'match' | 'suggestion' | 'manual';
interface SelectedTagState {
  name: string;
  tagId?: number;
  postCount?: number;
  reason?: string | null;
  source: SelectedTagSource;
}

interface AiTagMatch {
  name: string;
  postCount?: number;
  reason?: string | null;
}

interface TagsResultProps {
  matches: AiTagMatch[];
  suggestions: string[];
  existingTags: ExistingTag[];
  target: AiToolTargetApi;
  onTagsLibraryChange?: () => void;
}

function TagsResult({
  matches,
  suggestions,
  existingTags,
  target,
  onTagsLibraryChange,
}: TagsResultProps) {
  // 现有标签库 lookup (key=lowercased name)。
  // 用于:
  // (1) match 项反向找 tagId (AI 只返回 name);
  // (2) "添加更多" picker 过滤掉文章已经挂上的标签 + AI 已建议的标签;
  // (3) 防御性: AI "match" 名字若在当前库中查无, 降级为 suggestion。
  const existingByName = useMemo(() => {
    const map = new Map<string, ExistingTag>();
    for (const t of existingTags) {
      const key = (t.name || '').trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, t);
    }
    return map;
  }, [existingTags]);

  // matches: 如果当前库找不到对应 id, 把它降级到 suggestions 末尾 (UI 也会
  // 标"新建") —— 与 ai-service `_parse_tags_structured` 的防幻觉策略对齐。
  const { resolvedMatches, resolvedSuggestions } = useMemo(() => {
    const m: AiTagMatch[] = [];
    const s: string[] = [...suggestions];
    const sLowerSet = new Set(suggestions.map((x) => x.toLowerCase()));
    for (const candidate of matches) {
      const key = candidate.name.toLowerCase();
      if (existingByName.has(key)) {
        m.push(candidate);
      } else if (!sLowerSet.has(key)) {
        s.push(candidate.name);
        sLowerSet.add(key);
      }
    }
    return { resolvedMatches: m, resolvedSuggestions: s };
  }, [matches, suggestions, existingByName]);

  // 选中状态: lower-case name → SelectedTagState。AI 重新生成时全选所有项。
  const [selection, setSelection] = useState<Map<string, SelectedTagState>>(() => new Map());
  useEffect(() => {
    const next = new Map<string, SelectedTagState>();
    for (const m of resolvedMatches) {
      const key = m.name.toLowerCase();
      const hit = existingByName.get(key);
      next.set(key, {
        name: m.name,
        tagId: hit?.id,
        postCount: m.postCount ?? hit?.postCount ?? 0,
        reason: m.reason ?? null,
        source: 'match',
      });
    }
    for (const s of resolvedSuggestions) {
      const key = s.toLowerCase();
      if (next.has(key)) continue;
      next.set(key, { name: s, source: 'suggestion' });
    }
    setSelection(next);
  }, [resolvedMatches, resolvedSuggestions, existingByName]);

  const [mode, setMode] = useState<'replace' | 'append'>('append');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');

  if (resolvedMatches.length === 0 && resolvedSuggestions.length === 0) {
    return <EmptyHint />;
  }

  const isOn = (key: string) => selection.has(key);

  const toggle = (item: SelectedTagState) => {
    const key = item.name.toLowerCase();
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, item);
      return next;
    });
  };

  const addManual = (existing: ExistingTag) => {
    const key = existing.name.toLowerCase();
    setSelection((prev) => {
      if (prev.has(key)) return prev;
      const next = new Map(prev);
      next.set(key, {
        name: existing.name,
        tagId: existing.id,
        postCount: existing.postCount,
        source: 'manual',
      });
      return next;
    });
    setPickerQuery('');
  };

  const removeFromSelection = (key: string) => {
    setSelection((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  };

  const selectedItems = Array.from(selection.values());
  const selectedAsApplyInput: ApplyTagInput[] = selectedItems.map((it) =>
    it.tagId !== undefined ? { name: it.name, tagId: it.tagId } : it.name,
  );
  const selectedAsPlanInput: SelectedTagItem[] = selectedItems.map((it) => ({
    name: it.name,
    tagId: it.tagId,
    postCount: it.postCount,
  }));

  const currentTagsRef = (target.targetPost?.tags || []).map((t) => ({ id: t.id, name: t.name }));
  const plan = computeTagPlan(currentTagsRef, selectedAsPlanInput, mode);
  const hasTarget = target.targetPostId !== null;

  const matchSelectedCount = resolvedMatches.filter((m) => isOn(m.name.toLowerCase())).length;
  const suggestSelectedCount = resolvedSuggestions.filter((s) => isOn(s.toLowerCase())).length;
  const manualPicks = selectedItems.filter((s) => s.source === 'manual');

  // "添加更多" picker 候选: 现有库中 - 已被 AI 推荐的 - 已选中的。按 postCount 排序。
  const aiRecommendedKeys = new Set<string>();
  for (const m of resolvedMatches) aiRecommendedKeys.add(m.name.toLowerCase());
  for (const s of resolvedSuggestions) aiRecommendedKeys.add(s.toLowerCase());
  const pickerQueryNorm = pickerQuery.trim().toLowerCase();
  const pickerCandidates = existingTags
    .filter((t) => {
      const key = t.name.toLowerCase();
      if (aiRecommendedKeys.has(key)) return false;
      if (selection.has(key)) return false;
      if (!pickerQueryNorm) return true;
      return key.includes(pickerQueryNorm);
    })
    .sort((a, b) => (b.postCount || 0) - (a.postCount || 0))
    .slice(0, 50);

  const handleApply = async () => {
    if (selectedAsApplyInput.length === 0) return;
    const ok = await target.applyTags(selectedAsApplyInput, mode);
    if (ok && plan.createNew.length > 0) {
      // 新创建的标签会改变全站标签库 → 通知父级刷新, 让下次生成时它们能进 matches 而非 suggestions。
      onTagsLibraryChange?.();
    }
  };

  const totalSelected = selectedItems.length;
  const totalAvailable = resolvedMatches.length + resolvedSuggestions.length + manualPicks.length;

  return (
    <div className="space-y-4">
      {/* ─── 段 1: 匹配现有标签 ─── */}
      {resolvedMatches.length > 0 && (
        <section>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
              <Library className="w-3 h-3" />
              <span>匹配现有标签 · 已选 {matchSelectedCount} / {resolvedMatches.length}</span>
            </div>
            <span
              className="text-[10px] text-[var(--text-muted)]"
              title="AI 从现有标签库中找到的精确匹配。应用时直接关联,不会创建新标签。"
            >
              复用零成本
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {resolvedMatches.map((m) => {
              const key = m.name.toLowerCase();
              const on = isOn(key);
              const hit = existingByName.get(key);
              const postCount = m.postCount ?? hit?.postCount ?? 0;
              return (
                <button
                  key={m.name}
                  type="button"
                  onClick={() =>
                    toggle({
                      name: m.name,
                      tagId: hit?.id,
                      postCount,
                      reason: m.reason ?? null,
                      source: 'match',
                    })
                  }
                  title={m.reason ? `匹配理由: ${m.reason}` : '现有标签 · 应用时直接关联'}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border active:scale-95',
                    on
                      ? 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)] border-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)] shadow-sm'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] line-through opacity-60',
                  )}
                >
                  {on ? <Check className="w-3 h-3" /> : <Tag className="w-3 h-3" />}
                  <span>{m.name}</span>
                  {postCount > 0 && (
                    <span className="font-mono text-[10px] tnum opacity-70">{postCount}</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── 段 2: AI 新建议 ─── */}
      {resolvedSuggestions.length > 0 && (
        <section>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
              <Sparkles className="w-3 h-3" />
              <span>AI 新建议 · 已选 {suggestSelectedCount} / {resolvedSuggestions.length}</span>
            </div>
            <span
              className="text-[10px] text-[var(--text-muted)]"
              title="现有标签库中没有的概念。应用时会先创建新标签,再关联到文章。"
            >
              应用时创建
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {resolvedSuggestions.map((s) => {
              const key = s.toLowerCase();
              const on = isOn(key);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle({ name: s, source: 'suggestion' })}
                  title="AI 新建议 · 应用时会创建为新标签"
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border active:scale-95',
                    on
                      ? 'bg-[color-mix(in_oklch,var(--signal-success)_14%,transparent)] text-[var(--signal-success)] border-[color-mix(in_oklch,var(--signal-success)_36%,transparent)] shadow-sm'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] line-through opacity-60',
                  )}
                >
                  {on ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                  <span>{s}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── 段 3: 手动添加现有标签 (AI 漏掉的) ─── */}
      {existingTags.length > 0 && (
        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
              <Hash className="w-3 h-3" />
              <span>添加更多</span>
            </div>
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--aurora-1)] transition-colors"
            >
              {pickerOpen ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
              {pickerOpen ? '收起' : '从现有标签库手选'}
            </button>
          </div>

          {/* 手选已加入项 chips */}
          {manualPicks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {manualPicks.map((p) => (
                <span
                  key={p.name}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border bg-[color-mix(in_oklch,var(--aurora-2)_14%,transparent)] text-[var(--aurora-2)] border-[color-mix(in_oklch,var(--aurora-2)_36%,transparent)] shadow-sm"
                  title="手动添加的现有标签 · 应用时直接关联"
                >
                  <Check className="w-3 h-3" />
                  <span>{p.name}</span>
                  {p.postCount !== undefined && p.postCount > 0 && (
                    <span className="font-mono text-[10px] tnum opacity-70">{p.postCount}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFromSelection(p.name.toLowerCase())}
                    className="ml-0.5 -mr-1 p-0.5 rounded hover:bg-[var(--aurora-2)]/20"
                    aria-label={`移除 ${p.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* picker 搜索框 + 候选列表 */}
          {pickerOpen && (
            <div className="space-y-2 pt-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="搜索标签名…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)]"
                  autoFocus
                />
              </div>
              {pickerCandidates.length === 0 ? (
                <div className="text-[11px] text-[var(--text-muted)] italic px-1">
                  {pickerQueryNorm ? '没有匹配的标签' : 'AI 已经覆盖现有标签库'}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
                  {pickerCandidates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => addManual(t)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--aurora-1)] hover:border-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)] transition-colors active:scale-95"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{t.name}</span>
                      {t.postCount > 0 && (
                        <span className="font-mono text-[10px] tnum opacity-60">{t.postCount}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ─── 段 4: 模式切换 + 4-bucket 应用计划 ─── */}
      {hasTarget && (
        <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 p-3">
          <div className="flex bg-[var(--bg-card)] rounded-lg p-1 gap-1">
            {([
              { key: 'append' as const, label: '追加', icon: PlusCircle },
              { key: 'replace' as const, label: '替换', icon: Replace },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={cn(
                  'flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors',
                  mode === key
                    ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
              <ArrowRight className="w-3 h-3" />
              应用后预览（共 {plan.finalNames.length} 个）
            </div>
            {plan.keep.length > 0 && (
              <TagDiffRow
                label="保留"
                tags={plan.keep.map((t) => t.name)}
                tone="neutral"
                icon={<Check className="w-3 h-3" />}
              />
            )}
            {plan.linkExisting.length > 0 && (
              <TagDiffRow
                label="复用现有"
                tags={plan.linkExisting.map((t) => t.name)}
                tone="link"
                icon={<Library className="w-3 h-3" />}
              />
            )}
            {plan.createNew.length > 0 && (
              <TagDiffRow
                label="新建"
                tags={plan.createNew.map((t) => t.name)}
                tone="add"
                icon={<PlusCircle className="w-3 h-3" />}
              />
            )}
            {mode === 'replace' && plan.remove.length > 0 && (
              <TagDiffRow
                label="移除"
                tags={plan.remove.map((t) => t.name)}
                tone="remove"
                icon={<Minus className="w-3 h-3" />}
              />
            )}
            {mode === 'append' && plan.remove.length > 0 && (
              <div className="text-[10px] text-[var(--text-muted)] italic">
                追加模式不会移除当前文章已有的 {plan.remove.length} 个标签
              </div>
            )}
            {plan.finalNames.length === 0 && (
              <div className="text-[10px] text-[var(--text-muted)] italic">没有可应用的标签</div>
            )}
          </div>
        </div>
      )}

      {/* ─── 操作按钮 ─── */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]">
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            label={mode === 'replace' ? '替换为已选' : '追加到文章标签'}
            icon={mode === 'replace' ? <Replace className="w-3.5 h-3.5" /> : <ListPlus className="w-3.5 h-3.5" />}
            variant="primary"
            onClick={handleApply}
            disabled={!hasTarget || totalSelected === 0}
            title={!hasTarget ? '请先选择目标文章' : undefined}
          />
          <ActionButton
            label="复制名字"
            icon={<Copy className="w-3.5 h-3.5" />}
            onClick={() => target.copyToClipboard(selectedItems.map((s) => s.name).join(', '), '标签')}
            disabled={totalSelected === 0}
          />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] tnum">
          已选 {totalSelected} / 候选 {totalAvailable}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────── 标题 ───────────────────────────

function TitlesResult({
  titles,
  target,
}: {
  titles: string[];
  target: AiToolTargetApi;
}) {
  const [selected, setSelected] = useState<string | null>(titles[0] ?? null);

  useEffect(() => {
    setSelected(titles[0] ?? null);
  }, [titles]);

  if (titles.length === 0) return <EmptyHint />;
  const currentTitle = target.targetPost?.title || '';
  const hasTarget = target.targetPostId !== null;

  return (
    <div className="space-y-3">
      {hasTarget && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 p-3 space-y-2">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
            <Type className="w-3 h-3" />
            应用预览
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">当前标题</div>
            <div className="text-xs text-[var(--text-secondary)] truncate">
              {currentTitle.trim() || <span className="italic text-[var(--text-muted)]">（空）</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 text-primary">
            <ArrowRight className="w-3 h-3" />
            <span className="font-mono text-[10px] uppercase tracking-wider">应用后</span>
          </div>
          <div className="text-xs text-[var(--text-primary)] truncate">
            {selected ?? <span className="italic text-[var(--text-muted)]">未选择</span>}
          </div>
        </div>
      )}
      <ul className="space-y-2">
        {titles.map((title, idx) => {
          const isOn = selected === title;
          return (
            <li key={`${idx}-${title}`}>
              <button
                type="button"
                onClick={() => setSelected(title)}
                className={cn(
                  'w-full text-left px-4 py-3 rounded-2xl border transition-all active:scale-[0.995]',
                  isOn
                    ? 'bg-primary/10 border-primary/40 shadow-sm text-[var(--text-primary)]'
                    : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]',
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'flex-shrink-0 w-5 h-5 rounded-full border-2 mt-0.5 flex items-center justify-center',
                      isOn ? 'border-primary bg-primary' : 'border-[var(--border-subtle)]',
                    )}
                  >
                    {isOn && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="text-sm font-medium leading-snug">{title}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
        <ActionButton
          label="设为文章标题"
          icon={<Type className="w-3.5 h-3.5" />}
          variant="primary"
          onClick={() => selected && target.applyTitle(selected)}
          disabled={target.targetPostId === null || !selected}
          title={target.targetPostId === null ? '请先选择目标文章' : undefined}
        />
        <ActionButton
          label="复制选中"
          icon={<Copy className="w-3.5 h-3.5" />}
          onClick={() => selected && target.copyToClipboard(selected, '标题')}
          disabled={!selected}
        />
      </div>
    </div>
  );
}

// ─────────────────────────── 正文级（润色 / 大纲 / 翻译）───────────────────────────

interface ContentResultProps {
  text: string;
  target: AiToolTargetApi;
  previewTheme: 'light' | 'dark';
  /** 决定 ApplyPreviewModal 的预览形态：润色用 word-diff，翻译用 split-view，大纲用全篇渲染 */
  toolKind: PreviewToolKind;
  primaryLabel: string;
  primaryMode: ContentApplyMode;
  primaryIcon: React.ReactNode;
  secondaryLabel?: string;
  secondaryMode?: ContentApplyMode;
  copyLabel: string;
  headerBadge?: React.ReactNode;
  targetLanguage?: string;
}

function ContentApplyBlock({
  text,
  target,
  previewTheme,
  toolKind,
  primaryLabel,
  primaryMode,
  primaryIcon,
  secondaryLabel,
  secondaryMode,
  copyLabel,
  headerBadge,
  targetLanguage,
}: ContentResultProps) {
  const [pendingMode, setPendingMode] = useState<ContentApplyMode | null>(null);

  if (!text.trim()) return <EmptyHint />;

  const currentContent = target.targetPost?.content || '';
  const hasTarget = target.targetPostId !== null;

  const trigger = (mode: ContentApplyMode) => {
    if (!hasTarget) {
      target.copyToClipboard(text, copyLabel);
      return;
    }
    setPendingMode(mode);
  };

  const confirm = async () => {
    if (pendingMode) {
      await target.applyContent(text, pendingMode);
      setPendingMode(null);
    }
  };

  return (
    <div className="space-y-4">
      {headerBadge}
      <MarkdownPreview
        content={text}
        className="bg-transparent border-none p-0"
        theme={previewTheme}
        style={{ fontSize: '15px', color: 'var(--text-primary)' }}
      />
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
        <ActionButton
          label={primaryLabel}
          icon={primaryIcon}
          variant="primary"
          onClick={() => trigger(primaryMode)}
          disabled={!hasTarget}
          title={!hasTarget ? '请先选择目标文章' : undefined}
        />
        {secondaryLabel && secondaryMode && (
          <ActionButton
            label={secondaryLabel}
            icon={<ListPlus className="w-3.5 h-3.5" />}
            onClick={() => trigger(secondaryMode)}
            disabled={!hasTarget}
          />
        )}
        <ActionButton
          label="复制"
          icon={<Copy className="w-3.5 h-3.5" />}
          onClick={() => target.copyToClipboard(text, copyLabel)}
        />
      </div>

      <ApplyPreviewModal
        isOpen={pendingMode !== null}
        tool={toolKind}
        mode={pendingMode ?? primaryMode}
        currentContent={currentContent}
        nextContent={text}
        targetLanguage={targetLanguage}
        previewTheme={previewTheme}
        onConfirm={confirm}
        onCancel={() => setPendingMode(null)}
      />
    </div>
  );
}

function PolishResult(props: { text: string; target: AiToolTargetApi; previewTheme: 'light' | 'dark' }) {
  return (
    <ContentApplyBlock
      {...props}
      toolKind="polish"
      primaryLabel="替换文章正文"
      primaryMode="replace"
      primaryIcon={<PenLine className="w-3.5 h-3.5" />}
      copyLabel="润色结果"
    />
  );
}

function TranslateResult({
  text,
  target,
  previewTheme,
  targetLanguage,
}: {
  text: string;
  target: AiToolTargetApi;
  previewTheme: 'light' | 'dark';
  targetLanguage?: string;
}) {
  return (
    <ContentApplyBlock
      text={text}
      target={target}
      previewTheme={previewTheme}
      toolKind="translate"
      primaryLabel="替换文章正文"
      primaryMode="replace"
      primaryIcon={<Languages className="w-3.5 h-3.5" />}
      targetLanguage={targetLanguage}
      copyLabel="翻译结果"
      headerBadge={
        targetLanguage ? (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
            <Languages className="w-3 h-3" />
            {targetLanguage}
          </div>
        ) : undefined
      }
    />
  );
}

function OutlineResult(props: { text: string; target: AiToolTargetApi; previewTheme: 'light' | 'dark' }) {
  return (
    <ContentApplyBlock
      {...props}
      toolKind="outline"
      primaryLabel="追加到文章末尾"
      primaryMode="append"
      primaryIcon={<ListPlus className="w-3.5 h-3.5" />}
      secondaryLabel="替换正文"
      secondaryMode="replace"
      copyLabel="大纲"
    />
  );
}

// ─────────────────────────── 分发器 ───────────────────────────

export function ToolResultRenderer({
  toolId,
  streamContent,
  result,
  target,
  previewTheme,
  existingTags,
  onTagsLibraryChange,
}: ToolResultRendererProps) {
  const resolved = useMemo(() => {
    const r = (result || {}) as Record<string, unknown>;
    switch (toolId) {
      case 'summary':
        return {
          text: (r.summary as string) || streamContent || '',
        };
      case 'tags': {
        // 后端新契约: r.matches (TagMatch[]) + r.suggestions (string[])。
        // 旧契约: 仅 r.tags (string[])。两种都要支持: 如果新字段存在, 直接用;
        // 否则把 r.tags / 流文本兜底解析的扁平结果全塞 suggestions, 由 TagsResult
        // 的客户端二次校验把命中现有库的项升格回 matches。
        const rawMatches = Array.isArray(r.matches)
          ? (r.matches as Array<Record<string, unknown>>)
              .map((m) => ({
                name: typeof m.name === 'string' ? (m.name as string) : '',
                postCount: typeof m.postCount === 'number' ? (m.postCount as number) : undefined,
                reason: typeof m.reason === 'string' ? (m.reason as string) : null,
              }))
              .filter((m) => m.name.trim().length > 0)
          : [];
        const rawSuggestions = Array.isArray(r.suggestions) && (r.suggestions as unknown[]).every((t) => typeof t === 'string')
          ? (r.suggestions as string[])
          : null;

        if (rawMatches.length > 0 || rawSuggestions !== null) {
          return {
            matches: rawMatches,
            suggestions: rawSuggestions ?? [],
            // 旧扁平视图也保留, 给"无 target"copy 路径 / 完全降级路径用。
            tags: [...rawMatches.map((m) => m.name), ...(rawSuggestions ?? [])],
          };
        }

        const fallbackFlat =
          Array.isArray(r.tags) && (r.tags as unknown[]).every((t) => typeof t === 'string')
            ? (r.tags as string[])
            : fallbackParseList(streamContent);
        return { matches: [], suggestions: fallbackFlat, tags: fallbackFlat };
      }
      case 'titles': {
        const titles =
          Array.isArray(r.titles) && (r.titles as unknown[]).every((t) => typeof t === 'string')
            ? (r.titles as string[])
            : fallbackParseTitles(streamContent);
        return { titles };
      }
      case 'polish':
        return { text: (r.polishedContent as string) || streamContent || '' };
      case 'outline':
        return { text: (r.outline as string) || streamContent || '' };
      case 'translate':
        return {
          text: (r.translatedContent as string) || streamContent || '',
          targetLanguage: (r.targetLanguage as string) || '',
        };
      default:
        return { text: streamContent || '' };
    }
  }, [toolId, streamContent, result]);

  switch (toolId) {
    case 'summary':
      return <SummaryResult text={resolved.text || ''} target={target} previewTheme={previewTheme} />;
    case 'tags':
      return (
        <TagsResult
          matches={resolved.matches || []}
          suggestions={resolved.suggestions || []}
          existingTags={existingTags || []}
          target={target}
          onTagsLibraryChange={onTagsLibraryChange}
        />
      );
    case 'titles':
      return <TitlesResult titles={resolved.titles || []} target={target} />;
    case 'polish':
      return <PolishResult text={resolved.text || ''} target={target} previewTheme={previewTheme} />;
    case 'outline':
      return <OutlineResult text={resolved.text || ''} target={target} previewTheme={previewTheme} />;
    case 'translate':
      return (
        <TranslateResult
          text={resolved.text || ''}
          targetLanguage={resolved.targetLanguage}
          target={target}
          previewTheme={previewTheme}
        />
      );
    default:
      // 自定义 / 未知工具 —— 通用 markdown 预览 + 复制操作。
      return (
        <div className="space-y-4">
          {resolved.text ? (
            <MarkdownPreview
              content={resolved.text}
              className="bg-transparent border-none p-0"
              theme={previewTheme}
              style={{ fontSize: '15px', color: 'var(--text-primary)' }}
            />
          ) : (
            <EmptyHint />
          )}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <ActionButton
              label="复制结果"
              icon={<Copy className="w-3.5 h-3.5" />}
              onClick={() => target.copyToClipboard(resolved.text || '', '结果')}
              disabled={!resolved.text}
            />
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider ml-2 inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> 自定义工具
            </span>
          </div>
        </div>
      );
  }
}
