import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Copy, FileText, Languages, ListPlus, Minus, PenLine, PlusCircle, Replace, Sparkles, Tag, Type } from 'lucide-react';
import { MarkdownPreview } from '@aetherblog/editor';
import { ConfirmModal } from '@aetherblog/ui';
import { cn } from '@/lib/utils';
import type { StreamResult } from '@/hooks/useStreamResponse';
import type { AiToolTargetApi, ContentApplyMode } from '@/hooks/useAiToolTarget';

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
        'border shadow-sm',
        variant === 'primary'
          ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white hover:opacity-90'
          : 'bg-[var(--bg-card)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]',
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
    <div className="flex items-center justify-center py-12 text-xs text-[var(--text-muted)]">
      等待 AI 输出…
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

/** 单行差量：保留 / 新增 / 移除（与 AiSidePanel 同语义、不同 chrome） */
function TagDiffRow({
  label,
  tags,
  tone,
  icon,
}: {
  label: string;
  tags: string[];
  tone: 'neutral' | 'add' | 'remove';
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

/** AiSidePanel.computeTagDiff 在工具箱里的复制 —— 两边语义保持一致。 */
function computeTagDiff(
  current: string[],
  selected: string[],
  mode: 'replace' | 'append',
): { keep: string[]; add: string[]; remove: string[]; finalList: string[] } {
  const currentMap = new Map(current.map((t) => [t.toLowerCase(), t]));
  const selectedMap = new Map(selected.map((t) => [t.toLowerCase(), t]));
  const keep: string[] = [];
  const add: string[] = [];
  const remove: string[] = [];
  for (const [k, name] of selectedMap) {
    if (currentMap.has(k)) keep.push(currentMap.get(k)!);
    else add.push(name);
  }
  for (const [k, name] of currentMap) {
    if (!selectedMap.has(k)) remove.push(name);
  }
  const finalList =
    mode === 'replace' ? [...keep, ...add] : [...current, ...add];
  return { keep, add, remove, finalList };
}

// ─────────────────────────── 标签 ───────────────────────────

function TagsResult({
  tags,
  target,
}: {
  tags: string[];
  target: AiToolTargetApi;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(tags.map((t) => t.toLowerCase())));
  const [mode, setMode] = useState<'replace' | 'append'>('append');

  // 入参 tags 变化时（重新执行工具）重置选择状态。
  useEffect(() => {
    setSelected(new Set(tags.map((t) => t.toLowerCase())));
  }, [tags]);

  if (tags.length === 0) return <EmptyHint />;

  const toggle = (tag: string) => {
    const key = tag.toLowerCase();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedList = tags.filter((t) => selected.has(t.toLowerCase()));
  const currentTagNames = (target.targetPost?.tags || []).map((t) => t.name);
  const diff = computeTagDiff(currentTagNames, selectedList, mode);
  const hasTarget = target.targetPostId !== null;

  return (
    <div className="space-y-4">
      {/* AI 推荐 chips —— toggle 选择 */}
      <div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] mb-2">
          <Tag className="w-3 h-3" />
          AI 推荐 · 已选 {selectedList.length} / {tags.length}
        </div>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => {
            const isOn = selected.has(tag.toLowerCase());
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggle(tag)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border active:scale-95',
                  isOn
                    ? 'bg-primary/10 text-primary border-primary/40 shadow-sm'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] line-through opacity-60',
                )}
              >
                {isOn && <Check className="w-3 h-3" />}
                <Tag className="w-3 h-3" />
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      {/* 模式切换 + 应用后差量预览（必须有 target 才能算 diff） */}
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
              应用后预览（共 {diff.finalList.length} 个）
            </div>
            {diff.keep.length > 0 && (
              <TagDiffRow label="保留" tags={diff.keep} tone="neutral" icon={<Check className="w-3 h-3" />} />
            )}
            {diff.add.length > 0 && (
              <TagDiffRow label="新增" tags={diff.add} tone="add" icon={<PlusCircle className="w-3 h-3" />} />
            )}
            {mode === 'replace' && diff.remove.length > 0 && (
              <TagDiffRow label="移除" tags={diff.remove} tone="remove" icon={<Minus className="w-3 h-3" />} />
            )}
            {mode === 'append' && diff.remove.length > 0 && (
              <div className="text-[10px] text-[var(--text-muted)] italic">
                追加模式不会移除当前文章已有的 {diff.remove.length} 个标签
              </div>
            )}
            {diff.finalList.length === 0 && (
              <div className="text-[10px] text-[var(--text-muted)] italic">没有可应用的标签</div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
        <ActionButton
          label={mode === 'replace' ? '替换为已选' : '追加到文章标签'}
          icon={mode === 'replace' ? <Replace className="w-3.5 h-3.5" /> : <ListPlus className="w-3.5 h-3.5" />}
          variant="primary"
          onClick={() => target.applyTags(selectedList, mode)}
          disabled={!hasTarget || selectedList.length === 0}
          title={!hasTarget ? '请先选择目标文章' : undefined}
        />
        <ActionButton
          label="复制"
          icon={<Copy className="w-3.5 h-3.5" />}
          onClick={() => target.copyToClipboard(selectedList.join(', '), '标签')}
        />
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
  primaryLabel: string;
  primaryMode: ContentApplyMode;
  primaryIcon: React.ReactNode;
  /**
   * 确认提示语解析器。允许 append / replace 两种模式展示不同的警告文案，
   * 避免「大纲 outline 的次要按钮点进来看到的还是追加说明」这类错配
   * （PR #435 review C11）。
   */
  confirmMessage: string | ((mode: ContentApplyMode) => string);
  secondaryLabel?: string;
  secondaryMode?: ContentApplyMode;
  copyLabel: string;
  headerBadge?: React.ReactNode;
}

function ContentApplyBlock({
  text,
  target,
  previewTheme,
  primaryLabel,
  primaryMode,
  primaryIcon,
  confirmMessage,
  secondaryLabel,
  secondaryMode,
  copyLabel,
  headerBadge,
}: ContentResultProps) {
  const [pendingMode, setPendingMode] = useState<ContentApplyMode | null>(null);

  if (!text.trim()) return <EmptyHint />;

  const trigger = (mode: ContentApplyMode) => {
    if (target.targetPostId === null) {
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

  const resolvedConfirmMessage =
    typeof confirmMessage === 'function'
      ? pendingMode
        ? confirmMessage(pendingMode)
        : ''
      : confirmMessage;

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
          disabled={target.targetPostId === null}
          title={target.targetPostId === null ? '请先选择目标文章' : undefined}
        />
        {secondaryLabel && secondaryMode && (
          <ActionButton
            label={secondaryLabel}
            icon={<ListPlus className="w-3.5 h-3.5" />}
            onClick={() => trigger(secondaryMode)}
            disabled={target.targetPostId === null}
          />
        )}
        <ActionButton
          label="复制"
          icon={<Copy className="w-3.5 h-3.5" />}
          onClick={() => target.copyToClipboard(text, copyLabel)}
        />
      </div>

      <ConfirmModal
        isOpen={pendingMode !== null}
        title={pendingMode === 'replace' ? '替换文章正文' : '追加到文章末尾'}
        message={resolvedConfirmMessage}
        confirmText={pendingMode === 'replace' ? '替换' : '追加'}
        cancelText="取消"
        variant={pendingMode === 'replace' ? 'danger' : 'warning'}
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
      primaryLabel="替换文章正文"
      primaryMode="replace"
      primaryIcon={<PenLine className="w-3.5 h-3.5" />}
      confirmMessage="将使用润色后的文本替换目标文章的当前正文，此操作不可撤销，请确认。"
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
      primaryLabel="替换文章正文"
      primaryMode="replace"
      primaryIcon={<Languages className="w-3.5 h-3.5" />}
      confirmMessage={`将使用 ${targetLanguage || '翻译后'} 的文本替换目标文章的当前正文，请确认。`}
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
      primaryLabel="追加到文章末尾"
      primaryMode="append"
      primaryIcon={<ListPlus className="w-3.5 h-3.5" />}
      secondaryLabel="替换正文"
      secondaryMode="replace"
      confirmMessage={(mode) =>
        mode === 'replace'
          ? '将使用生成的大纲完全替换目标文章的当前正文，此操作不可撤销，请确认。'
          : '将把大纲内容追加到目标文章末尾，请确认。'
      }
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
}: ToolResultRendererProps) {
  const resolved = useMemo(() => {
    const r = (result || {}) as Record<string, unknown>;
    switch (toolId) {
      case 'summary':
        return {
          text: (r.summary as string) || streamContent || '',
        };
      case 'tags': {
        const tags =
          Array.isArray(r.tags) && (r.tags as unknown[]).every((t) => typeof t === 'string')
            ? (r.tags as string[])
            : fallbackParseList(streamContent);
        return { tags };
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
      return <TagsResult tags={resolved.tags || []} target={target} />;
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
