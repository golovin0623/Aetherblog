import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileText, Languages, ListPlus, PenLine, Sparkles, Tag, Type } from 'lucide-react';
import { MarkdownPreview } from '@aetherblog/editor';
import { ConfirmModal } from '@aetherblog/ui';
import { cn } from '@/lib/utils';
import type { StreamResult } from '@/hooks/useStreamResponse';
import type { AiToolTargetApi, ContentApplyMode } from '@/hooks/useAiToolTarget';

/**
 * Dispatch-style renderer: 根据 toolId 选择对应的结构化展示组件。
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

// 与 Python 端 `_parse_tags` / `_parse_titles` 对齐的客户端 fallback。
function fallbackParseList(text: string): string[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((v) => String(v).replace(_QUOTE_STRIP_RE, '').trim())
          .filter((v) => v.length > 0);
      }
    } catch {
      /* not JSON */
    }
  }
  const parts: string[] = [];
  trimmed.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.replace(_LIST_PREFIX_RE, '').trim();
    if (!line) return;
    line.split(/[,，、;；]/).forEach((piece) => {
      const cleaned = piece.replace(_QUOTE_STRIP_RE, '').replace(/^#/, '').trim();
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
        return parsed
          .map((v) => String(v).replace(_QUOTE_STRIP_RE, '').trim())
          .filter((v) => v.length > 0);
      }
    } catch {
      /* not JSON */
    }
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(_LIST_PREFIX_RE, '').replace(_QUOTE_STRIP_RE, '').trim())
    .filter((line) => line.length > 0);
}

// ─────────────────────────── Shared primitives ───────────────────────────

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

// ─────────────────────────── Summary ───────────────────────────

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
  return (
    <div className="space-y-4">
      <MarkdownPreview
        content={text}
        className="bg-transparent border-none p-0"
        theme={previewTheme}
        style={{ fontSize: '15px', color: 'var(--text-primary)' }}
      />
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
        <ActionButton
          label="设为文章摘要"
          icon={<FileText className="w-3.5 h-3.5" />}
          variant="primary"
          onClick={() => target.applySummary(text)}
          disabled={target.targetPostId === null}
          title={target.targetPostId === null ? '请先选择目标文章' : undefined}
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

// ─────────────────────────── Tags ───────────────────────────

function TagsResult({
  tags,
  target,
}: {
  tags: string[];
  target: AiToolTargetApi;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(tags));

  // Reset selection whenever incoming tags change (re-run the tool).
  useEffect(() => {
    setSelected(new Set(tags));
  }, [tags]);

  if (tags.length === 0) return <EmptyHint />;

  const toggle = (tag: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const selectedList = tags.filter((t) => selected.has(t));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const isOn = selected.has(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border active:scale-95',
                isOn
                  ? 'bg-primary/10 text-primary border-primary/40 shadow-sm'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]',
              )}
            >
              {isOn && <Check className="w-3 h-3" />}
              <Tag className="w-3 h-3" />
              {tag}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
        <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
          已选 {selectedList.length} / {tags.length}
        </span>
        <div className="flex-1" />
        <ActionButton
          label="追加到文章标签"
          icon={<ListPlus className="w-3.5 h-3.5" />}
          variant="primary"
          onClick={() => target.applyTags(selectedList)}
          disabled={target.targetPostId === null || selectedList.length === 0}
          title={target.targetPostId === null ? '请先选择目标文章' : undefined}
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

// ─────────────────────────── Titles ───────────────────────────

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

  return (
    <div className="space-y-3">
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

// ─────────────────────────── Content-level (polish / outline / translate) ───────────────────────────

interface ContentResultProps {
  text: string;
  target: AiToolTargetApi;
  previewTheme: 'light' | 'dark';
  primaryLabel: string;
  primaryMode: ContentApplyMode;
  primaryIcon: React.ReactNode;
  confirmMessage: string;
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
        message={confirmMessage}
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
      confirmMessage="将把大纲内容追加到目标文章末尾，请确认。"
      copyLabel="大纲"
    />
  );
}

// ─────────────────────────── Dispatcher ───────────────────────────

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
      // Custom / unknown tool — generic markdown preview with copy action.
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
